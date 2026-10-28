<script lang="ts">
	import { base } from '$app/paths';
	import { ArrowRight } from 'lucide-svelte';
	import { DOCS_PAGES } from '$lib/docs/pages';
	import { SITE } from '$lib/site';
	import { LICENCE } from '$lib/resources';
</script>

<svelte:head>
	<title>Docs · {SITE.name}</title>
	<meta
		name="description"
		content="What the translation helps are, the order to use them in, the REST API, the SDKs, languages, and the limits."
	/>
</svelte:head>

<h1>Docs</h1>
<p>
	{SITE.name} gives AI assistants and apps unfoldingWord’s translation helps from Door43. These pages
	explain what the helps are and how to use the server, whether you are setting up a connection or deciding
	what to ask for.
</p>

<ul class="mt-8 list-none p-0">
	{#each DOCS_PAGES as p (p.href)}
		<li class="border-line mt-0 border-t first:border-t-0">
			<a
				href="{base}{p.href}"
				class="group hover:bg-surface -mx-3 flex items-start justify-between gap-4 rounded-md px-3 py-4"
			>
				<span class="min-w-0">
					<span class="text-ink block font-semibold">{p.label}</span>
					<span class="text-ink-2 mt-0.5 block text-sm">{p.summary}</span>
				</span>
				<ArrowRight size={16} class="text-ink-2 group-hover:text-accent mt-1 shrink-0" />
			</a>
		</li>
	{/each}
</ul>

<h2>Looking for something else?</h2>
<ul>
	<li><a href="{base}/connect">Connect</a>: add the server to your assistant, or call the API.</li>
	<li><a href="{base}/tools">Tools</a>: every tool, its arguments and an example call.</li>
	<li><a href="{base}/try">Try</a>: run the tools in your browser, with no assistant.</li>
</ul>
<p>
	The content is unfoldingWord’s, published under <a href={LICENCE.href}>{LICENCE.name}</a>. The
	code is in
	<a href={SITE.repo}>the GitHub repository</a>.
</p>
