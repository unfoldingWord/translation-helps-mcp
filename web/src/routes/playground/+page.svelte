<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import JsonViewer from '$lib/JsonViewer.svelte';

	// Tool schemas — fetched from the MCP server at runtime
	type ToolSchema = {
		name: string;
		description: string;
		inputSchema: {
			type: string;
			properties: Record<
				string,
				{
					type?: string;
					description?: string;
					default?: unknown;
					enum?: string[];
					items?: { type?: string; enum?: string[] };
				}
			>;
			required?: string[];
		};
	};

	let tools: ToolSchema[] = [];
	let selectedTool: ToolSchema | null = null;
	let formValues: Record<string, string> = {};
	let result: unknown = null;
	let rawResult = '';
	let requestId = '';
	let latencyMs = 0;
	let isLoading = false;
	let error = '';
	let toolsLoading = true;
	let activeTab: 'tree' | 'raw' = 'tree';
	let copyDone = false;

	/** Convenience alias — matches JsonViewer's value prop type. */
	type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

	/**
	 * Extract the most useful JSON object from the raw MCP result.
	 * MCP responses wrap data in content[].text as a JSON string.
	 * We unwrap it so the tree shows the actual structured data.
	 */
	function extractStructuredResult(raw: unknown): unknown {
		if (!raw || typeof raw !== 'object') return raw;
		const r = raw as Record<string, unknown>;

		// Try structuredContent first (our ok() wrapper)
		if (r.structuredContent) return r.structuredContent;

		// Try content[0].text (standard MCP shape)
		if (Array.isArray(r.content)) {
			for (const item of r.content as unknown[]) {
				const c = item as Record<string, unknown>;
				if (typeof c?.text === 'string') {
					try {
						return JSON.parse(c.text);
					} catch {
						// not JSON — return as-is
						return c.text;
					}
				}
			}
		}
		return raw;
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(rawResult);
			copyDone = true;
			setTimeout(() => (copyDone = false), 1800);
		} catch {
			/* clipboard blocked */
		}
	}

	// Use /api/mcp-proxy in local dev (Durable Object /mcp doesn't work locally).
	// In production the proxy redirects to the real /mcp McpAgent.
	const MCP_URL =
		typeof window !== 'undefined' ? `${window.location.origin}/api/mcp-proxy` : '/api/mcp-proxy';

	async function mcpCall(method: string, params?: unknown) {
		const res = await fetch(MCP_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: Math.random(), method, params })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const contentType = res.headers.get('content-type') ?? '';
		if (contentType.includes('text/event-stream')) {
			// Read SSE stream
			const text = await res.text();
			const dataLines = text
				.split('\n')
				.filter((l) => l.startsWith('data:'))
				.map((l) => l.slice(5).trim());
			for (const line of dataLines) {
				try {
					return JSON.parse(line);
				} catch {
					/* skip non-JSON */
				}
			}
			throw new Error('No valid JSON in SSE stream');
		}
		return res.json();
	}

	onMount(async () => {
		try {
			const data = await mcpCall('tools/list');
			tools = data?.result?.tools ?? [];
			toolsLoading = false;

			// Select from URL param
			const toolParam = $page.url.searchParams.get('tool');
			if (toolParam) {
				const found = tools.find((t) => t.name === toolParam);
				if (found) selectTool(found);
			} else if (tools.length > 0) {
				selectTool(tools[0]);
			}
		} catch (e) {
			error = `Failed to load tools: ${e instanceof Error ? e.message : e}`;
			toolsLoading = false;
		}
	});

	function selectTool(tool: ToolSchema) {
		selectedTool = tool;
		formValues = {};
		result = null;
		rawResult = '';
		error = '';
		activeTab = 'tree';

		// Pre-fill defaults
		const props = tool.inputSchema?.properties ?? {};
		for (const [key, schema] of Object.entries(props)) {
			if (schema.default !== undefined) {
				formValues[key] = String(schema.default);
			}
		}
	}

	async function runTool() {
		if (!selectedTool) return;
		isLoading = true;
		error = '';
		result = null;
		rawResult = '';
		requestId = '';
		latencyMs = 0;

		const start = Date.now();
		try {
			// Build typed params from form values
			const params: Record<string, unknown> = {};
			const props = selectedTool.inputSchema?.properties ?? {};
			for (const [key, val] of Object.entries(formValues)) {
				if (val === '') continue;
				const schema = props[key];
				if (schema?.type === 'boolean') {
					params[key] = val === 'true';
				} else if (schema?.type === 'integer' || schema?.type === 'number') {
					params[key] = Number(val);
				} else if (schema?.type === 'array') {
					try {
						params[key] = JSON.parse(val);
					} catch {
						params[key] = val.split(',').map((s) => s.trim());
					}
				} else {
					params[key] = val;
				}
			}

			const response = await mcpCall('tools/call', { name: selectedTool.name, arguments: params });
			latencyMs = Date.now() - start;

			const mcpResult = response?.result;
			if (mcpResult) {
				result = mcpResult;
				rawResult = JSON.stringify(mcpResult, null, 2);

				// Extract trace ID from content if present
				const content = mcpResult?.content;
				if (Array.isArray(content)) {
					for (const item of content) {
						if (typeof item?.text === 'string') {
							try {
								const parsed = JSON.parse(item.text);
								if (parsed?.requestId) requestId = parsed.requestId;
							} catch {
								/* skip */
							}
						}
					}
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			latencyMs = Date.now() - start;
		} finally {
			isLoading = false;
		}
	}

	function getInputType(schema: {
		type?: string;
		enum?: string[];
	}): 'text' | 'select' | 'textarea' | 'checkbox' | 'number' {
		if (schema.enum) return 'select';
		if (schema.type === 'boolean') return 'checkbox';
		if (schema.type === 'integer' || schema.type === 'number') return 'number';
		return 'text';
	}

	function isRequired(tool: ToolSchema, key: string): boolean {
		return tool.inputSchema?.required?.includes(key) ?? false;
	}
</script>

<svelte:head>
	<title>Playground — Translation Helps MCP</title>
</svelte:head>

<div class="flex h-[calc(100vh-4rem)]">
	<!-- Sidebar: tool list -->
	<aside class="w-64 flex-shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-900">
		<div class="border-b border-gray-800 p-3">
			<h2 class="text-xs font-semibold tracking-wider text-gray-400 uppercase">MCP Tools</h2>
		</div>
		{#if toolsLoading}
			<div class="animate-pulse p-4 text-sm text-gray-500">Loading tools…</div>
		{:else if tools.length === 0}
			<div class="p-4 text-sm text-red-400">Could not load tools. Is the server running?</div>
		{:else}
			{#each tools as tool}
			<button
				onclick={() => selectTool(tool)}
					class="w-full border-b border-gray-800/50 px-3 py-2.5 text-left text-sm transition-colors
            {selectedTool?.name === tool.name
						? 'border-l-2 border-l-indigo-500 bg-indigo-900/40 text-indigo-300'
						: 'text-gray-400 hover:bg-gray-800 hover:text-white'}"
				>
					<div class="font-mono text-xs font-medium">{tool.name}</div>
				</button>
			{/each}
		{/if}
	</aside>

	<!-- Main: form + result -->
	<div class="flex flex-1 flex-col overflow-y-auto lg:flex-row">
		<!-- Input form -->
		<div class="overflow-y-auto border-r border-gray-800 p-6 lg:w-1/2">
			{#if selectedTool}
				<div class="mb-4">
					<h2 class="font-mono text-lg font-bold text-indigo-300">{selectedTool.name}</h2>
					<p class="mt-1 text-sm text-gray-400">{selectedTool.description}</p>
				</div>

				<form onsubmit={(e) => { e.preventDefault(); runTool(); }} class="space-y-4">
					{#each Object.entries(selectedTool.inputSchema?.properties ?? {}) as [key, schema]}
						<div>
							<label
								class="mb-1.5 block flex items-center gap-1 text-xs font-semibold text-gray-400"
							>
								<span class="font-mono">{key}</span>
								{#if isRequired(selectedTool, key)}
									<span class="text-red-400">*</span>
								{/if}
								{#if schema.type}
									<span class="font-normal text-gray-600">({schema.type})</span>
								{/if}
							</label>
							{#if schema.description}
								<p class="mb-1 text-xs text-gray-500">{schema.description}</p>
							{/if}

							{#if getInputType(schema) === 'select' && schema.enum}
								<select
									bind:value={formValues[key]}
									class="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
								>
									{#each schema.enum as opt}
										<option value={opt}>{opt}</option>
									{/each}
								</select>
							{:else if getInputType(schema) === 'checkbox'}
								<select
									bind:value={formValues[key]}
									class="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
								>
									<option value="true">true</option>
									<option value="false">false</option>
								</select>
							{:else if getInputType(schema) === 'number'}
								<input
									type="number"
									bind:value={formValues[key]}
									placeholder={String(schema.default ?? '')}
									class="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
								/>
							{:else}
								<input
									type="text"
									bind:value={formValues[key]}
									placeholder={schema.default !== undefined ? String(schema.default) : key}
									class="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
								/>
							{/if}
						</div>
					{/each}

					<button
						type="submit"
						disabled={isLoading}
						class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
					>
						{isLoading ? '⏳ Running…' : '▶ Run Tool'}
					</button>
				</form>
			{:else}
				<div class="text-sm text-gray-500">Select a tool from the sidebar.</div>
			{/if}
		</div>

		<!-- Result pane -->
		<div class="flex flex-col overflow-hidden bg-gray-950 lg:w-1/2">
			<!-- Result header bar -->
			{#if result || error || isLoading}
				<div
					class="flex flex-shrink-0 items-center justify-between border-b border-gray-800 px-4 py-2"
				>
					<!-- Status + latency -->
					<div class="flex items-center gap-3 font-mono text-xs">
						{#if isLoading}
							<span class="animate-pulse text-indigo-400">⏳ Running…</span>
						{:else if error}
							<span class="text-red-400">✗ Error</span>
						{:else if result && typeof result === 'object' && 'isError' in result && (result as Record<string,unknown>).isError}
							<span class="text-orange-400">⚠ Tool error</span>
						{:else if result}
							<span class="text-green-400">✓ OK</span>
						{/if}
						{#if latencyMs > 0}
							<span class="text-gray-500">⏱ {latencyMs}ms</span>
						{/if}
						{#if requestId}
							<span class="text-gray-600">#{requestId.slice(0, 8)}</span>
						{/if}
					</div>

					<!-- Tab switcher + copy -->
					<div class="flex items-center gap-2">
						{#if rawResult}
							<div class="flex rounded-md border border-gray-700 overflow-hidden">
								<button
									onclick={() => (activeTab = 'tree')}
									class="px-3 py-1 text-xs font-medium transition-colors
									{activeTab === 'tree' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}"
								>Tree</button>
								<button
									onclick={() => (activeTab = 'raw')}
									class="px-3 py-1 text-xs font-medium transition-colors
									{activeTab === 'raw' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}"
								>Raw</button>
							</div>
							<button
								onclick={copyToClipboard}
								class="rounded-md border border-gray-700 px-3 py-1 text-xs text-gray-400 transition-colors hover:border-gray-500 hover:text-white"
								title="Copy raw JSON to clipboard"
							>
								{copyDone ? '✓ Copied' : 'Copy'}
							</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-5">
				{#if error}
					<div class="rounded-lg border border-red-800 bg-red-950 p-4 font-mono text-sm text-red-300 break-all">
						{error}
					</div>
				{:else if isLoading}
					<div class="mt-12 flex flex-col items-center gap-3 text-gray-600">
						<div class="h-7 w-7 animate-spin rounded-full border-2 border-gray-700 border-t-indigo-500"></div>
						<span class="text-sm">Calling {selectedTool?.name}…</span>
					</div>
				{:else if rawResult}
					{#if activeTab === 'tree'}
						{@const treeData = extractStructuredResult(result) as JsonValue}
						<!-- Interactive JSON tree -->
						<div class="json-pane rounded-lg border border-gray-800 bg-gray-900 p-4">
							<JsonViewer value={treeData} depth={0} />
						</div>
					{:else}
						<!-- Raw JSON text -->
						<pre class="whitespace-pre-wrap break-all font-mono text-xs text-green-300">{rawResult}</pre>
					{/if}
				{:else}
					<div class="mt-16 text-center text-sm text-gray-600">
						Fill in the form and click Run Tool to see results here.
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
