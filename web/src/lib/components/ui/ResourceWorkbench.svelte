<script lang="ts">
	/**
	 * ResourceWorkbench — the right-panel translation resource viewer.
	 *
	 * Layout:
	 *   - Scripture text pane at the top (~40% of panel height)
	 *   - Tabbed helps pane below (Notes / Words / Questions / Challenges)
	 *
	 * Accepts the full array of UIComponent data from the latest assistant message.
	 * Reactively updates as new components arrive via SSE.
	 */

	import ScriptureTextPanel from './ScriptureTextPanel.svelte';
	import TranslationNotesPanel from './TranslationNotesPanel.svelte';
	import TranslationWordsPanel from './TranslationWordsPanel.svelte';
	import ChallengeCards from './ChallengeCards.svelte';
	import PhraseDrillCard from './PhraseDrillCard.svelte';

	// ── UIComponent type (mirrors uiComponents.ts) ──────────────────────────

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		sourceType?: 'tn' | 'tw';
		at?: string;
	}

	type UIComponentData =
		| {
				type: 'scripture_panel';
				verses: { label: string; text: string }[];
				highlightPhrase?: string;
		  }
		| {
				type: 'scripture_text';
				reference: string;
				versions: Array<{
					label: string;
					text: string;
					direction?: 'ltr' | 'rtl';
					resourceType?: string;
				}>;
				highlightPhrase?: string;
		  }
		| {
				type: 'translation_notes';
				reference: string;
				notes: Array<{
					id: string;
					quote?: string;
					noteText: string;
					supportReference?: string;
					category?: string;
					verse?: string;
				}>;
		  }
		| {
				type: 'translation_words';
				reference: string;
				words: Array<{
					id: string;
					term: string;
					definition?: string;
					verse?: string;
					origWords?: string;
					wordPath?: string;
				}>;
		  }
		| {
				type: 'translation_questions';
				reference: string;
				questions: Array<{ id: string; question: string; response?: string; verse?: string }>;
		  }
		| { type: 'challenge_cards'; challenges: ChallengeItem[] }
		| { type: 'phrase_drill'; challenge: ChallengeItem; noteText: string; atSuggestion?: string }
		| { type: 'progress_tracker'; total: number; explored: number[] }
		| { type: 'ta_article_preview'; reference: string; title: string; excerpt: string };

	// ── Props ────────────────────────────────────────────────────────────────

	/** All UIComponents from the latest assistant message */
	export let components: UIComponentData[] = [];

	/** Whether the assistant is currently generating (disables drill interactions) */
	export let isLoading = false;

	/** Set of already-explored challenge indices */
	export let explored: Set<number> = new Set();

	/** Called when user selects a challenge from ChallengeCards */
	export let onSelectChallenge: (index: number) => void = () => {};

	/** Called when user clicks "back" from a phrase drill */
	export let onDrillBack: () => void = () => {};

	// ── Derived state ────────────────────────────────────────────────────────

	$: scriptureTextComp = components.find((c) => c.type === 'scripture_text') as
		| Extract<UIComponentData, { type: 'scripture_text' }>
		| undefined;

	$: scripturePanelComp = components.find((c) => c.type === 'scripture_panel') as
		| Extract<UIComponentData, { type: 'scripture_panel' }>
		| undefined;

	$: notesComp = components.find((c) => c.type === 'translation_notes') as
		| Extract<UIComponentData, { type: 'translation_notes' }>
		| undefined;

	$: wordsComp = components.find((c) => c.type === 'translation_words') as
		| Extract<UIComponentData, { type: 'translation_words' }>
		| undefined;

	$: questionsComp = components.find((c) => c.type === 'translation_questions') as
		| Extract<UIComponentData, { type: 'translation_questions' }>
		| undefined;

	$: challengesComp = components.find((c) => c.type === 'challenge_cards') as
		| Extract<UIComponentData, { type: 'challenge_cards' }>
		| undefined;

	$: drillComp = components.find((c) => c.type === 'phrase_drill') as
		| Extract<UIComponentData, { type: 'phrase_drill' }>
		| undefined;

	// Convert legacy scripture_panel to scripture_text format for unified display
	$: scriptureVersions =
		scriptureTextComp?.versions ??
		scripturePanelComp?.verses.map((v) => ({ label: v.label, text: v.text })) ??
		[];

	$: scriptureReference =
		scriptureTextComp?.reference ??
		notesComp?.reference ??
		wordsComp?.reference ??
		questionsComp?.reference ??
		'';

	$: highlightPhrase = scriptureTextComp?.highlightPhrase ?? scripturePanelComp?.highlightPhrase;

	$: hasScripture = scriptureVersions.length > 0;
	$: hasNotes = (notesComp?.notes.length ?? 0) > 0;
	$: hasWords = (wordsComp?.words.length ?? 0) > 0;
	$: hasQuestions = (questionsComp?.questions.length ?? 0) > 0;
	$: hasChallenges = (challengesComp?.challenges.length ?? 0) > 0;
	$: hasDrill = Boolean(drillComp);

	// ── Tab state ────────────────────────────────────────────────────────────

	type Tab = 'notes' | 'words' | 'questions' | 'challenges' | 'drill';

	let activeTab: Tab = 'notes';

	// Auto-select the most relevant tab when components change
	$: {
		if (hasDrill) activeTab = 'drill';
		else if (hasChallenges) activeTab = 'challenges';
		else if (hasNotes) activeTab = 'notes';
		else if (hasWords) activeTab = 'words';
		else if (hasQuestions) activeTab = 'questions';
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	const hasAnyContent = () =>
		hasScripture || hasNotes || hasWords || hasQuestions || hasChallenges || hasDrill;

	function tabBtn(tab: Tab): string {
		const base = 'px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap';
		return tab === activeTab
			? `${base} border-b-2 border-indigo-500 text-indigo-300`
			: `${base} text-gray-500 hover:text-gray-300`;
	}
</script>

<div class="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
	{#if !hasAnyContent()}
		<!-- Empty state -->
		<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<div class="text-5xl opacity-30">📚</div>
			<div>
				<p class="font-semibold text-gray-400">Resource Workbench</p>
				<p class="mt-1 text-sm text-gray-600">
					Scripture, notes, and key terms will appear here as you explore passages.
				</p>
			</div>
			<div class="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-600">
				<div class="rounded-lg border border-gray-800 p-2">
					<p class="text-lg">📖</p>
					<p>Scripture</p>
				</div>
				<div class="rounded-lg border border-gray-800 p-2">
					<p class="text-lg">📝</p>
					<p>Notes</p>
				</div>
				<div class="rounded-lg border border-gray-800 p-2">
					<p class="text-lg">🔑</p>
					<p>Key Terms</p>
				</div>
			</div>
		</div>
	{:else}
		<!-- ── Scripture pane (top) ──────────────────────────────────────────── -->
		{#if hasScripture}
			<div class="shrink-0 border-b border-gray-700/60" style="height: 42%">
				<ScriptureTextPanel
					reference={scriptureReference}
					versions={scriptureVersions}
					{highlightPhrase}
				/>
			</div>
		{/if}

		<!-- ── Tabbed helps pane (bottom) ───────────────────────────────────── -->
		<div class="flex min-h-0 flex-1 flex-col">
			<!-- Tab bar -->
			<div class="flex shrink-0 gap-0 overflow-x-auto border-b border-gray-700/60 bg-gray-900">
				{#if hasChallenges}
					<button class={tabBtn('challenges')} on:click={() => (activeTab = 'challenges')}>
						🎯 Challenges
						<span class="ml-1 rounded-full bg-indigo-900/60 px-1.5 text-indigo-300">
							{challengesComp?.challenges.length}
						</span>
					</button>
				{/if}
				{#if hasDrill}
					<button class={tabBtn('drill')} on:click={() => (activeTab = 'drill')}> ↳ Drill </button>
				{/if}
				{#if hasNotes}
					<button class={tabBtn('notes')} on:click={() => (activeTab = 'notes')}>
						📝 Notes
						<span class="ml-1 rounded-full bg-gray-700/60 px-1.5 text-gray-400">
							{notesComp?.notes.length}
						</span>
					</button>
				{/if}
				{#if hasWords}
					<button class={tabBtn('words')} on:click={() => (activeTab = 'words')}>
						🔑 Words
						<span class="ml-1 rounded-full bg-amber-900/60 px-1.5 text-amber-400">
							{wordsComp?.words.length}
						</span>
					</button>
				{/if}
				{#if hasQuestions}
					<button class={tabBtn('questions')} on:click={() => (activeTab = 'questions')}>
						❓ Questions
						<span class="ml-1 rounded-full bg-gray-700/60 px-1.5 text-gray-400">
							{questionsComp?.questions.length}
						</span>
					</button>
				{/if}
			</div>

			<!-- Tab content -->
			<div class="min-h-0 flex-1 overflow-hidden">
				{#if activeTab === 'challenges' && challengesComp}
					<div class="h-full overflow-y-auto px-3 py-2.5">
						<ChallengeCards
							challenges={challengesComp.challenges}
							{explored}
							{isLoading}
							onSelect={onSelectChallenge}
						/>
					</div>
				{:else if activeTab === 'drill' && drillComp}
					<div class="h-full overflow-y-auto px-3 py-2.5">
						<PhraseDrillCard
							challenge={drillComp.challenge}
							noteText={drillComp.noteText}
							atSuggestion={drillComp.atSuggestion}
							on:back={onDrillBack}
						/>
					</div>
				{:else if activeTab === 'notes' && notesComp}
					<TranslationNotesPanel reference={notesComp.reference} notes={notesComp.notes} />
				{:else if activeTab === 'words' && wordsComp}
					<TranslationWordsPanel reference={wordsComp.reference} words={wordsComp.words} />
				{:else if activeTab === 'questions' && questionsComp}
					<div class="h-full overflow-y-auto p-3">
						<div class="mb-2 flex items-center justify-between">
							<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">
								Translation Questions
							</p>
							{#if questionsComp.reference}
								<span class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-300">
									{questionsComp.reference}
								</span>
							{/if}
						</div>
						<div class="space-y-2">
							{#each questionsComp.questions as q (q.id)}
								<div class="rounded-lg border border-gray-700/60 bg-gray-800/50 p-3 text-sm">
									{#if q.verse}
										<span class="mb-1 block font-mono text-xs text-gray-500">v.{q.verse}</span>
									{/if}
									<p class="font-medium text-gray-200">{q.question}</p>
									{#if q.response}
										<p class="mt-1.5 text-xs text-gray-400">{q.response}</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<!-- Empty tab state -->
					<div
						class="flex h-full flex-col items-center justify-center gap-2 text-center text-gray-600"
					>
						<p class="text-2xl opacity-40">📭</p>
						<p class="text-xs">No content for this tab</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
