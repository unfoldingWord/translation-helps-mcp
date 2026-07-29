<script lang="ts">
	/**
	 * TranslationNotesPanel — scrollable list of TranslationNoteCards with filter chips.
	 */

	import TranslationNoteCard, { type RcLinkSelection } from './TranslationNoteCard.svelte';
	import { studySession, resourceKey, type ResourcePayload } from '$lib/stores/studySession.js';

	interface Note {
		id: string;
		quote?: string;
		gatewayQuote?: { original?: string; aligned?: string };
		noteText: string;
		supportReference?: string;
		category?: string;
		verse?: string;
	}

	export let reference = '';
	export let notes: Note[] = [];
	export let onSelectNote: ((payload: ResourcePayload) => void) | undefined = undefined;
	/** Optional panel heading (defaults to Translation Notes). */
	export let heading = 'Translation Notes';

	let filterCategory = 'all';

	$: categories = ['all', ...new Set(notes.map((n) => n.category).filter(Boolean) as string[])];
	$: filtered =
		filterCategory === 'all' ? notes : notes.filter((n) => n.category === filterCategory);

	$: selectedKey = $studySession.scope.kind === 'resource' ? $studySession.scope.key : null;

	function chipClass(cat: string): string {
		const active =
			'rounded-full px-2.5 py-0.5 text-xs font-medium border border-sky-600 bg-sky-600 text-white';
		const inactive =
			'rounded-full px-2.5 py-0.5 text-xs font-medium border border-[var(--bt-border)] text-[var(--bt-muted)] hover:border-sky-400 hover:text-[var(--bt-black)] transition-colors bg-white';
		return filterCategory === cat ? active : inactive;
	}

	function handleSelect(note: Note) {
		const payload: ResourcePayload = {
			kind: 'note',
			note: {
				id: note.id,
				quote: note.quote,
				noteText: note.noteText,
				verse: note.verse,
				supportReference: note.supportReference
			}
		};
		onSelectNote?.(payload);
	}

	/**
	 * A rc:// chip inside a note body (TA article / TW term) was clicked.
	 * TA/other → first-class article resource (get_academy_article).
	 * TW → word resource (get_word_article).
	 */
	function handleRcLink(rc: RcLinkSelection) {
		const payload: ResourcePayload =
			rc.kind === 'tw'
				? { kind: 'word', word: { term: rc.label, path: rc.uri } }
				: { kind: 'article', article: { path: rc.uri, title: rc.label } };
		onSelectNote?.(payload);
	}

	function noteKey(note: Note): string {
		return resourceKey({
			kind: 'note',
			note: { id: note.id, noteText: note.noteText }
		});
	}

	function noteThreadCount(note: Note): number {
		return ($studySession.resourceThreads[noteKey(note)] ?? []).length;
	}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex shrink-0 items-center justify-between border-b border-[var(--bt-border)] bg-[var(--bt-parchment)] px-3 py-2"
	>
		<p class="text-xs font-semibold tracking-wider text-[var(--bt-taupe)] uppercase">{heading}</p>
		{#if reference}
			<span
				class="rounded bg-[var(--bt-black)] px-2 py-0.5 font-mono text-xs text-[var(--bt-cream)]"
			>
				{reference}
			</span>
		{/if}
	</div>

	{#if categories.length > 2}
		<div class="flex shrink-0 flex-wrap gap-1.5 border-b border-gray-200 px-3 py-2">
			{#each categories as cat}
				<button class={chipClass(cat)} on:click={() => (filterCategory = cat)}>
					{cat === 'all' ? `All (${notes.length})` : cat}
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
		{#if filtered.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center text-gray-500">
				<p class="text-2xl">📝</p>
				<p class="mt-2 text-sm">No notes for this filter</p>
			</div>
		{:else}
			{#each filtered as note (note.id)}
				<div data-panel-id={note.id}>
					<TranslationNoteCard
						{note}
						selected={selectedKey === noteKey(note)}
						threadCount={noteThreadCount(note)}
						onSelect={handleSelect}
						onLinkSelect={handleRcLink}
					/>
				</div>
			{/each}
		{/if}
	</div>
</div>
