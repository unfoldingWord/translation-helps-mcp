<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import JsonViewer from '$lib/JsonViewer.svelte';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import { withBase } from '$lib/paths.js';
	import {
		Check,
		Copy,
		Loader2,
		Play,
		Search,
		Terminal,
		Wrench,
		AlertCircle,
		AlertTriangle
	} from 'lucide-svelte';

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
	let toolFilter = '';

	type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

	$: filteredTools = tools.filter((t) => {
		const q = toolFilter.trim().toLowerCase();
		if (!q) return true;
		return t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q);
	});

	$: paramEntries = Object.entries(selectedTool?.inputSchema?.properties ?? {});
	$: requiredCount = selectedTool?.inputSchema?.required?.length ?? 0;

	function extractStructuredResult(raw: unknown): unknown {
		if (!raw || typeof raw !== 'object') return raw;
		const r = raw as Record<string, unknown>;

		if (r.structuredContent) return r.structuredContent;

		if (Array.isArray(r.content)) {
			for (const item of r.content as unknown[]) {
				const c = item as Record<string, unknown>;
				if (typeof c?.text === 'string') {
					try {
						return JSON.parse(c.text);
					} catch {
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

	// Playground talks to /api/mcp-proxy, which lists/calls the canonical
	// MCP_TOOLS registry (same surface as the /mcp McpAgent).
	const MCP_URL =
		typeof window !== 'undefined'
			? `${window.location.origin}${withBase('/api/mcp-proxy')}`
			: withBase('/api/mcp-proxy');

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

	function shortDesc(desc: string, max = 56): string {
		const d = (desc ?? '').trim();
		if (d.length <= max) return d;
		return `${d.slice(0, max - 1)}…`;
	}

	$: isToolError =
		!!result &&
		typeof result === 'object' &&
		'isError' in result &&
		(result as Record<string, unknown>).isError;
</script>

<svelte:head>
	<title>Playground — Translation Helps MCP</title>
</svelte:head>

<div class="page-shell flex min-h-[calc(100vh-8rem)] flex-col">
	<!-- Page header -->
	<div class="border-b border-slate-800/90 px-4 py-5 sm:px-6">
		<div class="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-3">
			<div>
				<p class="mb-1.5 text-[11px] font-semibold tracking-[0.16em] text-sky-400/90 uppercase">
					Interactive
				</p>
				<h1 class="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">Playground</h1>
				<p class="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">
					Call any MCP tool live — inspect structured JSON, latency, and request IDs.
				</p>
			</div>
			{#if !toolsLoading && tools.length > 0}
				<div
					class="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs text-slate-400 ring-1 ring-slate-800"
				>
					<Wrench class="h-3.5 w-3.5 text-sky-400" />
					<span class="font-mono text-sky-200">{tools.length}</span>
					<span>tools</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Workspace -->
	<div
		class="mx-auto flex w-full max-w-[1600px] flex-1 flex-col overflow-hidden lg:h-[calc(100vh-12.5rem)] lg:flex-row lg:gap-4 lg:p-4"
	>
		<!-- Sidebar -->
		<aside
			class="flex max-h-48 flex-col border-b border-slate-800/90 bg-slate-950/40 lg:max-h-none lg:w-72 lg:shrink-0 lg:rounded-2xl lg:border lg:border-slate-800/90 lg:bg-slate-900/30"
		>
			<div class="border-b border-slate-800/80 p-3">
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
					/>
					<input
						type="search"
						bind:value={toolFilter}
						placeholder="Filter tools…"
						class="ui-input py-2 pl-9 text-xs"
						aria-label="Filter tools"
					/>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-2">
				{#if toolsLoading}
					<div class="space-y-2 p-2">
						{#each Array(6) as _}
							<div class="h-12 animate-pulse rounded-xl bg-slate-800/60"></div>
						{/each}
					</div>
				{:else if tools.length === 0}
					<div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
						<AlertCircle class="h-8 w-8 text-red-400/80" />
						<p class="text-sm text-red-300">Could not load tools</p>
						<p class="text-xs text-slate-500">Is the MCP server running?</p>
					</div>
				{:else if filteredTools.length === 0}
					<p class="px-3 py-8 text-center text-xs text-slate-500">No tools match “{toolFilter}”</p>
				{:else}
					<div class="space-y-0.5">
						{#each filteredTools as tool}
							{@const on = selectedTool?.name === tool.name}
							<button
								onclick={() => selectTool(tool)}
								class="group w-full rounded-xl px-3 py-2.5 text-left transition
									{on ? 'bg-sky-500/12 ring-1 ring-sky-500/35' : 'hover:bg-slate-800/70'}"
							>
								<div
									class="font-mono text-[12px] font-medium tracking-tight
									{on ? 'text-sky-200' : 'text-slate-300 group-hover:text-slate-100'}"
								>
									{tool.name}
								</div>
								<p
									class="mt-0.5 line-clamp-1 text-[11px] leading-snug
									{on ? 'text-sky-300/60' : 'text-slate-600 group-hover:text-slate-500'}"
								>
									{shortDesc(tool.description)}
								</p>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</aside>

		<!-- Form + result -->
		<div class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row lg:gap-4">
			<!-- Form panel -->
			<section
				class="flex min-h-0 flex-col overflow-hidden border-b border-slate-800/90 lg:w-[44%] lg:rounded-2xl lg:border lg:border-slate-800/90 lg:bg-slate-900/30"
			>
				{#if selectedTool}
					<div class="border-b border-slate-800/80 px-5 py-4">
						<div class="flex items-start gap-3">
							<div
								class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-500/30"
							>
								<Terminal class="h-4 w-4 text-sky-300" />
							</div>
							<div class="min-w-0">
								<h2 class="truncate font-mono text-base font-semibold text-slate-100">
									{selectedTool.name}
								</h2>
								<p class="mt-1 text-sm leading-relaxed text-slate-400">
									{selectedTool.description}
								</p>
								<div class="mt-2.5 flex flex-wrap gap-1.5">
									<span class="ui-chip py-0.5 text-[10px]">
										{paramEntries.length} param{paramEntries.length === 1 ? '' : 's'}
									</span>
									{#if requiredCount > 0}
										<span
											class="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[10px] text-rose-300 ring-1 ring-rose-500/25"
										>
											{requiredCount} required
										</span>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<form
						onsubmit={(e) => {
							e.preventDefault();
							runTool();
						}}
						class="flex min-h-0 flex-1 flex-col"
					>
						<div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
							{#if paramEntries.length === 0}
								<p
									class="rounded-xl bg-slate-950/50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-800"
								>
									No parameters — run as-is.
								</p>
							{:else}
								{#each paramEntries as [key, schema]}
									{@const fieldId = `param-${key}`}
									<div class="space-y-1.5">
										<div class="flex items-baseline justify-between gap-2">
											<label
												for={fieldId}
												class="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
											>
												<span class="font-mono">{key}</span>
												{#if isRequired(selectedTool, key)}
													<span class="text-rose-400" title="Required">*</span>
												{/if}
											</label>
											{#if schema.type}
												<span
													class="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
													>{schema.type}</span
												>
											{/if}
										</div>
										{#if schema.description}
											<p class="text-[11px] leading-relaxed text-slate-500">{schema.description}</p>
										{/if}

										{#if getInputType(schema) === 'select' && schema.enum}
											<select id={fieldId} bind:value={formValues[key]} class="ui-input">
												{#each schema.enum as opt}
													<option value={opt}>{opt}</option>
												{/each}
											</select>
										{:else if getInputType(schema) === 'checkbox'}
											<select id={fieldId} bind:value={formValues[key]} class="ui-input">
												<option value="true">true</option>
												<option value="false">false</option>
											</select>
										{:else if getInputType(schema) === 'number'}
											<input
												id={fieldId}
												type="number"
												bind:value={formValues[key]}
												placeholder={String(schema.default ?? '')}
												class="ui-input"
											/>
										{:else}
											<input
												id={fieldId}
												type="text"
												bind:value={formValues[key]}
												placeholder={schema.default !== undefined ? String(schema.default) : key}
												class="ui-input"
											/>
										{/if}
									</div>
								{/each}
							{/if}
						</div>

						<div
							class="sticky bottom-0 border-t border-slate-800/80 bg-slate-950/80 px-5 py-3 backdrop-blur-md"
						>
							<button
								type="submit"
								disabled={isLoading}
								class="ui-btn ui-btn-solid w-full gap-2 py-2.5 text-sm shadow-lg shadow-sky-950/40"
							>
								{#if isLoading}
									<Loader2 class="h-4 w-4 animate-spin" />
									Running…
								{:else}
									<Play class="h-4 w-4 fill-current" />
									Run tool
								{/if}
							</button>
						</div>
					</form>
				{:else}
					<div
						class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
					>
						<div
							class="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80 ring-1 ring-slate-700"
						>
							<Wrench class="h-5 w-5 text-slate-500" />
						</div>
						<p class="text-sm text-slate-400">Select a tool to configure parameters</p>
					</div>
				{/if}
			</section>

			<!-- Result panel -->
			<section
				class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:rounded-2xl lg:border lg:border-slate-800/90 lg:bg-slate-900/20"
			>
				<div
					class="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase"
							>Response</span
						>
						{#if isLoading}
							<span
								class="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/30"
							>
								<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400"></span>
								Running
							</span>
						{:else if error}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-medium text-red-300 ring-1 ring-red-500/30"
							>
								<AlertCircle class="h-3 w-3" />
								Error
							</span>
						{:else if isToolError}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30"
							>
								<AlertTriangle class="h-3 w-3" />
								Tool error
							</span>
						{:else if result}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30"
							>
								<Check class="h-3 w-3" />
								OK
							</span>
						{/if}
						{#if latencyMs > 0}
							<span class="font-mono text-[11px] text-slate-500">{latencyMs}ms</span>
						{/if}
						{#if requestId}
							<span class="font-mono text-[11px] text-slate-600">#{requestId.slice(0, 8)}</span>
						{/if}
					</div>

					{#if rawResult}
						<div class="flex items-center gap-2">
							<div class="flex overflow-hidden rounded-lg bg-slate-950/60 ring-1 ring-slate-700/80">
								<button
									onclick={() => (activeTab = 'tree')}
									class="px-3 py-1 text-[11px] font-medium transition
									{activeTab === 'tree' ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:text-slate-200'}"
								>
									Tree
								</button>
								<button
									onclick={() => (activeTab = 'raw')}
									class="px-3 py-1 text-[11px] font-medium transition
									{activeTab === 'raw' ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:text-slate-200'}"
								>
									Raw
								</button>
							</div>
							<button
								onclick={copyToClipboard}
								class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-slate-700/80 transition hover:bg-slate-800 hover:text-slate-200"
								title="Copy raw JSON"
								aria-label="Copy raw JSON"
							>
								{#if copyDone}
									<Check class="h-3 w-3 text-emerald-400" />
									<span class="text-emerald-400">Copied</span>
								{:else}
									<Copy class="h-3 w-3" />
									<span>Copy</span>
								{/if}
							</button>
						</div>
					{/if}
				</div>

				<div class="flex-1 overflow-y-auto p-4 sm:p-5">
					{#if error}
						<div
							class="flex gap-3 rounded-2xl border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-300"
						>
							<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
							<pre class="font-mono text-xs break-all whitespace-pre-wrap">{error}</pre>
						</div>
					{:else if isLoading}
						<div class="flex h-full min-h-[220px] flex-col items-center justify-center gap-4">
							<div class="relative">
								<div
									class="absolute inset-0 animate-ping rounded-full bg-sky-500/20"
									style="animation-duration: 1.6s"
								></div>
								<div
									class="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 ring-1 ring-sky-500/30"
								>
									<Loader2 class="h-6 w-6 animate-spin text-sky-300" />
								</div>
							</div>
							<div class="text-center">
								<p class="text-sm font-medium text-slate-300">Calling tool</p>
								<p class="mt-1 font-mono text-xs text-slate-500">{selectedTool?.name}</p>
							</div>
						</div>
					{:else if rawResult}
						{#if activeTab === 'tree'}
							{@const treeData = extractStructuredResult(result) as JsonValue}
							<div
								class="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4 shadow-inner"
							>
								<JsonViewer value={treeData} depth={0} />
							</div>
						{:else}
							<CodeBlock code={rawResult} lang="json" filename="response.json" />
						{/if}
					{:else}
						<div
							class="flex h-full min-h-[240px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 px-6 py-12 text-center"
						>
							<div
								class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 ring-1 ring-slate-800"
							>
								<Terminal class="h-6 w-6 text-slate-600" />
							</div>
							<div>
								<p class="text-sm font-medium text-slate-400">No response yet</p>
								<p class="mt-1 max-w-xs text-xs leading-relaxed text-slate-600">
									Configure parameters on the left, then run the tool to inspect the JSON result
									here.
								</p>
							</div>
						</div>
					{/if}
				</div>
			</section>
		</div>
	</div>
</div>
