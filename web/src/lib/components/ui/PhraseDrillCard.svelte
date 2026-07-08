<script lang="ts">
	/**
	 * PhraseDrillCard — focused "drill view" for a single translation challenge.
	 *
	 * Shows the phrase prominently, category badge, the full note text rendered from
	 * markdown, and the alternate translation suggestion if one exists.
	 *
	 * Dispatches a `back` event when the user clicks "← Back to all challenges".
	 */

	import { createEventDispatcher } from 'svelte';
	import { renderMarkdown } from '$lib/renderMarkdown.js';

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		sourceType?: 'tn' | 'tw';
		at?: string;
	}

	/** The challenge being drilled */
	export let challenge: ChallengeItem;
	/** Full note text (may be richer than challenge.noteText — pass verbatim from server) */
	export let noteText: string = '';
	/** Alternate translation suggestion */
	export let atSuggestion: string | undefined = undefined;

	const dispatch = createEventDispatcher<{ back: void }>();

	const CATEGORY_BADGE: Record<string, string> = {
		'figure-of-speech': '🌀',
		'double-meaning': '🔀',
		idiom: '💬',
		grammar: '✏️',
		'key-term': '🔑',
		name: '📛',
		cultural: '🏛️',
		other: '⚠️'
	};

	const CATEGORY_LABEL: Record<string, string> = {
		'figure-of-speech': 'Figure of speech',
		'double-meaning': 'Double meaning',
		idiom: 'Idiom',
		grammar: 'Grammar',
		'key-term': 'Key term',
		name: 'Name',
		cultural: 'Cultural',
		other: 'Note'
	};

	$: displayNote = noteText || challenge.noteText;
	$: displayAt = atSuggestion ?? challenge.at;
	$: isKeyTerm = challenge.sourceType === 'tw';
</script>

<div
	class="mt-3 rounded-xl border p-4
		{isKeyTerm ? 'border-amber-800/50 bg-amber-950/20' : 'border-violet-800/50 bg-gray-800/80'}"
>
	<!-- Back button -->
	<button
		on:click={() => dispatch('back')}
		class="mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-400
			transition-colors hover:bg-gray-700/50 hover:text-white"
	>
		<span>←</span>
		<span>Back to all challenges</span>
	</button>

	<!-- Header row: number + category -->
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<span
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white
				{isKeyTerm ? 'bg-amber-700' : 'bg-violet-700'}"
		>
			{challenge.index}
		</span>
		<span class="text-lg leading-none">{CATEGORY_BADGE[challenge.category] ?? '⚠️'}</span>
		<span
			class="rounded-full px-2 py-0.5 text-xs font-medium
				{isKeyTerm ? 'bg-amber-900/60 text-amber-300' : 'bg-violet-900/60 text-violet-300'}"
		>
			{CATEGORY_LABEL[challenge.category] ?? 'Note'}
		</span>
		<span class="ml-auto text-xs text-gray-500">v.{challenge.verse}</span>
	</div>

	<!-- The phrase — large and prominent -->
	<p
		class="mb-4 text-xl leading-snug font-bold text-white
			{isKeyTerm ? 'text-amber-100' : 'text-white'}"
	>
		"{challenge.phrase}"
	</p>

	<!-- Note text rendered from markdown -->
	<div
		class="prose prose-invert prose-sm mb-3 max-w-none rounded-lg border border-gray-700/60
			bg-gray-900/60 px-4 py-3 text-gray-200
			[&_p]:mb-1.5 [&_p:last-child]:mb-0"
	>
		{@html renderMarkdown(displayNote)}
	</div>

	<!-- Alternate translation suggestion -->
	{#if displayAt}
		<div
			class="flex items-start gap-2 rounded-lg border px-3 py-2.5
				{isKeyTerm ? 'border-amber-700/40 bg-amber-950/40' : 'border-indigo-700/40 bg-indigo-950/40'}"
		>
			<span class="mt-0.5 shrink-0 {isKeyTerm ? 'text-amber-400' : 'text-indigo-400'}">→</span>
			<div>
				<p
					class="mb-0.5 text-xs font-semibold tracking-wider uppercase
						{isKeyTerm ? 'text-amber-400' : 'text-indigo-400'}"
				>
					Alternate Translation
				</p>
				<p class="text-sm italic {isKeyTerm ? 'text-amber-200' : 'text-indigo-200'}">
					"{displayAt}"
				</p>
			</div>
		</div>
	{/if}
</div>
