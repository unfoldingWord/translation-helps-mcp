<script lang="ts">
	/**
	 * ChallengeCards — renders translation challenges as interactive tap-to-explore cards.
	 *
	 * Replaces the plain-text numbered list emitted by formatAnnotatedResponse.
	 * Clicking a card automatically sends the challenge number as the next message.
	 */

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		/** "tn" = translation note, "tw" = translation word / key term */
		sourceType?: 'tn' | 'tw';
		at?: string;
	}

	/** All challenges to display */
	export let challenges: ChallengeItem[] = [];
	/** Set of already-explored challenge indices (1-based) */
	export let explored: Set<number> = new Set<number>();
	/** Whether any request is in flight (disables all cards) */
	export let isLoading = false;
	/** Called when a card is tapped — passes the 1-based challenge index */
	export let onSelect: (index: number) => void = () => {};

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
		'figure-of-speech': 'Figure',
		'double-meaning': 'Double meaning',
		idiom: 'Idiom',
		grammar: 'Grammar',
		'key-term': 'Key term',
		name: 'Name',
		cultural: 'Cultural',
		other: 'Note'
	};

	$: tnChallenges = challenges.filter((c) => c.sourceType !== 'tw');
	$: twChallenges = challenges.filter((c) => c.sourceType === 'tw');

	function cardClass(c: ChallengeItem): string {
		const isExplored = explored.has(c.index);
		const base =
			'group relative flex flex-col gap-1.5 rounded-xl border p-3 text-left ' +
			'transition-all duration-150 focus:outline-none focus-visible:ring-2 ' +
			'active:scale-[0.98] disabled:cursor-not-allowed';

		if (isExplored) {
			return c.sourceType === 'tw'
				? `${base} border-amber-800/40 bg-amber-950/20 text-amber-200/50 opacity-60`
				: `${base} border-indigo-800/40 bg-indigo-950/20 text-indigo-200/50 opacity-60`;
		}

		return c.sourceType === 'tw'
			? `${base} border-amber-700 bg-amber-950/60 text-white hover:border-amber-400 hover:bg-amber-900/80 focus-visible:ring-amber-500`
			: `${base} border-indigo-700 bg-indigo-950/60 text-white hover:border-indigo-400 hover:bg-indigo-900/80 focus-visible:ring-indigo-500`;
	}
</script>

<div class="mt-2 space-y-3">
	<!-- TN group -->
	{#if tnChallenges.length > 0}
		<div>
			<p class="mb-2 px-0.5 text-xs font-semibold tracking-wider text-indigo-400 uppercase">
				📝 Translation Notes
			</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each tnChallenges as challenge}
					{@const isExplored = explored.has(challenge.index)}
					<button
						on:click={() => onSelect(challenge.index)}
						disabled={isLoading}
						class={cardClass(challenge)}
						aria-label="Explore challenge {challenge.index}: {challenge.phrase}"
					>
						<!-- Card header row -->
						<div class="flex items-center gap-2">
							<!-- Challenge number badge -->
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
									{isExplored
									? 'bg-indigo-900/40 text-indigo-500'
									: 'bg-indigo-700 text-white group-hover:bg-indigo-500'}
									text-xs font-bold transition-colors"
							>
								{#if isExplored}
									✓
								{:else}
									{challenge.index}
								{/if}
							</span>
							<!-- Category badge -->
							<span class="text-base leading-none"
								>{CATEGORY_BADGE[challenge.category] ?? '⚠️'}</span
							>
							<span class="text-xs font-medium {isExplored ? 'text-gray-500' : 'text-indigo-300'}">
								{CATEGORY_LABEL[challenge.category] ?? 'Note'}
							</span>
							<!-- Verse tag -->
							<span class="ml-auto text-xs {isExplored ? 'text-gray-600' : 'text-gray-500'}">
								v.{challenge.verse}
							</span>
						</div>

						<!-- Phrase -->
						<p class="text-sm font-semibold {isExplored ? 'text-gray-500' : 'text-white'}">
							"{challenge.phrase}"
						</p>

						<!-- Note preview -->
						<p class="line-clamp-2 text-xs {isExplored ? 'text-gray-600' : 'text-gray-400'}">
							{challenge.noteText}
						</p>

						<!-- AT hint if available -->
						{#if challenge.at && !isExplored}
							<p class="truncate text-xs text-indigo-300 italic opacity-80">
								→ "{challenge.at}"
							</p>
						{/if}

						<!-- Explored checkmark overlay -->
						{#if isExplored}
							<span
								class="absolute top-2 right-2 text-xs font-bold text-emerald-600"
								aria-label="Explored"
							>
								✓
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- TW group -->
	{#if twChallenges.length > 0}
		<div>
			<p class="mb-2 px-0.5 text-xs font-semibold tracking-wider text-amber-400 uppercase">
				📖 Key Terms
			</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each twChallenges as challenge}
					{@const isExplored = explored.has(challenge.index)}
					<button
						on:click={() => onSelect(challenge.index)}
						disabled={isLoading}
						class={cardClass(challenge)}
						aria-label="Explore key term {challenge.index}: {challenge.phrase}"
					>
						<!-- Card header row -->
						<div class="flex items-center gap-2">
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
									{isExplored ? 'bg-amber-900/40 text-amber-600' : 'bg-amber-700 text-white group-hover:bg-amber-500'}
									text-xs font-bold transition-colors"
							>
								{#if isExplored}
									✓
								{:else}
									{challenge.index}
								{/if}
							</span>
							<span class="text-base leading-none">🔑</span>
							<span class="text-xs font-medium {isExplored ? 'text-gray-500' : 'text-amber-300'}">
								Key term
							</span>
							<span class="ml-auto text-xs {isExplored ? 'text-gray-600' : 'text-gray-500'}">
								v.{challenge.verse}
							</span>
						</div>

						<p class="text-sm font-semibold {isExplored ? 'text-gray-500' : 'text-white'}">
							"{challenge.phrase}"
						</p>

						<p class="line-clamp-2 text-xs {isExplored ? 'text-gray-600' : 'text-gray-400'}">
							{challenge.noteText}
						</p>

						{#if isExplored}
							<span
								class="absolute top-2 right-2 text-xs font-bold text-emerald-600"
								aria-label="Explored"
							>
								✓
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
