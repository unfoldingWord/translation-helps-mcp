<script lang="ts">
	/**
	 * TranslationNotesPanel — scrollable list of TranslationNoteCards with filter chips.
	 *
	 * Accepts a `translation_notes` UIComponent and renders a filterable list.
	 */

	import TranslationNoteCard from './TranslationNoteCard.svelte';

	interface Note {
		id: string;
		quote?: string;
		noteText: string;
		supportReference?: string;
		category?: string;
		verse?: string;
	}

	export let reference = '';
	export let notes: Note[] = [];

	let filterCategory = 'all';

	$: categories = ['all', ...new Set(notes.map((n) => n.category).filter(Boolean) as string[])];
	$: filtered =
		filterCategory === 'all' ? notes : notes.filter((n) => n.category === filterCategory);

	function chipClass(cat: string): string {
		const active =
			'rounded-full px-2.5 py-0.5 text-xs font-medium border border-indigo-500 bg-indigo-950 text-indigo-300';
		const inactive =
			'rounded-full px-2.5 py-0.5 text-xs font-medium border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors';
		return filterCategory === cat ? active : inactive;
	}
</script>

<div class="flex h-full flex-col">
	<!-- Header -->
	<div class="flex shrink-0 items-center justify-between border-b border-gray-700/60 px-3 py-2">
		<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Translation Notes</p>
		{#if reference}
			<span class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-300">
				{reference}
			</span>
		{/if}
	</div>

	<!-- Filter chips -->
	{#if categories.length > 2}
		<div class="flex shrink-0 flex-wrap gap-1.5 border-b border-gray-700/40 px-3 py-2">
			{#each categories as cat}
				<button class={chipClass(cat)} on:click={() => (filterCategory = cat)}>
					{cat === 'all' ? `All (${notes.length})` : cat}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Notes list -->
	<div class="flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center text-gray-500">
				<p class="text-2xl">📝</p>
				<p class="mt-2 text-sm">No notes for this filter</p>
			</div>
		{:else}
			{#each filtered as note (note.id)}
				<TranslationNoteCard {note} />
			{/each}
		{/if}
	</div>
</div>
