<script lang="ts">
	/**
	 * ResourceSidePanel — sticky scripture + tabbed helps for the chat layout.
	 * Clicks call onExplain (parent posts Scholar messages in the main feed).
	 * No inline ResourceThread.
	 */
	import BookOpen from 'lucide-svelte/icons/book-open';
	import Library from 'lucide-svelte/icons/library';
	import StickyNote from 'lucide-svelte/icons/sticky-note';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import HelpCircle from 'lucide-svelte/icons/help-circle';
	import Target from 'lucide-svelte/icons/target';
	import Package from 'lucide-svelte/icons/package';
	import GraduationCap from 'lucide-svelte/icons/graduation-cap';
	import ClipboardCheck from 'lucide-svelte/icons/clipboard-check';
	import Brain from 'lucide-svelte/icons/brain';
	import ScriptureTextPanel from './ScriptureTextPanel.svelte';
	import TranslationNotesPanel from './TranslationNotesPanel.svelte';
	import TranslationWordsPanel from './TranslationWordsPanel.svelte';
	import AcademyArticlePanel from './AcademyArticlePanel.svelte';
	import ChallengeCards from './ChallengeCards.svelte';
	import CheckingChecklistPanel from './CheckingChecklistPanel.svelte';
	import ContextQuizPanel from './ContextQuizPanel.svelte';
	import type { UIComponent } from '$core/harness/uiComponents.js';
	import type { PanelTab } from '$core/harness/panelState.js';
	import {
		studySession,
		type ResourcePayload,
		type ChallengeItem,
		type WorkflowMode
	} from '$lib/stores/studySession.js';
	import {
		upsertFromPanelResources,
		listChecklistItems,
		checklistProgress,
		normalizePassageKey,
		checkingChecklist,
		type ChecklistItem
	} from '$lib/stores/checkingChecklistStore.js';

	type UIComponentData = UIComponent;

	/** Panel content tabs (excludes sticky scripture header). */
	type Tab = Exclude<PanelTab, 'scripture'>;

	export let components: UIComponentData[] = [];
	export let isLoading = false;
	export let onExplain: (payload: ResourcePayload) => void = () => {};
	export let onExplored: (index: number) => void = () => {};
	/** Checking-checklist item click → parent starts a coach check in chat. */
	export let onCheckItem: (item: ChecklistItem) => void = () => {};
	/** Context-quiz Submit → parent sends the structured answers to chat. */
	export let onQuizSubmit: (payload: {
		reference: string;
		answers: (string | null)[];
	}) => void = () => {};
	export let onClose: (() => void) | undefined = undefined;
	/** When true, show a mobile bottom-sheet chrome (handle + close). */
	export let sheet = false;
	/** Study language (kept for call-site compatibility — chrome is English). */
	export let language = 'en';
	/**
	 * Increment to force-focus the Checking checklist tab (e.g. Ask for review).
	 * Parent bumps this when checking starts.
	 */
	export let checklistFocusToken = 0;
	/**
	 * Preferred tab from workflow mode / panel_action SSE.
	 * Parent bumps `panelFocusToken` when the mode or action changes.
	 */
	export let panelFocusTab: PanelTab | null = null;
	export let panelFocusToken = 0;
	/**
	 * Highlight / scroll target from panel_action SSE.
	 * Parent bumps `panelHighlightToken` when a new target arrives.
	 */
	export let panelHighlight: {
		kind: 'note' | 'tw' | 'verse' | 'tq' | 'article';
		id: string;
		phrase?: string;
	} | null = null;
	export let panelHighlightToken = 0;
	/** Notify parent when the user (or an action) changes the active tab. */
	export let onTabChange: ((tab: Tab) => void) | undefined = undefined;
	/**
	 * Active workflow mode drives which tabs are visible — everything else
	 * stays one mode-switch (one tap) away, never deleted.
	 */
	export let workflowMode: WorkflowMode = 'study';

	void language;

	$: scriptureTextComp = components.find((c) => c.type === 'scripture_text') as
		| Extract<UIComponentData, { type: 'scripture_text' }>
		| undefined;

	$: scripturePanelComp = components.find((c) => c.type === 'scripture_panel') as
		| Extract<UIComponentData, { type: 'scripture_panel' }>
		| undefined;

	$: contextComp = components.find((c) => c.type === 'passage_context') as
		| Extract<UIComponentData, { type: 'passage_context' }>
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

	$: articleComp = components.find((c) => c.type === 'academy_article') as
		| Extract<UIComponentData, { type: 'academy_article' }>
		| undefined;

	$: quizComp = components.find((c) => c.type === 'context_quiz') as
		| Extract<UIComponentData, { type: 'context_quiz' }>
		| undefined;

	$: scriptureVersions =
		scriptureTextComp?.versions ??
		scripturePanelComp?.verses.map((v) => ({
			label: v.label,
			text: v.text,
			resourceType: (v as { resourceType?: string }).resourceType
		})) ??
		[];

	$: scriptureReference =
		scriptureTextComp?.reference ??
		contextComp?.reference ??
		notesComp?.reference ??
		wordsComp?.reference ??
		questionsComp?.reference ??
		'';

	$: highlightPhrase = scriptureTextComp?.highlightPhrase ?? scripturePanelComp?.highlightPhrase;

	$: hasScripture = scriptureVersions.length > 0;
	$: hasContext = (contextComp?.notes.length ?? 0) > 0;
	$: hasNotes = (notesComp?.notes.length ?? 0) > 0;
	$: hasWords = (wordsComp?.words.length ?? 0) > 0;
	$: hasQuestions = (questionsComp?.questions.length ?? 0) > 0;
	$: hasChallenges = (challengesComp?.challenges.length ?? 0) > 0;
	$: hasArticle = !!articleComp?.markdown;
	$: hasQuiz = (quizComp?.questions.length ?? 0) > 0;

	$: exploredSet = new Set($studySession.explored);

	/** Map passage_context notes into TranslationNotesPanel shape (category = scope). */
	$: contextNotesForPanel =
		contextComp?.notes.map((n) => ({
			id: n.id,
			noteText: n.noteText,
			category: n.scope === 'book' ? 'Book intro' : 'Chapter intro',
			quote: n.title
		})) ?? [];

	let activeTab: Tab = 'context';
	let tabPinned = false;
	let lastArticlePath = '';
	let lastPanelFocusToken = 0;
	let lastPanelHighlightToken = 0;
	let lastReportedTab: Tab | null = null;

	$: if (activeTab !== lastReportedTab) {
		lastReportedTab = activeTab;
		onTabChange?.(activeTab);
	}

	/**
	 * Tabs allowed per mode (order = priority). Study foregrounds context and
	 * exploration; Translate keeps notes/terms at hand; Check leads with the
	 * checklist. Hidden tabs come back by switching mode.
	 */
	const MODE_TABS: Record<WorkflowMode, Tab[]> = {
		study: ['quiz', 'context', 'article', 'challenges', 'notes', 'words', 'questions'],
		translate: ['quiz', 'notes', 'words', 'context', 'article'],
		check: ['checklist', 'notes', 'words', 'questions', 'article']
	};

	/** Upsert checklist items when TN / TW / TQ load — never wipe completed. */
	$: if (scriptureReference && (hasNotes || hasWords || hasQuestions)) {
		upsertFromPanelResources(scriptureReference, {
			notes: notesComp?.notes,
			words: wordsComp?.words,
			questions: questionsComp?.questions
		});
	}

	$: checklistPassage = (() => {
		void $checkingChecklist;
		if (!scriptureReference) {
			return {
				items: [] as ReturnType<typeof listChecklistItems>,
				progress: { completed: 0, total: 0 }
			};
		}
		const passage = $checkingChecklist.passages[normalizePassageKey(scriptureReference)];
		return {
			items: listChecklistItems(passage),
			progress: checklistProgress(passage)
		};
	})();

	$: hasChecklist = checklistPassage.progress.total > 0;

	/** Auto-focus the Article tab when a new academy article is loaded. */
	$: if (articleComp?.path && articleComp.path !== lastArticlePath) {
		lastArticlePath = articleComp.path;
		activeTab = 'article';
		tabPinned = true;
	}

	/** Auto-focus the Quiz tab when a new ACTIVE quiz arrives. */
	let lastQuizKey = '';
	$: if (quizComp && hasQuiz) {
		const key = `${quizComp.reference}|${quizComp.status}|${quizComp.questions.length}`;
		if (key !== lastQuizKey) {
			const wasActive = quizComp.status === 'active';
			lastQuizKey = key;
			if (wasActive) {
				activeTab = 'quiz';
				tabPinned = true;
			}
		}
	}

	/** Ask for review / checking start → open Checking tab. */
	let lastChecklistFocusToken = 0;
	$: if (
		checklistFocusToken > 0 &&
		checklistFocusToken !== lastChecklistFocusToken &&
		hasChecklist
	) {
		lastChecklistFocusToken = checklistFocusToken;
		activeTab = 'checklist';
		tabPinned = true;
	}

	/** Workflow mode / SSE panel_action → focus a specific tab when available. */
	$: if (panelFocusToken > 0 && panelFocusToken !== lastPanelFocusToken) {
		lastPanelFocusToken = panelFocusToken;
		const tab = panelFocusTab;
		if (!tab) {
			/* no-op */
		} else if (tab === 'context' && hasContext) {
			activeTab = 'context';
			tabPinned = true;
		} else if (tab === 'checklist' && hasChecklist) {
			activeTab = 'checklist';
			tabPinned = true;
		} else if (tab === 'quiz' && hasQuiz) {
			activeTab = 'quiz';
			tabPinned = true;
		} else if (tab === 'notes' && hasNotes) {
			activeTab = 'notes';
			tabPinned = true;
		} else if (tab === 'words' && hasWords) {
			activeTab = 'words';
			tabPinned = true;
		} else if (tab === 'questions' && hasQuestions) {
			activeTab = 'questions';
			tabPinned = true;
		} else if (tab === 'challenges' && hasChallenges) {
			activeTab = 'challenges';
			tabPinned = true;
		} else if (tab === 'article' && hasArticle) {
			activeTab = 'article';
			tabPinned = true;
		}
		// scripture tab is sticky header — open is enough; no tab switch
	}

	/** SSE highlight / scroll_to → switch tab and scroll to data-panel-id. */
	$: if (
		panelHighlightToken > 0 &&
		panelHighlightToken !== lastPanelHighlightToken &&
		panelHighlight
	) {
		lastPanelHighlightToken = panelHighlightToken;
		const kind = panelHighlight.kind;
		if (kind === 'note') {
			if (hasContext && contextComp?.notes.some((n) => n.id === panelHighlight!.id)) {
				activeTab = 'context';
			} else if (hasNotes) {
				activeTab = 'notes';
			}
			tabPinned = true;
		} else if (kind === 'tw' && hasWords) {
			activeTab = 'words';
			tabPinned = true;
		} else if (kind === 'tq' && hasQuestions) {
			activeTab = 'questions';
			tabPinned = true;
		} else if (kind === 'article' && hasArticle) {
			activeTab = 'article';
			tabPinned = true;
		}
		const targetId = panelHighlight.id;
		queueMicrotask(() => {
			const safe = targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			const el =
				document.querySelector(`[data-panel-id="${safe}"]`) ??
				document.querySelector(`[data-panel-path="${safe}"]`);
			if (el instanceof HTMLElement) {
				el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				el.classList.add('ring-2', 'ring-sky-400');
				setTimeout(() => el.classList.remove('ring-2', 'ring-sky-400'), 1800);
			}
		});
	}

	$: tabAvailability = {
		context: hasContext,
		quiz: hasQuiz,
		article: hasArticle,
		challenges: hasChallenges,
		notes: hasNotes,
		words: hasWords,
		questions: hasQuestions,
		checklist: hasChecklist
	} as Record<Tab, boolean>;

	$: visibleTabs = MODE_TABS[workflowMode].filter((t) => tabAvailability[t]);

	$: {
		if (visibleTabs.length > 0) {
			if (!visibleTabs.includes(activeTab)) {
				// Active tab hidden by the mode — fall back to the mode's priority tab.
				activeTab =
					hasArticle && visibleTabs.includes('article') && lastArticlePath
						? 'article'
						: visibleTabs[0];
			} else if (!tabPinned) {
				activeTab = hasArticle && visibleTabs.includes('article') ? 'article' : visibleTabs[0];
			}
		}
	}

	$: hasAnyContent =
		hasScripture ||
		hasContext ||
		hasNotes ||
		hasWords ||
		hasQuestions ||
		hasChallenges ||
		hasArticle ||
		hasChecklist ||
		hasQuiz;

	function setTab(tab: Tab) {
		activeTab = tab;
		tabPinned = true;
	}

	/** Icon + visible label + badge config per tab for the data-driven tab bar. */
	$: tabDefs = {
		context: {
			Icon: Library,
			label: 'Context',
			badge: String(contextComp?.notes.length ?? 0),
			badgeClass: 'bg-emerald-100 text-emerald-900',
			title: 'Context',
			aria: 'Book or chapter context'
		},
		quiz: {
			Icon: Brain,
			label: 'Quiz',
			badge:
				quizComp?.status === 'completed'
					? `${quizComp.correctCount ?? 0}/${quizComp.questions.length}`
					: String(quizComp?.questions.length ?? 0),
			badgeClass:
				quizComp?.status === 'completed' && quizComp.passed
					? 'bg-emerald-100 text-emerald-900'
					: 'bg-sky-100 text-sky-800',
			title: 'Context quiz',
			aria: 'Context quiz'
		},
		article: {
			Icon: GraduationCap,
			label: 'Article',
			badge: '',
			badgeClass: 'bg-sky-100 text-sky-800',
			title: 'Article',
			aria: 'Translation article'
		},
		challenges: {
			Icon: Target,
			label: 'Challenges',
			badge: String(challengesComp?.challenges.length ?? 0),
			badgeClass: 'bg-sky-100 text-sky-800',
			title: 'Challenges',
			aria: 'Translation challenges'
		},
		notes: {
			Icon: StickyNote,
			label: 'Notes',
			badge: String(notesComp?.notes.length ?? 0),
			badgeClass: 'bg-white text-[var(--bt-taupe)]',
			title: 'Notes',
			aria: 'Translation notes'
		},
		words: {
			Icon: KeyRound,
			label: 'Terms',
			badge: String(wordsComp?.words.length ?? 0),
			badgeClass: 'bg-amber-100 text-amber-900',
			title: 'Key terms',
			aria: 'Key terms'
		},
		questions: {
			Icon: HelpCircle,
			label: 'Questions',
			badge: String(questionsComp?.questions.length ?? 0),
			badgeClass: 'bg-white text-[var(--bt-taupe)]',
			title: 'Questions',
			aria: 'Comprehension questions'
		},
		checklist: {
			Icon: ClipboardCheck,
			label: 'Checking',
			badge: `${checklistPassage.progress.completed}/${checklistPassage.progress.total}`,
			badgeClass: 'bg-emerald-100 text-emerald-900',
			title: 'Checking checklist',
			aria: `Checking checklist ${checklistPassage.progress.completed} of ${checklistPassage.progress.total}`
		}
	} as Record<
		Tab,
		{
			Icon: typeof Library;
			label: string;
			badge: string;
			badgeClass: string;
			title: string;
			aria: string;
		}
	>;

	function tabBtn(tab: Tab): string {
		const base =
			'inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap';
		return tab === activeTab
			? `${base} border-b-2 border-sky-500 text-sky-300`
			: `${base} text-slate-500 hover:text-slate-300`;
	}

	function handleChallengeSelect(index: number) {
		const challenges = challengesComp?.challenges as ChallengeItem[] | undefined;
		const c = challenges?.find((ch) => ch.index === index);
		if (!c) return;
		onExplain({ kind: 'challenge', challenge: c });
		onExplored(c.index);
	}

	function handleSelectResource(payload: ResourcePayload) {
		onExplain(payload);
		if (payload.kind === 'challenge' && payload.challenge) {
			onExplored(payload.challenge.index);
		}
	}

	function handleQuestionSelect(q: {
		id: string;
		question: string;
		response?: string;
		verse?: string;
	}) {
		onExplain({
			kind: 'question',
			question: { id: q.id, question: q.question, response: q.response, verse: q.verse }
		});
	}

	function handlePhraseSelect(c: ChallengeItem) {
		handleChallengeSelect(c.index);
	}
</script>

<div
	class="flex h-full flex-col overflow-hidden border-slate-800 bg-slate-950
		{sheet ? 'rounded-t-2xl' : 'lg:border-l'}"
>
	{#if onClose || sheet}
		<div class="shrink-0 border-b border-slate-800 px-3 pt-2 pb-2">
			{#if sheet}
				<div class="mb-2 flex justify-center" aria-hidden="true">
					<div class="h-1 w-10 rounded-full bg-slate-600"></div>
				</div>
			{/if}
			<div class="flex items-center justify-between gap-2">
				<span class="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-200">
					<BookOpen size={16} strokeWidth={2} class="shrink-0 text-sky-400" />
					<span class="truncate">{scriptureReference || 'Passage helps'}</span>
				</span>
				{#if onClose}
					<button
						type="button"
						on:click={onClose}
						class="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
						aria-label="Close resources"
						title="Close resources"
					>
						Done
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if !hasAnyContent}
		<div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<Package size={40} strokeWidth={1.5} class="text-slate-700" />
			<p class="text-sm font-medium text-slate-500">No passage loaded</p>
			<p class="max-w-[16rem] text-xs text-slate-600">
				Ask about a Bible reference to open scripture, notes, and key terms here.
			</p>
		</div>
	{:else}
		{#if hasScripture}
			<div
				class="shrink-0 border-b border-slate-800
					{sheet ? 'max-h-[28%]' : 'max-h-[38%]'} min-h-[6.5rem]"
			>
				<div class="h-full overflow-y-auto overscroll-contain">
					<ScriptureTextPanel
						reference={scriptureReference}
						versions={scriptureVersions}
						{highlightPhrase}
						challenges={(challengesComp?.challenges ?? []) as ChallengeItem[]}
						exploredIndices={[...exploredSet]}
						onSelectChallenge={handlePhraseSelect}
					/>
				</div>
			</div>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			<div class="flex shrink-0 gap-0 overflow-x-auto border-b border-slate-800 bg-slate-950">
				{#each visibleTabs as tab (tab)}
					{@const def = tabDefs[tab]}
					{@const TabIcon = def.Icon}
					<button
						type="button"
						class={tabBtn(tab)}
						on:click={() => setTab(tab)}
						title={def.title}
						aria-label={def.aria}
					>
						<TabIcon size={12} strokeWidth={2} class="shrink-0" />
						<span>{def.label}</span>
						{#if def.badge}
							<span class="rounded-full px-1.5 {def.badgeClass}">{def.badge}</span>
						{/if}
					</button>
				{/each}
			</div>

			<div class="min-h-0 flex-1 overflow-hidden">
				{#if activeTab === 'context' && contextComp}
					<TranslationNotesPanel
						reference={contextComp.reference}
						notes={contextNotesForPanel}
						heading="Context"
						onSelectNote={handleSelectResource}
					/>
				{:else if activeTab === 'quiz' && quizComp}
					<ContextQuizPanel quiz={quizComp} {isLoading} onSubmit={onQuizSubmit} />
				{:else if activeTab === 'article' && articleComp}
					<AcademyArticlePanel
						path={articleComp.path}
						title={articleComp.title}
						markdown={articleComp.markdown}
						language={articleComp.language}
						onSelectResource={handleSelectResource}
					/>
				{:else if activeTab === 'challenges' && challengesComp}
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
						<div class="space-y-2">
							{#each questionsComp.questions as q (q.id)}
								{@const qKey = `question:${q.id}`}
								{@const qSelected =
									$studySession.scope.kind === 'resource' && $studySession.scope.key === qKey}
								<button
									type="button"
									data-panel-id={q.id}
									on:click={() => handleQuestionSelect(q)}
									class="w-full rounded-lg border p-3 text-left text-sm transition-all
										{qSelected
										? 'border-sky-500 bg-sky-50 ring-2 ring-sky-400/40'
										: 'border-[var(--bt-border)] bg-[var(--bt-parchment)] hover:border-sky-400'}"
								>
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
				{:else if activeTab === 'checklist' && hasChecklist}
					<CheckingChecklistPanel
						items={checklistPassage.items}
						completed={checklistPassage.progress.completed}
						total={checklistPassage.progress.total}
						{onCheckItem}
					/>
				{:else}
					<div
						class="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-600"
					>
						<p class="text-xs">No content for this tab</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
