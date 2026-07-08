<script lang="ts">
	/**
	 * TranslationWordsPanel — grid of TranslationWordCards.
	 *
	 * Accepts a `translation_words` UIComponent and renders key terms.
	 */

	import TranslationWordCard from './TranslationWordCard.svelte';

	interface Word {
		id: string;
		term: string;
		definition?: string;
		verse?: string;
		origWords?: string;
		wordPath?: string;
	}

	export let reference = '';
	export let words: Word[] = [];
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex shrink-0 items-center justify-between border-b border-gray-700/60 px-3 py-2">
		<p class="text-xs font-semibold tracking-wider text-amber-400 uppercase">Key Terms</p>
		{#if reference}
			<span class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-300">
				{reference}
			</span>
		{/if}
	</div>

	<!-- Words grid -->
	<div class="flex-1 overflow-y-auto p-3">
		{#if words.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center text-gray-500">
				<p class="text-2xl">📖</p>
				<p class="mt-2 text-sm">No key terms loaded</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				{#each words as word (word.id)}
					<TranslationWordCard {word} />
				{/each}
			</div>
		{/if}
	</div>
</div>
