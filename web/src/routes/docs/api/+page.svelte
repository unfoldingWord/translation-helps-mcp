<script lang="ts">
	import { base } from '$app/paths';
	import { ExternalLink } from 'lucide-svelte';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import CopyPill from '$lib/components/CopyPill.svelte';
	import { API, SITE } from '$lib/site';

	let { data } = $props();
	const manifest = $derived(data.manifest);

	const apiBase = $derived(`${API.origin}${manifest.basePath}`);
	/** Notes in the manifest mark code with backticks. */
	const pieces = (text: string) => text.split('`').map((t, i) => ({ text: t, code: i % 2 === 1 }));
	const slug = (path: string) => 'ep-' + path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
	const fullUrl = (exampleRequest: string) => `${API.origin}${exampleRequest}`;
	const errorShape = `{\n  "error": {\n    "code": "RATE_LIMITED",\n    "message": "…",\n    "retryable": true\n  }\n}`;
</script>

<svelte:head>
	<title>REST API · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="The Translation Helps REST API: every endpoint, its parameters and an example answer. GET requests, JSON answers, no key."
	/>
</svelte:head>

{#snippet rich(text: string)}
	{#each pieces(text) as piece, i (i)}{#if piece.code}<code>{piece.text}</code
			>{:else}{piece.text}{/if}{/each}
{/snippet}

<h1>REST API</h1>
<p>
	The same data as the MCP tools, over plain HTTP: GET requests that answer in JSON, with no key or
	account. The MCP tools call this API underneath, so the two always agree. Use it from an app, a
	script, or anything that does not speak MCP.
</p>

<div class="mt-5 min-w-0"><CopyPill value={apiBase} label="Copy the API base URL" /></div>
<p class="text-sm">
	The list of endpoints below is also served by the API itself, at <code>GET /api/v1/_manifest</code
	>. Answers carry open CORS headers, so a browser page can call them. The same
	<a href="{base}/docs/limits">rate limit</a> applies.
</p>

<h2>Errors</h2>
<p>
	A failed request answers with a 4xx or 5xx status and this body. <code>retryable</code> tells you whether
	trying again can help.
</p>
<div class="mt-3"><CodeTabs tabs={[{ label: 'JSON', code: errorShape }]} /></div>

<h2>Endpoints</h2>
<ul class="grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 sm:grid-cols-2">
	{#each manifest.endpoints as ep (ep.path)}
		<li class="mt-0 min-w-0">
			<a class="font-mono text-sm break-all" href="#{slug(ep.path)}">{ep.path}</a>
			<span class="text-ink-2 text-xs"> · {ep.summary}</span>
		</li>
	{/each}
</ul>

{#each manifest.endpoints as ep (ep.path)}
	<section
		id={slug(ep.path)}
		class="border-line bg-surface mt-6 scroll-mt-20 rounded-lg border p-4 sm:p-5"
	>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<span class="border-line-strong text-ink-2 rounded border px-1.5 font-mono text-xs"
				>{ep.method}</span
			>
			<h3 class="text-ink mt-0 font-mono text-base break-all">{manifest.basePath}{ep.path}</h3>
		</div>
		<p class="text-ink mt-2">{ep.summary}</p>
		<p class="mt-1 text-sm">{@render rich(ep.description)}</p>
		{#if ep.adapts.length}
			<p class="mt-2 text-xs">Reads from: {ep.adapts.join(' · ')}</p>
		{/if}

		{#if ep.params.length}
			<h4 class="text-ink-2 mt-5 text-xs font-medium tracking-wide uppercase">Parameters</h4>
			<ul class="divide-line mt-2 list-none divide-y p-0">
				{#each ep.params as p (p.name)}
					<li class="mt-0 py-2.5 first:pt-0">
						<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<code class="text-[13px]">{p.name}</code>
							<span class="text-ink-2 font-mono text-xs">{p.type} · {p.in}</span>
							<span class="text-xs {p.required ? 'text-accent-2' : 'text-ink-2'}"
								>{p.required ? 'required' : 'optional'}</span
							>
							{#if p.default !== undefined}
								<span class="text-ink-2 text-xs">default <code>{String(p.default)}</code></span>
							{/if}
						</div>
						<p class="mt-1 text-sm">{@render rich(p.description)}</p>
					</li>
				{/each}
			</ul>
		{/if}

		<h4 class="text-ink-2 mt-5 text-xs font-medium tracking-wide uppercase">Example request</h4>
		<div class="mt-2 min-w-0">
			<CodeTabs tabs={[{ label: 'curl', code: `curl "${fullUrl(ep.exampleRequest)}"` }]} />
		</div>
		{#if ep.method === 'GET'}
			<p class="mt-2 text-sm">
				<a class="inline-flex items-center gap-1" href={fullUrl(ep.exampleRequest)}>
					Open in your browser <ExternalLink size={12} />
				</a>
			</p>
		{/if}

		{#if ep.exampleResponse !== undefined}
			<details class="mt-3">
				<summary class="text-ink-2 hover:text-ink cursor-pointer text-sm">Example response</summary>
				<pre
					class="border-line bg-bg text-ink mt-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">{JSON.stringify(
						ep.exampleResponse,
						null,
						2
					)}</pre>
				{#if ep.responseNotes?.length}
					<ul class="text-sm">
						{#each ep.responseNotes as note (note)}<li>{@render rich(note)}</li>{/each}
					</ul>
				{/if}
			</details>
		{/if}
	</section>
{/each}
