<script lang="ts">
	/**
	 * TranslationWordsPanel — grid of TranslationWordCards.
	 */

	import TranslationWordCard from './TranslationWordCard.svelte';
	import { studySession, resourceKey, type ResourcePayload } from '$lib/stores/studySession.js';

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
	export let onSelectWord: ((payload: ResourcePayload) => void) | undefined = undefined;

	$: selectedKey = $studySession.scope.kind === 'resource' ? $studySession.scope.key : null;

	function handleSelect(word: Word) {
		const payload: ResourcePayload = {
			kind: 'word',
			word: {
				term: word.term,
				path: word.wordPath,
				definition: word.definition,
				verse: word.verse,
				origWords: word.origWords
			}
		};
		onSelectWord?.(payload);
	}

	function wordKey(word: Word): string {
		return resourceKey({
			kind: 'word',
			word: { term: word.term, path: word.wordPath }
		});
	}

	function wordThreadCount(word: Word): number {
		return ($studySession.resourceThreads[wordKey(word)] ?? []).length;
	}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex shrink-0 items-center justify-between border-b border-[var(--bt-border)] bg-[var(--bt-parchment)] px-3 py-2"
	>
		<p class="text-xs font-semibold tracking-wider text-amber-800 uppercase">Key Terms</p>
		{#if reference}
			<span
				class="rounded bg-[var(--bt-black)] px-2 py-0.5 font-mono text-xs text-[var(--bt-cream)]"
			>
				{reference}
			</span>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-3">
		{#if words.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center text-gray-500">
				<p class="text-2xl">📖</p>
				<p class="mt-2 text-sm">No key terms loaded</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
				{#each words as word (word.id)}
					<div data-panel-id={word.id} data-panel-path={word.wordPath ?? ''}>
						<TranslationWordCard
							{word}
							selected={selectedKey === wordKey(word)}
							threadCount={wordThreadCount(word)}
							onSelect={handleSelect}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
