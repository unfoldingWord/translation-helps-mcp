<script lang="ts">
	/**
	 * TranslationWordCard — compact card for a single translation word entry.
	 *
	 * Shows the term as a heading, an optional original-language string,
	 * a short markdown excerpt from the TW article, and a "read more" action.
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
	export let selected = false;
	export let threadCount = 0;
	export let onSelect: ((word: Word) => void) | undefined = undefined;

	function renderMarkdownTruncated(text: string): string {
		const truncated = text.length > 400 ? text.slice(0, 400).replace(/\s\S*$/, '…') : text;
		return renderMarkdown(truncated);
	}

	function handleClick() {
		onSelect?.(word);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleClick();
		}
	}
</script>

<!-- div (not <button>) so the "read more" affordance inside stays valid, clickable HTML. -->
<div
	role="button"
	tabindex="0"
	on:click={handleClick}
	on:keydown={handleKeydown}
	class="relative flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left text-sm transition-all
		{selected
		? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/30'
		: 'border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:shadow-sm'}"
>
	{#if threadCount > 0}
		<span
			class="absolute top-2 right-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white"
		>
			{threadCount}
		</span>
	{/if}

	<div class="flex items-start justify-between gap-2">
		<div>
			<p class="font-semibold text-amber-900">{word.term}</p>
			{#if word.origWords}
				<p class="text-xs text-amber-700/80 italic">{word.origWords}</p>
			{/if}
		</div>
		{#if word.verse}
			<span class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
				v.{word.verse}
			</span>
		{/if}
	</div>

	{#if word.definition}
		<div class="tw-prose">
			{@html renderMarkdownTruncated(word.definition)}
		</div>
	{/if}

	{#if word.wordPath}
		<span
			class="mt-0.5 self-start text-xs font-medium text-amber-700 underline-offset-2 hover:underline"
		>
			Read full article ↗
		</span>
	{/if}
</div>

<style>
	:global(.tw-prose) {
		color: #4a463f;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	:global(.tw-prose h1),
	:global(.tw-prose h2),
	:global(.tw-prose h3) {
		display: none;
	}
	:global(.tw-prose p) {
		margin: 0 0 0.35rem;
	}
	:global(.tw-prose p:last-child) {
		margin-bottom: 0;
	}
	:global(.tw-prose strong) {
		font-weight: 700;
		color: #1f1f1f;
	}
	:global(.tw-prose em) {
		font-style: italic;
		color: #85693e;
	}
</style>
