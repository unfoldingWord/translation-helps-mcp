<script lang="ts">
	/**
	 * ResourceWorkbench — full-canvas translation resource viewer.
	 *
	 * Layout:
	 *   - Scripture text pane at the top (~40% of panel height)
	 *   - Tabbed helps pane below (Notes / Words / Questions / Challenges)
	 *   - When a resource is selected, shows ResourceThread in the detail area
	 */

	import ScriptureTextPanel from './ScriptureTextPanel.svelte';
	import TranslationNotesPanel from './TranslationNotesPanel.svelte';
	import TranslationWordsPanel from './TranslationWordsPanel.svelte';
	import ChallengeCards from './ChallengeCards.svelte';
	import ResourceThread from './ResourceThread.svelte';
	import type { UIComponent } from '$core/harness/uiComponents.js';
	import {
		selectResource,
		studySession,
		type ResourcePayload,
		type ChallengeItem
	} from '$lib/stores/studySession.js';

	type UIComponentData = UIComponent;

	export let components: UIComponentData[] = [];
	export let isLoading = false;
	export let currentLanguage: string = 'en';
	export let onExplored: (index: number) => void = () => {};
	export let suggestions: string[] = [];
	export let onSuggestion: ((s: string) => void) | undefined = undefined;

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

	$: totalChallenges = challengesComp?.challenges.length ?? 0;
	$: exploredSet = new Set($studySession.explored);

	$: scope = $studySession.scope;
	$: hasResourceScope = scope.kind === 'resource';
	$: selectedResource = scope.kind === 'resource' ? scope.resource : null;
	$: selectedKey = scope.kind === 'resource' ? scope.key : '';

	type Tab = 'notes' | 'words' | 'questions' | 'challenges';
	let activeTab: Tab = 'notes';
	let tabPinned = false;

	$: {
		if (!tabPinned) {
			if (hasChallenges) activeTab = 'challenges';
			else if (hasNotes) activeTab = 'notes';
			else if (hasWords) activeTab = 'words';
			else if (hasQuestions) activeTab = 'questions';
		}
	}

	$: hasAnyContent = hasScripture || hasNotes || hasWords || hasQuestions || hasChallenges;

	function setTab(tab: Tab) {
		activeTab = tab;
		tabPinned = true;
	}

	function tabBtn(tab: Tab): string {
		const base = 'px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap';
		return tab === activeTab
			? `${base} border-b-2 border-sky-500 text-sky-800`
			: `${base} text-[var(--bt-taupe)] hover:text-[var(--bt-black)]`;
	}

	function handleChallengeSelect(index: number) {
		const challenges = challengesComp?.challenges as ChallengeItem[] | undefined;
		const c = challenges?.find((ch) => ch.index === index);
		if (!c) return;
		selectResource({ kind: 'challenge', challenge: c });
		onExplored(c.index);
	}

	function handleNextChallenge(nextIndex: number) {
		handleChallengeSelect(nextIndex);
	}

	function handleSelectResource(payload: ResourcePayload) {
		selectResource(payload);
	}

	function handleQuestionSelect(q: {
		id: string;
		question: string;
		response?: string;
		verse?: string;
	}) {
		selectResource({
			kind: 'question',
			question: { id: q.id, question: q.question, response: q.response, verse: q.verse }
		});
	}
</script>

<div
	class="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--bt-border)] bg-white"
>
	{#if !hasAnyContent}
		<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<div class="text-5xl opacity-30">📚</div>
			<div>
				<p class="font-semibold text-[var(--bt-muted)]">Ask a translation question</p>
				<p class="mt-1 text-sm text-[var(--bt-taupe)]">
					Include a Bible reference for in-depth passage analysis, or ask a general translation
					question.
				</p>
			</div>
			{#if suggestions.length > 0}
				<div class="mt-3 flex flex-wrap justify-center gap-1.5">
					{#each suggestions as s}
						<button
							on:click={() => onSuggestion?.(s)}
							class="rounded-lg border border-[var(--bt-border)] px-2.5 py-1 text-xs text-[var(--bt-muted)] transition-colors hover:border-sky-500 hover:text-[var(--bt-black)]"
						>
							{s}
						</button>
					{/each}
				</div>
			{:else}
				<div class="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--bt-taupe)]">
					<div class="rounded-lg border border-[var(--bt-border)] bg-[var(--bt-parchment)] p-2">
						<p class="text-lg">📖</p>
						<p>Scripture</p>
					</div>
					<div class="rounded-lg border border-[var(--bt-border)] bg-[var(--bt-parchment)] p-2">
						<p class="text-lg">📝</p>
						<p>Notes</p>
					</div>
					<div class="rounded-lg border border-[var(--bt-border)] bg-[var(--bt-parchment)] p-2">
						<p class="text-lg">🔑</p>
						<p>Key Terms</p>
					</div>
				</div>
			{/if}
		</div>
	{:else if hasResourceScope && selectedResource}
		<!-- Resource thread detail (full canvas when scoped) -->
		<div class="flex min-h-0 flex-1 flex-col">
			{#if hasScripture}
				<div class="shrink-0 border-b border-[var(--bt-border)]" style="height: 28%">
					<ScriptureTextPanel
						reference={scriptureReference}
						versions={scriptureVersions}
						{highlightPhrase}
					/>
				</div>
			{/if}
			<div class="min-h-0 flex-1">
				<ResourceThread
					resource={selectedResource}
					resourceKey={selectedKey}
					{currentLanguage}
					{totalChallenges}
					onNextChallenge={handleNextChallenge}
				/>
			</div>
		</div>
	{:else}
		{#if hasScripture}
			<div class="shrink-0 border-b border-[var(--bt-border)]" style="height: 42%">
				<ScriptureTextPanel
					reference={scriptureReference}
					versions={scriptureVersions}
					{highlightPhrase}
				/>
			</div>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			<div
				class="flex shrink-0 gap-0 overflow-x-auto border-b border-[var(--bt-border)] bg-[var(--bt-parchment)]"
			>
				{#if hasChallenges}
					<button class={tabBtn('challenges')} on:click={() => setTab('challenges')}>
						🎯 Challenges
						<span class="ml-1 rounded-full bg-sky-100 px-1.5 text-sky-800">
							{challengesComp?.challenges.length}
						</span>
					</button>
				{/if}
				{#if hasNotes}
					<button class={tabBtn('notes')} on:click={() => setTab('notes')}>
						📝 Notes
						<span class="ml-1 rounded-full bg-white px-1.5 text-[var(--bt-taupe)]">
							{notesComp?.notes.length}
						</span>
					</button>
				{/if}
				{#if hasWords}
					<button class={tabBtn('words')} on:click={() => setTab('words')}>
						🔑 Words
						<span class="ml-1 rounded-full bg-amber-100 px-1.5 text-amber-900">
							{wordsComp?.words.length}
						</span>
					</button>
				{/if}
				{#if hasQuestions}
					<button class={tabBtn('questions')} on:click={() => setTab('questions')}>
						❓ Questions
						<span class="ml-1 rounded-full bg-white px-1.5 text-[var(--bt-taupe)]">
							{questionsComp?.questions.length}
						</span>
					</button>
				{/if}
			</div>

			<div class="min-h-0 flex-1 overflow-hidden">
				{#if activeTab === 'challenges' && challengesComp}
					<div class="h-full overflow-y-auto px-3 py-2.5">
						<ChallengeCards
							challenges={challengesComp.challenges}
							explored={exploredSet}
							{isLoading}
							onSelect={handleChallengeSelect}
						/>
					</div>
				{:else if activeTab === 'notes' && notesComp}
					<TranslationNotesPanel
						reference={notesComp.reference}
						notes={notesComp.notes}
						onSelectNote={handleSelectResource}
					/>
				{:else if activeTab === 'words' && wordsComp}
					<TranslationWordsPanel
						reference={wordsComp.reference}
						words={wordsComp.words}
						onSelectWord={handleSelectResource}
					/>
				{:else if activeTab === 'questions' && questionsComp}
					<div class="h-full overflow-y-auto p-3">
						<div class="mb-2 flex items-center justify-between">
							<p class="text-xs font-semibold tracking-wider text-[var(--bt-taupe)] uppercase">
								Translation Questions
							</p>
							{#if questionsComp.reference}
								<span
									class="rounded bg-[var(--bt-black)] px-2 py-0.5 font-mono text-xs text-[var(--bt-cream)]"
								>
									{questionsComp.reference}
								</span>
							{/if}
						</div>
						<div class="space-y-2">
							{#each questionsComp.questions as q (q.id)}
								{@const qKey = `question:${q.id}`}
								{@const qCount = ($studySession.resourceThreads[qKey] ?? []).length}
								{@const qSelected =
									$studySession.scope.kind === 'resource' && $studySession.scope.key === qKey}
								<button
									type="button"
									on:click={() => handleQuestionSelect(q)}
									class="relative w-full rounded-lg border p-3 text-left text-sm transition-all
										{qSelected
										? 'border-sky-500 bg-sky-50 ring-2 ring-sky-400/40'
										: 'border-[var(--bt-border)] bg-[var(--bt-parchment)] hover:border-sky-400'}"
								>
									{#if qCount > 0}
										<span
											class="absolute top-2 right-2 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white"
										>
											{qCount}
										</span>
									{/if}
									{#if q.verse}
										<span class="mb-1 block font-mono text-xs text-[var(--bt-taupe)]"
											>v.{q.verse}</span
										>
									{/if}
									<p class="font-medium text-[var(--bt-black)]">{q.question}</p>
									{#if q.response}
										<p class="mt-1.5 text-xs text-[var(--bt-muted)]">{q.response}</p>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div
						class="flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--bt-taupe)]"
					>
						<p class="text-2xl opacity-40">📭</p>
						<p class="text-xs">No content for this tab</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
