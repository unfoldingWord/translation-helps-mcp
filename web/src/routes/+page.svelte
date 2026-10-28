<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { ArrowRight, ExternalLink } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import CopyPill from '$lib/components/CopyPill.svelte';
	import AlignedQuote from '$lib/components/AlignedQuote.svelte';
	import AnatomyExplorer from '$lib/home/AnatomyExplorer.svelte';
	import { endpoint } from '$lib/endpoint';
	import { SITE } from '$lib/site';
	import { LICENCE, RESOURCES } from '$lib/resources';
	import { PASSAGE, type HomeSnapshot } from '$lib/home/anatomy';
	import snapshotJson from '$lib/home/snapshot.json';

	const snapshot = snapshotJson as HomeSnapshot;
	const UGNT = 'https://git.door43.org/unfoldingWord/el-x-koine_ugnt';
	const ULT = RESOURCES.find((r) => r.id === 'ult')!.door43;

	/** The MCP address of the site being viewed; known only in the browser. */
	let url = $state('');
	onMount(() => {
		url = endpoint();
	});

	const audiences = [
		{
			who: 'For developers',
			title: 'An MCP server and a REST API',
			text: 'Thirteen read-only tools over Streamable HTTP, the same data as a REST API, and SDKs for JavaScript and Python. No key, no sign-up.',
			href: `${base}/connect`,
			link: 'Connect your assistant'
		},
		{
			who: 'For translation teams',
			title: 'The helps you already know',
			text: 'Translation Notes, Words, Questions and Academy, the ULT and the UST, and Open Bible Stories, in English and in other languages on Door43.',
			href: `${base}/try`,
			link: 'Walk through a passage'
		}
	];

	const clients = ['Claude', 'Cursor', 'VS Code', 'ChatGPT'];
</script>

<svelte:head>
	<title>{SITE.name} · {SITE.tagline}</title>
	<meta
		name="description"
		content="An MCP server and REST API that give AI assistants unfoldingWord's Bible translation helps from Door43: notes, key terms, questions, Academy lessons, the ULT and UST. No key needed."
	/>
</svelte:head>

<!-- Hero -->
<section class="relative overflow-hidden">
	<div
		class="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-20 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pb-24"
	>
		<div class="rise min-w-0">
			<p class="text-accent-2 font-mono text-xs tracking-wide uppercase">
				MCP server · REST API · Door43
			</p>
			<h1
				class="text-ink mt-4 text-[3.25rem] leading-[0.98] font-bold tracking-[-0.035em] sm:text-7xl lg:text-[5.25rem]"
			>
				Translation Helps <span class="text-accent">MCP</span>
			</h1>
			<p class="text-ink mt-6 max-w-xl text-xl leading-snug font-medium sm:text-2xl">
				{SITE.tagline}
			</p>
			<p class="text-ink-2 mt-4 max-w-xl text-base">
				Notes, key terms, checking questions and translation lessons for any passage, tied to the
				Greek and Hebrew words they explain. Your assistant asks; the server answers with
				unfoldingWord’s own words from Door43.
			</p>
			<div class="mt-8 flex flex-wrap items-center gap-3">
				<Button variant="primary" href="{base}/try">Try it <ArrowRight size={14} /></Button>
				<Button href="{base}/connect">Connect</Button>
			</div>
			<div class="mt-4 min-h-9">
				{#if url}<CopyPill value={url} label="Copy the server URL" />{/if}
			</div>
		</div>

		<div class="rise rise-2 min-w-0">
			<AlignedQuote
				rows={snapshot.alignment}
				verse={snapshot.verse}
				reference={PASSAGE.reference}
				labels={{ original: 'Greek · UGNT', translation: 'English · ULT' }}
			/>
			<p class="text-ink-2 mt-3 text-xs">
				Each note knows the Greek words it is about and the English words that translate them (<code
					class="font-mono">get_passage_index</code
				>). Text:
				<a class="hover:text-ink underline underline-offset-2" href={UGNT}>UGNT</a> and
				<a class="hover:text-ink underline underline-offset-2" href={ULT}>ULT</a>,
				<a class="hover:text-ink underline underline-offset-2" href={LICENCE.href}>{LICENCE.name}</a
				>.
			</p>
		</div>
	</div>
</section>

<!-- Two audiences -->
<section class="border-line bg-surface border-y" aria-label="Who it is for">
	<div class="mx-auto grid max-w-6xl md:grid-cols-2">
		{#each audiences as a, i (a.who)}
			<div
				class="px-4 py-10 sm:px-8 sm:py-12 {i === 1
					? 'border-line border-t md:border-t-0 md:border-l'
					: ''}"
			>
				<p class="text-accent-2 font-mono text-xs">{a.who}</p>
				<h2 class="text-ink mt-2 text-2xl font-semibold tracking-tight">{a.title}</h2>
				<p class="text-ink-2 mt-3 max-w-md">{a.text}</p>
				<a
					href={a.href}
					class="text-accent mt-4 inline-flex items-center gap-1 text-sm font-medium hover:underline"
					>{a.link} <ArrowRight size={14} /></a
				>
			</div>
		{/each}
	</div>
</section>

<!-- Anatomy -->
<section aria-labelledby="anatomy">
	<div class="mx-auto max-w-6xl px-4 py-20 sm:py-24">
		<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
			<div>
				<p class="text-accent-2 font-mono text-xs">{PASSAGE.reference}</p>
				<h2 id="anatomy" class="text-ink mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
					Anatomy of a passage
				</h2>
			</div>
			<p class="text-ink-2 max-w-lg">
				One verse, five kinds of help, each from its own tool. Pick one to see what the server
				returns. <code class="text-ink font-mono text-sm">get_passage_index</code> lists them all first,
				so an assistant fetches only what it needs.
			</p>
		</div>
		<div class="mt-10"><AnatomyExplorer /></div>
	</div>
</section>

<!-- What are translation helps -->
<section class="bg-surface" aria-labelledby="helps">
	<div class="mx-auto max-w-6xl px-4 py-20 sm:py-24">
		<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
			<h2 id="helps" class="text-ink text-3xl font-bold tracking-tight sm:text-4xl">
				What are translation helps?
			</h2>
			<div class="text-ink-2 space-y-3">
				<p>
					Many Bible translators do not read Greek or Hebrew. Translation helps fill the gap:
					English Bibles made for translators, notes on the hard phrases, articles on key terms,
					lessons on how to translate, and questions to check a draft.
				</p>
				<p>
					unfoldingWord writes them in English and teams translate them into other languages, all
					open under {LICENCE.name}. This server serves the ones below.
				</p>
			</div>
		</div>

		<ul
			class="border-line bg-line mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border lg:grid-cols-4"
		>
			{#each RESOURCES as r (r.id)}
				<li class="bg-surface flex min-w-0 flex-col p-4 sm:p-5">
					<p class="text-accent font-mono text-xl font-semibold tracking-tight sm:text-2xl">
						{r.short}
					</p>
					<h3 class="text-ink mt-1 text-sm font-semibold sm:text-base">{r.name}</h3>
					<p class="text-ink-2 mt-2 text-sm">{r.summary}</p>
					<p class="text-ink-2 mt-2 hidden text-xs sm:block">
						<span class="text-ink">For:</span>
						{r.forWhom}
					</p>
					<div class="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs">
						<code class="text-ink-2 min-w-0 font-mono text-[11px] break-all">{r.tool}</code>
						<a class="text-accent inline-flex items-center gap-1 hover:underline" href={r.door43}
							>Door43 <ExternalLink size={11} /></a
						>
					</div>
				</li>
			{/each}
		</ul>
	</div>
</section>

<!-- Connect in three steps -->
<section class="bg-accent text-on-accent" aria-labelledby="connect">
	<div class="mx-auto max-w-6xl px-4 py-20 sm:py-24">
		<h2 id="connect" class="text-3xl font-bold tracking-tight sm:text-4xl">
			Connect in three steps
		</h2>
		<ol class="mt-10 grid gap-8 md:grid-cols-3">
			<li>
				<p class="font-mono text-sm opacity-80">01</p>
				<h3 class="mt-1 text-xl font-semibold">Copy the server URL</h3>
				<p class="mt-2 opacity-90">One address for every client. Read-only, no key.</p>
				<p class="mt-3 font-mono text-[13px] break-all opacity-90">{url || 'https://…/v2/mcp'}</p>
			</li>
			<li>
				<p class="font-mono text-sm opacity-80">02</p>
				<h3 class="mt-1 text-xl font-semibold">Add it to your assistant</h3>
				<p class="mt-2 opacity-90">
					{clients.join(', ')} or any client that speaks MCP. Prefer plain HTTP? Use the REST API or
					an SDK.
				</p>
			</li>
			<li>
				<p class="font-mono text-sm opacity-80">03</p>
				<h3 class="mt-1 text-xl font-semibold">Ask about a passage</h3>
				<p class="mt-2 opacity-90">“What do the notes say about ‘the world’ in John 3:16?”</p>
			</li>
		</ol>
		<div class="mt-10 flex flex-wrap gap-3">
			<a
				href="{base}/connect"
				class="bg-on-accent text-accent inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
				>Setup for each client <ArrowRight size={14} /></a
			>
			<a
				href="{base}/try"
				class="border-on-accent/40 hover:bg-on-accent/10 inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-semibold"
				>Try it first</a
			>
		</div>
	</div>
</section>

<!-- Official sources -->
<section aria-labelledby="sources">
	<div class="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
		<div>
			<h2 id="sources" class="text-ink text-2xl font-bold tracking-tight">Official sources</h2>
			<p class="text-ink-2 mt-3 text-sm">
				The content is unfoldingWord’s. The server reads it from the Door43 catalog and passes the
				published words on; it writes none of its own.
			</p>
		</div>
		<ul class="grid gap-3 sm:grid-cols-3">
			<li>
				<a
					class="border-line hover:border-line-strong hover:bg-surface block h-full rounded-lg border p-4"
					href="https://unfoldingword.org/"
				>
					<span class="text-ink flex items-center gap-1 font-semibold"
						>unfoldingWord <ExternalLink size={12} /></span
					>
					<span class="text-ink-2 mt-1 block text-sm">Who writes the helps, and why.</span>
				</a>
			</li>
			<li>
				<a
					class="border-line hover:border-line-strong hover:bg-surface block h-full rounded-lg border p-4"
					href={SITE.door43}
				>
					<span class="text-ink flex items-center gap-1 font-semibold"
						>Door43 <ExternalLink size={12} /></span
					>
					<span class="text-ink-2 mt-1 block text-sm">The repositories the server reads.</span>
				</a>
			</li>
			<li>
				<a
					class="border-line hover:border-line-strong hover:bg-surface block h-full rounded-lg border p-4"
					href={LICENCE.href}
				>
					<span class="text-ink flex items-center gap-1 font-semibold"
						>{LICENCE.name} <ExternalLink size={12} /></span
					>
					<span class="text-ink-2 mt-1 block text-sm"
						>Share and adapt, with credit, under the same licence.</span
					>
				</a>
			</li>
		</ul>
	</div>
</section>
