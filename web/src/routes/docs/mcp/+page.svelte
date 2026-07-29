<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import DocHeader from '$lib/components/docs/DocHeader.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const manifest = $derived(data.manifest);

	let openTool = $state<string | null>(null);

	function propEntries(schema: unknown): Array<[string, { type?: string; description?: string }]> {
		const s = schema as { properties?: Record<string, { type?: string; description?: string }> };
		return Object.entries(s?.properties ?? {});
	}

	function requiredOf(schema: unknown): string[] {
		const s = schema as { required?: string[] };
		return s?.required ?? [];
	}

	function toggle(name: string) {
		openTool = openTool === name ? null : name;
	}

	const claudeConfig = `{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tc-helps.mcp.servant.bible/v2/mcp"]
    }
  }
}`;

	const cursorConfig = `{
  "mcpServers": {
    "translation-helps": {
      "url": "https://tc-helps.mcp.servant.bible/v2/mcp"
    }
  }
}`;

	const categoryTone: Record<string, string> = {
		workflow: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
		obs: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
		discovery: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
	};
</script>

<svelte:head>
	<title>MCP server — Docs</title>
</svelte:head>

<DocHeader eyebrow="MCP" title="Tools & prompts" description={manifest.description} />

<div class="mb-8 flex flex-wrap gap-2 text-sm">
	<span
		class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
	>
		<span class="text-slate-500">Endpoint</span>
		<code class="text-emerald-300">{manifest.mcpEndpoint}</code>
	</span>
	<span
		class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
	>
		<span class="text-slate-500">Manifest</span>
		<code class="text-emerald-300">GET /v2/api/mcp-manifest</code>
	</span>
	<a
		href={withBase('/playground')}
		class="inline-flex items-center rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sky-200 hover:bg-sky-500/20"
	>
		Open Playground →
	</a>
</div>

<section class="mb-12">
	<h2>Connect</h2>
	<div class="grid gap-4 lg:grid-cols-2">
		<div>
			<p class="mb-2 text-sm font-medium text-slate-300">Claude Desktop</p>
			<CodeBlock code={claudeConfig} lang="json" filename="claude_desktop_config.json" />
		</div>
		<div>
			<p class="mb-2 text-sm font-medium text-slate-300">Cursor</p>
			<CodeBlock code={cursorConfig} lang="json" filename=".cursor/mcp.json" />
		</div>
	</div>
</section>

{#if manifest.resultEnvelope}
	<section class="mb-12">
		<h2>Result envelope</h2>
		<p class="mb-4 text-sm leading-relaxed text-slate-400">
			{manifest.resultEnvelope.description}
		</p>
		<div class="grid gap-4 lg:grid-cols-2">
			<div>
				<p class="mb-2 text-sm font-medium text-slate-300">Success</p>
				<CodeBlock
					code={JSON.stringify(manifest.resultEnvelope.example, null, 2)}
					lang="json"
					filename="MCP tool result"
				/>
			</div>
			<div>
				<p class="mb-2 text-sm font-medium text-slate-300">Resource not available</p>
				<p class="mb-2 text-xs text-slate-500">
					<code class="text-slate-400">isError: false</code> — missing data is not a server failure.
					Tools with an <code class="text-slate-400">outputSchema</code> declare these fields as optional
					so the envelope still validates.
				</p>
				<CodeBlock
					code={JSON.stringify(manifest.resultEnvelope.notAvailableExample, null, 2)}
					lang="json"
					filename="not available"
				/>
			</div>
		</div>
	</section>
{/if}

<section class="mb-12">
	<h2>Workflow tools ({manifest.tools.length})</h2>
	<p class="mb-4 text-sm text-slate-400">
		Click a tool for parameters, example args, and the <code class="text-slate-300"
			>structuredContent</code
		> response shape.
	</p>
	<div class="space-y-3">
		{#each manifest.tools as tool}
			{@const open = openTool === tool.name}
			<article class="overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40">
				<button
					type="button"
					onclick={() => toggle(tool.name)}
					class="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-900/70"
				>
					<div class="min-w-0 flex-1">
						<div class="mb-1 flex flex-wrap items-center gap-2">
							<a
								href="{withBase('/playground')}?tool={tool.name}"
								onclick={(e) => e.stopPropagation()}
								class="font-mono text-sm font-semibold text-sky-300 hover:underline">{tool.name}</a
							>
							<span
								class="rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ring-1 {categoryTone[
									tool.category
								] ?? categoryTone.workflow}">{tool.category}</span
							>
						</div>
						<p class="text-sm leading-relaxed text-slate-400">{tool.summary}</p>
					</div>
					<span class="mt-1 font-mono text-xs text-slate-500">{open ? '−' : '+'}</span>
				</button>

				{#if open}
					<div class="space-y-4 border-t border-slate-800/80 px-5 py-4">
						<p class="text-xs leading-relaxed text-slate-500">{tool.description}</p>

						{#if propEntries(tool.inputSchema).length}
							<div class="overflow-x-auto rounded-lg border border-slate-800">
								<table class="w-full text-left text-xs">
									<thead
										class="bg-slate-950/60 text-[10px] tracking-wider text-slate-500 uppercase"
									>
										<tr>
											<th class="px-3 py-2 font-medium">Param</th>
											<th class="px-3 py-2 font-medium">Type</th>
											<th class="px-3 py-2 font-medium">Description</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-800 text-slate-300">
										{#each propEntries(tool.inputSchema) as [name, prop]}
											<tr>
												<td class="px-3 py-2 font-mono text-sky-300">
													{name}{#if requiredOf(tool.inputSchema).includes(name)}<span
															class="text-amber-400">*</span
														>{/if}
												</td>
												<td class="px-3 py-2 text-slate-500">{prop.type ?? 'any'}</td>
												<td class="px-3 py-2 leading-relaxed text-slate-400"
													>{prop.description ?? '—'}</td
												>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}

						{#if tool.example}
							<div>
								<p class="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
									Example args
								</p>
								<CodeBlock
									code={JSON.stringify(tool.example, null, 2)}
									lang="json"
									filename="example args"
								/>
							</div>
						{/if}

						{#if tool.exampleResponse !== undefined}
							<div>
								<p class="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
									Example structuredContent
								</p>
								<CodeBlock
									code={JSON.stringify(tool.exampleResponse, null, 2)}
									lang="json"
									filename="structuredContent"
								/>
								{#if tool.responseNotes?.length}
									<ul class="mt-3 space-y-1 text-xs leading-relaxed text-slate-500">
										{#each tool.responseNotes as note}
											<li class="flex gap-2">
												<span class="shrink-0 text-slate-600">•</span>
												<span>{note}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}

						{#if tool.outputSchema && propEntries(tool.outputSchema).length}
							<div>
								<p class="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
									Output schema
								</p>
								<div class="overflow-x-auto rounded-lg border border-slate-800">
									<table class="w-full text-left text-xs">
										<thead
											class="bg-slate-950/60 text-[10px] tracking-wider text-slate-500 uppercase"
										>
											<tr>
												<th class="px-3 py-2 font-medium">Field</th>
												<th class="px-3 py-2 font-medium">Type</th>
												<th class="px-3 py-2 font-medium">Description</th>
											</tr>
										</thead>
										<tbody class="divide-y divide-slate-800 text-slate-300">
											{#each propEntries(tool.outputSchema) as [name, prop]}
												<tr>
													<td class="px-3 py-2 font-mono text-emerald-300">{name}</td>
													<td class="px-3 py-2 text-slate-500">{prop.type ?? 'any'}</td>
													<td class="px-3 py-2 leading-relaxed text-slate-400"
														>{prop.description ?? '—'}</td
													>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</div>
</section>

<section class="mb-12">
	<h2>Prompts ({manifest.prompts.length})</h2>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each manifest.prompts as prompt}
			<article class="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-5">
				<h3 class="mb-2 font-mono text-sm font-semibold text-sky-300">{prompt.name}</h3>
				<p class="mb-3 text-sm leading-relaxed text-slate-400">{prompt.description}</p>
				{#if prompt.arguments.length}
					<ul class="space-y-1 text-xs text-slate-400">
						{#each prompt.arguments as arg}
							<li>
								<code class="text-sky-300">{arg.name}</code>
								{#if arg.required}<span class="text-amber-400">*</span>{/if}
								{#if arg.description}
									<span class="text-slate-500"> — {arg.description}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</article>
		{/each}
	</div>
</section>
