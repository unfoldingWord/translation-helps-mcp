<script lang="ts">
	import { base } from '$app/paths';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { encodeTryState } from '$lib/try/hashState';
	import { SITE } from '$lib/site';

	/** What each tool sends back, field by field (src/mcp/manifest.ts, the tools' output schemas). */
	const languageFields = [
		[
			'languages',
			'A list of { code, name, englishName }. name is the language’s own name, often in its own script.'
		],
		['total_count', 'How many languages match, before paging.'],
		['has_more', 'True when more come after this page.'],
		[
			'limit, offset',
			'The page asked for. Pass filter to narrow the list, for example "es" for Spanish variants.'
		]
	];
	const resourceFields = [
		[
			'available',
			'One row for each kind of resource the language has: type, subject, abbreviation (ult, tn, tw …), role.'
		],
		[
			'language, requestedLanguage',
			'The language answered, which can differ from the one asked after a variant is chosen.'
		],
		[
			'coversBook, books, bookCount',
			'On book-scoped rows: whether the book you asked about is covered.'
		],
		['coverage', 'A note that a resource being listed does not promise every book.']
	];

	const tryLink = (tool: string, args: Record<string, unknown>) =>
		`${base}/try${encodeTryState({ tab: 'tools', tool, args })}`;
	const codeVariants = `"es"      → Spanish\n"spa"     → the same language, by its three-letter code\n"es-419"  → Spanish as used in Latin America`;
</script>

<svelte:head>
	<title>Languages · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="How a language is found, what resources it has, and what a language pack is."
	/>
</svelte:head>

<h1>Languages</h1>
<p>
	English is where the resources start, but they exist in many languages. Two tools say which: one
	lists the languages, the other says what a language has. An assistant should ask them before it
	assumes that English is the answer.
</p>

<h2>Finding a language</h2>
<p>
	<a href="{base}/tools#list_languages"><code>list_languages</code></a> returns the languages that
	have resources ready for translation work in the Door43 catalog. Every other tool takes a
	<code>language</code> code. The server accepts the common forms and settles on the one the catalog
	uses:
</p>
<div class="mt-3 min-w-0"><CodeTabs tabs={[{ label: 'Codes', code: codeVariants }]} /></div>
<dl class="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
	{#each languageFields as [name, text] (name)}
		<dt class="text-ink font-mono text-[13px]">{name}</dt>
		<dd class="text-ink-2">{text}</dd>
	{/each}
</dl>
<p class="text-sm">
	<a href={tryLink('list_languages', { filter: 'es', limit: 20 })}>Try the Spanish variants</a>.
</p>

<h2>What a language has</h2>
<p>
	Not every language has every resource. <a href="{base}/tools#list_resources"
		><code>list_resources</code></a
	>
	lists what one language has, and with a <code>book</code> it says which resources cover that book.
	Many languages publish their own Translation Words and Translation Academy under other organisations
	on Door43, not only unfoldingWord. The server finds the right one from the catalog, so the assistant
	does not need to know where a language lives.
</p>
<dl class="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
	{#each resourceFields as [name, text] (name)}
		<dt class="text-ink font-mono text-[13px]">{name}</dt>
		<dd class="text-ink-2">{text}</dd>
	{/each}
</dl>
<p class="text-sm">
	<a href={tryLink('list_resources', { language: 'en', book: 'TIT' })}
		>Try it for English and Titus</a
	>.
</p>

<h2>Language packs</h2>
<p>
	A language pack is one language’s Door43 resources, prepared ahead of time. The notes, key terms
	and questions are already read and tidied, and each quoted phrase is already matched to the Greek
	or Hebrew word it explains and to the words of the language’s own Bible text. Servos, the offline
	translation app, uses these packs, and this server reads from them too.
</p>
<p>
	When a language or chapter has a pack, the server answers notes and key-term links from it, which
	is faster. Where there is none, it reads Door43 directly instead, so the tool still answers. Which
	languages have a pack grows over time. You do not choose, and no tool argument changes.
</p>

<p class="text-sm">
	See <a href="{base}/docs/resources">Resources</a> for what each help is, and
	<a href="{base}/docs/limits">Limits and errors</a> for what the answer is when a language lacks one.
</p>
