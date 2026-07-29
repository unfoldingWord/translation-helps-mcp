<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import DocHeader from '$lib/components/docs/DocHeader.svelte';
	import { ExternalLink } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const manifest = $derived(data.manifest);

	const API_ORIGIN = 'https://translation-helps-api-v2.unfoldingword.workers.dev';

	function tryUrl(exampleRequest: string): string {
		return `${API_ORIGIN}${exampleRequest}`;
	}

	function methodClass(method: string): string {
		if (method === 'GET') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
		if (method === 'POST') return 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
		return 'bg-slate-700 text-slate-200';
	}
</script>

<svelte:head>
	<title>REST API — Docs</title>
</svelte:head>

<DocHeader eyebrow="HTTP" title="REST API" description={manifest.description} />

<div
	class="mb-8 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm leading-relaxed text-slate-300"
>
	Data layer used by the
	<a
		href={withBase('/docs/mcp')}
		class="font-medium text-sky-300 underline-offset-2 hover:underline">MCP tools</a
	>
	via <code>ApiClient</code>. Also available for apps that prefer plain HTTP.
</div>

<div class="mb-8 flex flex-wrap gap-2 text-sm">
	<span
		class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
	>
		<span class="text-slate-500">Base</span>
		<code class="text-emerald-300">{manifest.basePath}</code>
	</span>
	<span
		class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
	>
		<span class="text-slate-500">Library</span>
		<code class="text-sky-300">{manifest.library}</code>
	</span>
	<span
		class="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
	>
		<span class="text-slate-500">Manifest</span>
		<code class="text-emerald-300">GET {manifest.basePath}/_manifest</code>
	</span>
</div>

<div
	class="mb-10 rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900/80 to-slate-950 px-4 py-3 text-sm"
>
	<span class="text-slate-500">Public base</span>
	<code class="ml-2 break-all text-emerald-300">{API_ORIGIN}</code>
</div>

{#each manifest.endpoints as ep}
	<article
		class="mb-5 overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/40 shadow-sm shadow-black/20"
	>
		<div class="border-b border-slate-800/80 px-5 py-4">
			<div class="mb-2 flex flex-wrap items-center gap-2">
				<span
					class="rounded-md px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide ring-1 {methodClass(
						ep.method
					)}">{ep.method}</span
				>
				<code class="font-mono text-sm text-slate-100">{manifest.basePath}{ep.path}</code>
			</div>
			<h2 class="!mt-0 !border-0 !pb-0 text-lg !font-semibold text-slate-100">{ep.summary}</h2>
			<p class="mt-2 text-sm leading-relaxed text-slate-400">{ep.description}</p>
			{#if ep.adapts.length}
				<p class="mt-2 text-xs text-slate-500">
					Adapts <span class="text-slate-400">{ep.adapts.join(' · ')}</span>
				</p>
			{/if}
		</div>

		{#if ep.params.length}
			<div class="overflow-x-auto px-5 py-3">
				<table class="w-full text-left text-xs">
					<thead class="text-[10px] tracking-wider text-slate-500 uppercase">
						<tr>
							<th class="py-2 pr-3 font-medium">Param</th>
							<th class="py-2 pr-3 font-medium">In</th>
							<th class="py-2 pr-3 font-medium">Type</th>
							<th class="py-2 font-medium">Description</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-800/80 text-slate-300">
						{#each ep.params as p}
							<tr>
								<td class="py-2 pr-3 font-mono text-sky-300">
									{p.name}{#if p.required}<span class="text-amber-400">*</span>{/if}
								</td>
								<td class="py-2 pr-3 text-slate-500">{p.in}</td>
								<td class="py-2 pr-3 text-slate-400">{p.type}</td>
								<td class="py-2 leading-relaxed text-slate-400">{p.description}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div
			class="flex flex-wrap items-center gap-3 border-t border-slate-800/80 bg-slate-950/40 px-5 py-3"
		>
			<code
				class="min-w-0 flex-1 truncate rounded-md bg-slate-950 px-2 py-1.5 font-mono text-xs text-emerald-300/95"
				>{ep.exampleRequest}</code
			>
			<a
				href={tryUrl(ep.exampleRequest)}
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30 transition hover:bg-sky-500/25"
			>
				Try it
				<ExternalLink class="h-3 w-3" />
			</a>
		</div>

		{#if ep.exampleResponse !== undefined}
			<div class="border-t border-slate-800/80 px-5 py-4">
				<p class="mb-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
					Example response
				</p>
				<CodeBlock
					code={JSON.stringify(ep.exampleResponse, null, 2)}
					lang="json"
					filename="200 OK"
				/>
				{#if ep.responseNotes?.length}
					<ul class="mt-3 space-y-1 text-xs leading-relaxed text-slate-500">
						{#each ep.responseNotes as note}
							<li class="flex gap-2">
								<span class="shrink-0 text-slate-600">•</span>
								<span>{note}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</article>
{/each}

<section class="mt-10">
	<h2>Fetch the live manifest</h2>
	<CodeBlock code={`curl "${API_ORIGIN}/api/v1/_manifest"`} lang="bash" filename="terminal" />
</section>
