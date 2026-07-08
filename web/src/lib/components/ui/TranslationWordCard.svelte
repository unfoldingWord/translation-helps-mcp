<script lang="ts">
	/**
	 * TranslationWordCard — compact card for a single translation word entry.
	 *
	 * Shows the term as a heading, an optional original-language string,
	 * a short markdown excerpt from the TW article, and a link to read more.
	 */

	import { renderMarkdown } from '$lib/renderMarkdown.js';

	interface Word {
		id: string;
		term: string;
		definition?: string;
		verse?: string;
		origWords?: string;
		wordPath?: string;
	}

	export let word: Word;

	function renderMarkdownTruncated(text: string): string {
		const truncated = text.length > 400 ? text.slice(0, 400).replace(/\s\S*$/, '…') : text;
		return renderMarkdown(truncated);
	}

	function articleHref(path?: string): string {
		if (!path) return '#';
		// Construct a plausible unfoldingWord TW URL
		return `https://www.unfoldingword.org/utw/${path}`;
	}
</script>

<div
	class="flex flex-col gap-1.5 rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 text-sm"
>
	<!-- Header -->
	<div class="flex items-start justify-between gap-2">
		<div>
			<p class="font-semibold text-amber-200">{word.term}</p>
			{#if word.origWords}
				<p class="text-xs text-amber-400/70 italic">{word.origWords}</p>
			{/if}
		</div>
		{#if word.verse}
			<span class="shrink-0 rounded bg-gray-700/60 px-1.5 py-0.5 font-mono text-xs text-gray-400">
				v.{word.verse}
			</span>
		{/if}
	</div>

	<!-- Definition excerpt -->
	{#if word.definition}
		<div
			class="prose prose-invert prose-xs max-w-none text-gray-400
				[&_h1]:hidden [&_h2]:hidden [&_h3]:hidden [&_p]:mb-0.5 [&_p:last-child]:mb-0"
		>
			{@html renderMarkdownTruncated(word.definition)}
		</div>
	{/if}

	<!-- Read full article link -->
	{#if word.wordPath}
		<a
			href={articleHref(word.wordPath)}
			target="_blank"
			rel="noopener noreferrer"
			class="mt-0.5 self-start text-xs text-amber-400/80 underline-offset-2 hover:underline"
		>
			Read full article ↗
		</a>
	{/if}
</div>
