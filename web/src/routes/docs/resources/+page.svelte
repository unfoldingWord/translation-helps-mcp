<script lang="ts">
	import { base } from '$app/paths';
	import { ExternalLink } from 'lucide-svelte';
	import { LICENCE, RESOURCES } from '$lib/resources';
	import { SITE } from '$lib/site';

	const DOOR43 = 'https://git.door43.org/unfoldingWord';
	const original = [
		{ name: 'UGNT', text: 'Greek New Testament', href: `${DOOR43}/el-x-koine_ugnt` },
		{ name: 'UHB', text: 'Hebrew Bible', href: `${DOOR43}/hbo_uhb` }
	];
	const obsHelps = [
		{ name: 'Open Bible Stories notes', tool: 'get_obs_notes', href: `${DOOR43}/en_obs-tn` },
		{
			name: 'Open Bible Stories questions',
			tool: 'get_obs_questions',
			href: `${DOOR43}/en_obs-tq`
		},
		{
			name: 'Open Bible Stories study notes',
			tool: 'get_obs_study_notes',
			href: `${DOOR43}/en_obs-sn`
		},
		{
			name: 'Open Bible Stories study questions',
			tool: 'get_obs_study_questions',
			href: `${DOOR43}/en_obs-sq`
		}
	];
</script>

<svelte:head>
	<title>Resources · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="The unfoldingWord resources this server serves: the ULT and UST, translation notes, key terms, questions, the Academy and Open Bible Stories."
	/>
</svelte:head>

<h1>Resources</h1>
<p>
	Many Bible translators do not read Greek or Hebrew. unfoldingWord writes a set of open resources
	that fill the gap, and this server serves them. They are written in English; teams translate them
	into other languages, and the same tools return those versions when they exist (see
	<a href="{base}/docs/languages">Languages</a>).
</p>
<p>
	Everything below is published on Door43 under <a href={LICENCE.href}>{LICENCE.name}</a>: you may
	share and adapt it, with credit, under the same licence. The server reads the published text and
	passes it on. It writes none of its own.
</p>

<ul class="mt-8 list-none p-0">
	{#each RESOURCES as r (r.id)}
		<li id={r.id} class="border-line bg-surface mt-4 scroll-mt-20 rounded-lg border p-4 sm:p-5">
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span class="text-accent font-mono text-xl font-semibold">{r.short}</span>
				<h2 class="text-ink mt-0 text-lg">{r.name}</h2>
			</div>
			<p class="text-ink mt-2">{r.summary}</p>
			<dl class="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
				<dt class="text-ink-2">Who it is for</dt>
				<dd class="text-ink-2">{r.forWhom}</dd>
				<dt class="text-ink-2">Tool</dt>
				<dd class="min-w-0">
					<a class="font-mono" href="{base}/tools#{r.tool}">{r.tool}</a>
				</dd>
				<dt class="text-ink-2">Licence</dt>
				<dd><a href={LICENCE.href}>{LICENCE.name}</a></dd>
				<dt class="text-ink-2">Source</dt>
				<dd class="min-w-0">
					<a class="inline-flex items-center gap-1" href={r.door43}>
						Door43 <ExternalLink size={12} />
					</a>
				</dd>
			</dl>
		</li>
	{/each}
</ul>

<h2>Also in the answers</h2>
<p>
	<span class="text-ink">The original text.</span>
	<code>get_passage</code> returns the Greek or Hebrew with the two English texts, so a translator
	can see what each note is about. The sources are the <a href={original[0].href}>UGNT</a> (Greek
	New Testament) and the <a href={original[1].href}>UHB</a> (Hebrew Bible).
</p>
<p>
	<span class="text-ink">Open Bible Stories has its own helps.</span> A story comes with translation
	notes and questions, and study notes and questions, of its own, from separate tools:
</p>
<ul>
	{#each obsHelps as h (h.tool)}
		<li>
			{h.name}: <a class="font-mono" href="{base}/tools#{h.tool}">{h.tool}</a>
			(<a href={h.href}>Door43</a>)
		</li>
	{/each}
</ul>
<p>
	Find the lessons and key terms by topic with <a
		class="font-mono"
		href="{base}/tools#search_articles">search_articles</a
	>. To see the helps working on a real verse, <a href="{base}/try">walk through a passage</a>.
</p>
