<script lang="ts">
	/**
	 * ChallengeCards — renders translation challenges as interactive tap-to-explore cards.
	 * Light earthy surfaces (cream / gold / terracotta) to match the BT brand.
	 */

	import Check from 'lucide-svelte/icons/check';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Shuffle from 'lucide-svelte/icons/shuffle';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Pencil from 'lucide-svelte/icons/pencil';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import Tag from 'lucide-svelte/icons/tag';
	import Landmark from 'lucide-svelte/icons/landmark';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import StickyNote from 'lucide-svelte/icons/sticky-note';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import { studySession, resourceKey } from '$lib/stores/studySession.js';

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		sourceType?: 'tn' | 'tw';
		at?: string;
	}

	export let challenges: ChallengeItem[] = [];
	export let explored: Set<number> = new Set<number>();
	export let isLoading = false;
	export let onSelect: (index: number) => void = () => {};

	const CATEGORY_ICON: Record<string, typeof Sparkles> = {
		'figure-of-speech': Sparkles,
		'double-meaning': Shuffle,
		idiom: MessageCircle,
		grammar: Pencil,
		'key-term': KeyRound,
		name: Tag,
		cultural: Landmark,
		other: AlertTriangle
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

	$: selectedKey = $studySession.scope.kind === 'resource' ? $studySession.scope.key : null;

	function challengeKey(c: ChallengeItem): string {
		return resourceKey({
			kind: 'challenge',
			challenge: c as import('$lib/stores/studySession.js').ChallengeItem
		});
	}

	function challengeThreadCount(c: ChallengeItem): number {
		return ($studySession.resourceThreads[challengeKey(c)] ?? []).length;
	}

	function cardClass(c: ChallengeItem): string {
		const isExplored = explored.has(c.index);
		const isSelected = selectedKey === challengeKey(c);
		const base =
			'group relative flex flex-col gap-1.5 rounded-xl border p-3 text-left ' +
			'transition-all duration-150 focus:outline-none focus-visible:ring-2 ' +
			'active:scale-[0.98] disabled:cursor-not-allowed';

		if (isSelected) {
			return c.sourceType === 'tw'
				? `${base} border-amber-500 ring-2 ring-amber-400/40 bg-amber-50 text-[var(--bt-black)]`
				: `${base} border-sky-500 ring-2 ring-sky-400/40 bg-sky-50 text-[var(--bt-black)]`;
		}

		if (isExplored) {
			return c.sourceType === 'tw'
				? `${base} border-amber-200/80 bg-[var(--bt-parchment)] text-[var(--bt-muted)] opacity-75`
				: `${base} border-[var(--bt-border)] bg-[var(--bt-parchment)] text-[var(--bt-muted)] opacity-75`;
		}

		return c.sourceType === 'tw'
			? `${base} border-amber-200 bg-amber-50/70 text-[var(--bt-black)] hover:border-amber-400 hover:bg-amber-50 focus-visible:ring-amber-400`
			: `${base} border-[var(--bt-border)] bg-white text-[var(--bt-black)] hover:border-sky-400 hover:bg-sky-50/60 focus-visible:ring-sky-400`;
	}
</script>

<div class="mt-2 space-y-3">
	{#if tnChallenges.length > 0}
		<div>
			<p
				class="mb-2 flex items-center gap-1.5 px-0.5 text-xs font-semibold tracking-wider text-[var(--bt-taupe)] uppercase"
			>
				<StickyNote size={12} strokeWidth={2} />
				Translation Notes
			</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each tnChallenges as challenge}
					{@const isExplored = explored.has(challenge.index)}
					{@const count = challengeThreadCount(challenge)}
					{@const CatIcon = CATEGORY_ICON[challenge.category] ?? AlertTriangle}
					<button
						type="button"
						on:click={() => onSelect(challenge.index)}
						disabled={isLoading}
						class={cardClass(challenge)}
						aria-label="Explore challenge {challenge.index}: {challenge.phrase}"
					>
						{#if count > 0}
							<span
								class="absolute top-2 right-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white"
							>
								{count}
							</span>
						{/if}

						<div class="flex items-center gap-2">
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
									{isExplored ? 'bg-sky-100 text-sky-700' : 'bg-sky-600 text-white group-hover:bg-sky-500'}
									text-xs font-bold transition-colors"
							>
								{#if isExplored}
									<Check size={12} strokeWidth={2.5} />
								{:else}
									{challenge.index}
								{/if}
							</span>
							<CatIcon
								size={14}
								strokeWidth={2}
								class={isExplored ? 'text-[var(--bt-taupe)]' : 'text-sky-600'}
							/>
							<span
								class="text-xs font-medium {isExplored ? 'text-[var(--bt-taupe)]' : 'text-sky-700'}"
							>
								{CATEGORY_LABEL[challenge.category] ?? 'Note'}
							</span>
							<span class="ml-auto font-mono text-xs text-[var(--bt-taupe)]">
								v.{challenge.verse}
							</span>
						</div>

						<p
							class="text-sm font-semibold {isExplored
								? 'text-[var(--bt-muted)]'
								: 'text-[var(--bt-black)]'}"
						>
							"{challenge.phrase}"
						</p>

						<p
							class="line-clamp-2 text-xs {isExplored
								? 'text-[var(--bt-taupe)]'
								: 'text-[var(--bt-muted)]'}"
						>
							{challenge.noteText}
						</p>

						{#if challenge.at && !isExplored}
							<p class="truncate text-xs text-sky-700 italic opacity-90">
								→ "{challenge.at}"
							</p>
						{/if}

						{#if isExplored && count === 0}
							<span class="absolute top-2 right-2 text-emerald-500" aria-label="Explored">
								<Check size={14} strokeWidth={2.5} />
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if twChallenges.length > 0}
		<div>
			<p
				class="mb-2 flex items-center gap-1.5 px-0.5 text-xs font-semibold tracking-wider text-amber-800 uppercase"
			>
				<BookOpen size={12} strokeWidth={2} />
				Key Terms
			</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each twChallenges as challenge}
					{@const isExplored = explored.has(challenge.index)}
					{@const count = challengeThreadCount(challenge)}
					<button
						type="button"
						on:click={() => onSelect(challenge.index)}
						disabled={isLoading}
						class={cardClass(challenge)}
						aria-label="Explore key term {challenge.index}: {challenge.phrase}"
					>
						{#if count > 0}
							<span
								class="absolute top-2 right-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-700 px-1 text-xs font-bold text-white"
							>
								{count}
							</span>
						{/if}

						<div class="flex items-center gap-2">
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
									{isExplored ? 'bg-amber-100 text-amber-700' : 'bg-amber-700 text-white group-hover:bg-amber-600'}
									text-xs font-bold transition-colors"
							>
								{#if isExplored}
									<Check size={12} strokeWidth={2.5} />
								{:else}
									{challenge.index}
								{/if}
							</span>
							<KeyRound
								size={14}
								strokeWidth={2}
								class={isExplored ? 'text-[var(--bt-taupe)]' : 'text-amber-700'}
							/>
							<span
								class="text-xs font-medium {isExplored
									? 'text-[var(--bt-taupe)]'
									: 'text-amber-800'}"
							>
								Key term
							</span>
							<span class="ml-auto font-mono text-xs text-[var(--bt-taupe)]">
								v.{challenge.verse}
							</span>
						</div>

						<p
							class="text-sm font-semibold {isExplored
								? 'text-[var(--bt-muted)]'
								: 'text-[var(--bt-black)]'}"
						>
							"{challenge.phrase}"
						</p>

						<p
							class="line-clamp-2 text-xs {isExplored
								? 'text-[var(--bt-taupe)]'
								: 'text-[var(--bt-muted)]'}"
						>
							{challenge.noteText}
						</p>

						{#if isExplored && count === 0}
							<span class="absolute top-2 right-2 text-emerald-500" aria-label="Explored">
								<Check size={14} strokeWidth={2.5} />
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
