<script lang="ts">
	/**
	 * TurnResources — per-turn inline resource cards for the study stream.
	 * Challenges open by default; Notes/Words/Questions collapsed.
	 * DraftCheckCard closes the Read → Explore → Check flow.
	 */

	import { tick } from 'svelte';
	import Target from 'lucide-svelte/icons/target';
	import StickyNote from 'lucide-svelte/icons/sticky-note';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import HelpCircle from 'lucide-svelte/icons/help-circle';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import ChallengeCards from './ChallengeCards.svelte';
	import TranslationNotesPanel from './TranslationNotesPanel.svelte';
	import TranslationWordsPanel from './TranslationWordsPanel.svelte';
	import ResourceThread from './ResourceThread.svelte';
	import DraftCheckCard from './DraftCheckCard.svelte';
	import SectionShell from './SectionShell.svelte';
	import type { UIComponent } from '$core/harness/uiComponents.js';
	import {
		selectResource,
		studySession,
		resourceKey,
		clearOpenCheck,
		type ResourcePayload,
		type ChallengeItem
	} from '$lib/stores/studySession.js';
	import { getDraftTextForReference } from '$lib/stores/draftStore.js';

	type UIComponentData = UIComponent;

	export let components: UIComponentData[] = [];
	export let isLoading = false;
	export let currentLanguage = 'en';
	export let onExplored: (index: number) => void = () => {};

	let threadEl: HTMLElement | undefined;
	let checkSectionEl: HTMLElement | undefined;
	let challengesOpen = true;
	let notesOpen = false;
	let wordsOpen = false;
	let questionsOpen = false;
	let checkOpen = false;

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

	$: scriptureTextComp = components.find((c) => c.type === 'scripture_text') as
		| Extract<UIComponentData, { type: 'scripture_text' }>
		| undefined;

	$: checkReference =
		scriptureTextComp?.reference ??
		notesComp?.reference ??
		wordsComp?.reference ??
		questionsComp?.reference ??
		$studySession.reference ??
		'';

	$: hasNotes = (notesComp?.notes.length ?? 0) > 0;
	$: hasWords = (wordsComp?.words.length ?? 0) > 0;
	$: hasQuestions = (questionsComp?.questions.length ?? 0) > 0;
	$: hasChallenges = (challengesComp?.challenges.length ?? 0) > 0;
	$: hasAny = hasNotes || hasWords || hasQuestions || hasChallenges;
	$: showCheck = (hasNotes || hasQuestions) && !!checkReference;

	$: totalChallenges = challengesComp?.challenges.length ?? 0;
	$: exploredSet = new Set($studySession.explored);
	$: exploredCount = challengesComp?.challenges.filter((c) => exploredSet.has(c.index)).length ?? 0;

	$: scope = $studySession.scope;
	$: selectedResource = scope.kind === 'resource' ? scope.resource : null;
	$: selectedKey = scope.kind === 'resource' ? scope.key : '';

	/** True when the current scope's resource is owned by this turn's components. */
	$: ownsSelection = (() => {
		if (scope.kind !== 'resource' || !selectedResource) return false;
		const key = selectedKey;
		if (selectedResource.kind === 'challenge' && challengesComp) {
			return (challengesComp.challenges as ChallengeItem[]).some(
				(c) => resourceKey({ kind: 'challenge', challenge: c }) === key
			);
		}
		if (selectedResource.kind === 'note' && notesComp) {
			return notesComp.notes.some((n) => resourceKey({ kind: 'note', note: n }) === key);
		}
		if (selectedResource.kind === 'word' && wordsComp) {
			return wordsComp.words.some(
				(w) =>
					resourceKey({
						kind: 'word',
						word: { term: w.term, path: w.wordPath }
					}) === key
			);
		}
		if (selectedResource.kind === 'question' && questionsComp) {
			return questionsComp.questions.some(
				(q) => resourceKey({ kind: 'question', question: q }) === key
			);
		}
		return false;
	})();

	let lastScrolledKey = '';
	$: if (ownsSelection && selectedKey && selectedKey !== lastScrolledKey) {
		lastScrolledKey = selectedKey;
		if (selectedResource?.kind === 'challenge') challengesOpen = true;
		else if (selectedResource?.kind === 'note') notesOpen = true;
		else if (selectedResource?.kind === 'word') wordsOpen = true;
		else if (selectedResource?.kind === 'question') questionsOpen = true;
		scrollThreadIntoView();
	} else if (!ownsSelection) {
		lastScrolledKey = '';
	}

	$: if ($studySession.openCheck && showCheck) {
		checkOpen = true;
		scrollCheckIntoView();
		clearOpenCheck();
	}

	async function scrollThreadIntoView() {
		await tick();
		threadEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	async function scrollCheckIntoView() {
		await tick();
		checkSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

{#if hasAny}
	<div class="mt-2 space-y-2 rounded-xl border border-[var(--bt-border)] bg-white p-2 shadow-sm">
		{#if hasChallenges && challengesComp}
			<SectionShell
				bind:open={challengesOpen}
				title="Challenges"
				count={challengesComp.challenges.length}
				countClass="bg-sky-100 text-sky-800"
				badge={totalChallenges > 0 ? `${exploredCount}/${totalChallenges} explored` : undefined}
				badgeClass="bg-amber-100 text-amber-900"
			>
				<span slot="icon"><Target size={14} strokeWidth={2} /></span>
				<div class="px-1 pb-1">
					<ChallengeCards
						challenges={challengesComp.challenges}
						explored={exploredSet}
						{isLoading}
						onSelect={handleChallengeSelect}
					/>
					{#if ownsSelection && selectedResource?.kind === 'challenge'}
						<div
							bind:this={threadEl}
							class="mt-3 overflow-hidden rounded-xl border border-sky-200 bg-[var(--bt-parchment)]"
						>
							<div class="max-h-[28rem] overflow-y-auto">
								<ResourceThread
									resource={selectedResource}
									resourceKey={selectedKey}
									{currentLanguage}
									{totalChallenges}
									onNextChallenge={handleNextChallenge}
								/>
							</div>
						</div>
					{/if}
				</div>
			</SectionShell>
		{/if}

		{#if hasNotes && notesComp}
			<SectionShell
				bind:open={notesOpen}
				title="Notes"
				count={notesComp.notes.length}
				countClass="bg-sky-100 text-sky-800"
			>
				<span slot="icon"><StickyNote size={14} strokeWidth={2} /></span>
				<div class="max-h-80 overflow-y-auto rounded-lg border border-[var(--bt-border)]">
					<TranslationNotesPanel
						reference={notesComp.reference}
						notes={notesComp.notes}
						onSelectNote={handleSelectResource}
					/>
				</div>
				{#if ownsSelection && selectedResource?.kind === 'note'}
					<div
						bind:this={threadEl}
						class="mt-3 overflow-hidden rounded-xl border border-sky-200 bg-[var(--bt-parchment)]"
					>
						<div class="max-h-[28rem] overflow-y-auto">
							<ResourceThread
								resource={selectedResource}
								resourceKey={selectedKey}
								{currentLanguage}
							/>
						</div>
					</div>
				{/if}
			</SectionShell>
		{/if}

		{#if hasWords && wordsComp}
			<SectionShell
				bind:open={wordsOpen}
				title="Words"
				count={wordsComp.words.length}
				countClass="bg-amber-100 text-amber-900"
			>
				<span slot="icon"><KeyRound size={14} strokeWidth={2} /></span>
				<div class="max-h-80 overflow-y-auto rounded-lg border border-[var(--bt-border)]">
					<TranslationWordsPanel
						reference={wordsComp.reference}
						words={wordsComp.words}
						onSelectWord={handleSelectResource}
					/>
				</div>
				{#if ownsSelection && selectedResource?.kind === 'word'}
					<div
						bind:this={threadEl}
						class="mt-3 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50"
					>
						<div class="max-h-[28rem] overflow-y-auto">
							<ResourceThread
								resource={selectedResource}
								resourceKey={selectedKey}
								{currentLanguage}
							/>
						</div>
					</div>
				{/if}
			</SectionShell>
		{/if}

		{#if hasQuestions && questionsComp}
			<SectionShell
				bind:open={questionsOpen}
				title="Questions"
				count={questionsComp.questions.length}
				countClass="bg-[var(--bt-parchment)] text-[var(--bt-taupe)]"
			>
				<span slot="icon"><HelpCircle size={14} strokeWidth={2} /></span>
				<div class="max-h-80 space-y-2 overflow-y-auto p-2">
					{#each questionsComp.questions as q (q.id)}
						<button
							type="button"
							class="w-full rounded-lg border border-[var(--bt-border)] bg-[var(--bt-parchment)] p-3 text-left text-sm transition-colors hover:border-sky-400
								{ownsSelection && selectedResource?.kind === 'question' && selectedResource.question?.id === q.id
								? 'border-sky-500 bg-sky-50 ring-1 ring-sky-400/40'
								: ''}"
							on:click={() => handleQuestionSelect(q)}
						>
							{#if q.verse}
								<span class="mb-1 block font-mono text-xs text-[var(--bt-taupe)]">v.{q.verse}</span>
							{/if}
							<p class="font-medium text-[var(--bt-black)]">{q.question}</p>
							{#if q.response}
								<p class="mt-1.5 text-xs text-[var(--bt-muted)]">{q.response}</p>
							{/if}
						</button>
					{/each}
				</div>
				{#if ownsSelection && selectedResource?.kind === 'question'}
					<div
						bind:this={threadEl}
						class="mt-3 overflow-hidden rounded-xl border border-sky-200 bg-[var(--bt-parchment)]"
					>
						<div class="max-h-[28rem] overflow-y-auto">
							<ResourceThread
								resource={selectedResource}
								resourceKey={selectedKey}
								{currentLanguage}
							/>
						</div>
					</div>
				{/if}
			</SectionShell>
		{/if}

		{#if showCheck}
			<div bind:this={checkSectionEl}>
				<SectionShell
					bind:open={checkOpen}
					title="Check"
					badge="draft"
					badgeClass="bg-emerald-900/50 text-emerald-300"
				>
					<span slot="icon"><ShieldCheck size={14} strokeWidth={2} /></span>
					<DraftCheckCard
						reference={checkReference}
						language={currentLanguage}
						sourceLanguage={$studySession.sourceLanguage || currentLanguage}
						initialDraft={getDraftTextForReference(checkReference)}
						tnNotes={notesComp?.notes ?? []}
						tqQuestions={questionsComp?.questions ?? []}
					/>
				</SectionShell>
			</div>
		{/if}
	</div>
{/if}
