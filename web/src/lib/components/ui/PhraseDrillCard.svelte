<script lang="ts">
	/**
	 * PhraseDrillCard — focused "drill view" for a single translation challenge.
	 *
	 * Shows the phrase prominently, category badge, the full note text rendered from
	 * markdown, the alternate translation suggestion if one exists, and a Scholar
	 * insight section that streams AI-generated explanation.
	 *
	 * Dispatches a `back` event and `next` event (with next challenge index).
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
		rawNoteText?: string;
	}

	/** The challenge being drilled */
	export let challenge: ChallengeItem;
	/** Full note text (may be richer than challenge.noteText — pass verbatim from server) */
	export let noteText: string = '';
	/** Alternate translation suggestion */
	export let atSuggestion: string | undefined = undefined;
	/** Streaming AI insight text from the Scholar agent */
	export let agentInsight: string = '';
	/** True while the Scholar agent is fetching */
	export let insightLoading: boolean = false;
	/** Total challenges count for "Next" button */
	export let totalChallenges: number = 0;

	const dispatch = createEventDispatcher<{ back: void; next: number }>();

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
	$: hasNext = challenge.index < totalChallenges;
</script>

<div
	class="mt-3 rounded-xl border p-4
		{isKeyTerm ? 'border-amber-200 bg-amber-50/70' : 'border-[var(--bt-border)] bg-white'}"
>
	<!-- Back button -->
	<button
		on:click={() => dispatch('back')}
		class="mb-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--bt-taupe)]
			transition-colors hover:bg-[var(--bt-parchment)] hover:text-[var(--bt-black)]"
	>
		<span>←</span>
		<span>Back to all challenges</span>
	</button>

	<!-- Header row: number + category -->
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<span
			class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white
				{isKeyTerm ? 'bg-amber-700' : 'bg-sky-600'}"
		>
			{challenge.index}
		</span>
		<span class="text-lg leading-none">{CATEGORY_BADGE[challenge.category] ?? '⚠️'}</span>
		<span
			class="rounded-full px-2 py-0.5 text-xs font-medium
				{isKeyTerm ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-800'}"
		>
			{CATEGORY_LABEL[challenge.category] ?? 'Note'}
		</span>
		<span class="ml-auto font-mono text-xs text-[var(--bt-taupe)]">v.{challenge.verse}</span>
	</div>

	<!-- The phrase — large and prominent -->
	<p
		class="mb-4 text-xl leading-snug font-bold
			{isKeyTerm ? 'text-amber-950' : 'text-[var(--bt-black)]'}"
	>
		"{challenge.phrase}"
	</p>

	<!-- Note text rendered from markdown -->
	<div
		class="prose prose-sm mb-3 max-w-none rounded-lg border border-[var(--bt-border)]
			bg-[var(--bt-parchment)] px-4 py-3 text-[var(--bt-black)]
			[&_p]:mb-1.5 [&_p:last-child]:mb-0"
	>
		{@html renderMarkdown(displayNote)}
	</div>

	<!-- Alternate translation suggestion -->
	{#if displayAt}
		<div
			class="flex items-start gap-2 rounded-lg border px-3 py-2.5
				{isKeyTerm ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'}"
		>
			<span class="mt-0.5 shrink-0 {isKeyTerm ? 'text-amber-700' : 'text-sky-700'}">→</span>
			<div>
				<p
					class="mb-0.5 text-xs font-semibold tracking-wider uppercase
						{isKeyTerm ? 'text-amber-800' : 'text-sky-800'}"
				>
					Alternate Translation
				</p>
				<p class="text-sm italic {isKeyTerm ? 'text-amber-900' : 'text-sky-900'}">
					"{displayAt}"
				</p>
			</div>
		</div>
	{/if}

	<!-- Scholar insight section -->
	{#if insightLoading || agentInsight}
		<div class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
			<div class="mb-2 flex items-center gap-1.5">
				<span class="text-sm">📚</span>
				<span class="text-xs font-semibold tracking-wider text-emerald-800 uppercase">Scholar</span>
				{#if insightLoading}
					<span class="ml-1 flex gap-0.5">
						<span
							class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]"
						></span>
						<span
							class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]"
						></span>
						<span class="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-500"
						></span>
					</span>
				{/if}
			</div>
			{#if agentInsight}
				<div class="prose prose-sm max-w-none text-[var(--bt-black)]">
					{@html renderMarkdown(agentInsight)}
				</div>
			{:else if insightLoading}
				<p class="animate-pulse text-xs text-emerald-700">Generating insight…</p>
			{/if}
		</div>
	{/if}

	<!-- Navigation: Next challenge -->
	{#if hasNext}
		<div class="mt-3 flex justify-end">
			<button
				on:click={() => dispatch('next', challenge.index + 1)}
				class="flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 transition-colors hover:border-sky-500 hover:bg-sky-100"
			>
				Next challenge →
			</button>
		</div>
	{/if}
</div>
