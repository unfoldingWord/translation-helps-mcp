<script lang="ts">
	import { tick, onMount, onDestroy } from 'svelte';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Zap from 'lucide-svelte/icons/zap';
	import Check from 'lucide-svelte/icons/check';
	import ResourceSidePanel from '$lib/components/ui/ResourceSidePanel.svelte';
	import AgentBadge from '$lib/components/ui/AgentBadge.svelte';
	import XrayPanel from '$lib/components/debug/XrayPanel.svelte';
	import ChatDock from '$lib/components/chat/ChatDock.svelte';
	import DraftWorkspace from '$lib/components/ui/DraftWorkspace.svelte';
	import { withBase } from '$lib/paths.js';
	import { renderMarkdown, stripHiddenMarkers } from '$lib/renderMarkdown.js';
	import {
		bookCodeFromReference,
		mergeNewestWins,
		retainContextForPanel,
		type UIComponent
	} from '$core/harness/uiComponents.js';
	import type { AnyEvent, TimedEvent } from '$lib/components/debug/traceTypes.js';
	import type { TraceEvent } from '$lib/server/traceEvents.js';
	import {
		studySession,
		setPassage,
		setLanguagePair,
		setWorkflowMode,
		contextSnapshot,
		clearScope,
		resetSession,
		hydrateSession,
		selectResource,
		resourceLabel,
		type ResourcePayload,
		type ChallengeItem as StoreChallengeItem,
		type WorkflowMode
	} from '$lib/stores/studySession.js';
	import { resolveLanguagePair } from '$core/harness/languagePair.js';
	import { panelEmphasisForMode, parseWorkflowMode } from '$core/harness/workflowMode.js';
	import { ensureCheckingSessionFooter } from '$core/harness/intent.js';
	import { saveSession, loadSession, clearSession } from '$lib/stores/sessionPersistence.js';
	import {
		hydrateDrafts,
		bindDraftReference,
		tryHandleDraftRecall,
		DRAFT_RECALL_INTENT,
		redactDraftRecallForOutbound,
		flushActiveDraft,
		pendingDraftCoach,
		consumePendingDraftCoach,
		requestOpenDraft,
		draftContextLine
	} from '$lib/stores/draftStore.js';
	import {
		hydrateChecklist,
		applyMarkersFromText,
		checklistContextFor,
		checkingChecklist,
		listChecklistItems,
		checklistProgress,
		normalizePassageKey,
		type ChecklistItem
	} from '$lib/stores/checkingChecklistStore.js';
	import { formatCheckItemMessage } from '$core/checklist/checkingChecklist.js';
	import { formatQuizSubmitMessage } from '$core/harness/quizPanel.js';
	import { buildPanelState, type PanelFocusHint, type PanelTab } from '$core/harness/panelState.js';
	import { parsePanelAction, type PanelAction } from '$core/harness/panelActions.js';

	type UIComponentData = UIComponent;

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		sourceType?: 'tn' | 'tw';
		supportReference?: string;
		wordPath?: string;
		at?: string;
	}

	interface ToolCallTrace {
		tool: string;
		params: Record<string, unknown>;
		latencyMs: number;
		ok: boolean;
		error?: string;
		summary?: string;
		resultSnapshot?: unknown;
	}

	interface Message {
		role: 'user' | 'assistant';
		content: string;
		citations?: { path: string; title?: string }[];
		reference?: string;
		mode?: 'compose' | 'rag' | 'training-only' | 'error';
		dataWarning?: string;
		latencyMs?: number;
		model?: string;
		intent?: string;
		nextBatch?: string;
		challenges?: ChallengeItem[];
		drillIndex?: number;
		totalChallenges?: number;
		toolCalls?: ToolCallTrace[];
		uiComponents?: UIComponentData[];
		traceEvents?: TimedEvent[];
		/** Which agent authored this assistant message (default guide). */
		agent?: 'guide' | 'scholar' | 'checker';
		/** Compact action chip for resource-click user messages. */
		actionChip?: boolean;
	}

	interface PassageExchange {
		user?: Message;
		assistant?: Message;
		userIdx?: number;
		assistantIdx?: number;
	}

	interface PassageBlock {
		id: string;
		reference: string | null;
		exchanges: PassageExchange[];
		components: UIComponentData[];
	}

	interface UserProfile {
		name?: string;
		/** Legacy / receptor target. */
		language?: string;
		/** Door43 resources + coach conversation language. */
		sourceLanguage?: string;
		/** Receptor label ("translating into X"). */
		targetLanguage?: string;
		/** Last passage/book reference (e.g. "TIT 1") for resume on next visit. */
		lastReference?: string;
		/** Study | Translate | Check */
		workflowMode?: WorkflowMode;
		/** True when the user explicitly picked the mode (tab click) — always wins. */
		workflowModeExplicit?: boolean;
	}

	const PROFILE_KEY = 'th_profile';
	const XRAY_KEY = 'th_xray';
	let profile: UserProfile = {};

	let messages: Message[] = [];
	let input = '';
	/** Receptor / target language (legacy `language` alias). */
	let language = 'en';
	/** Source / conversation + Door43 resource language. */
	let sourceLanguage = 'en';
	$: targetLanguage = language;
	let model = 'gpt-4o';
	let isLoading = false;
	let error = '';
	let statusLine = '';

	let currentAbortController: AbortController | null = null;
	let generationId = 0;

	let xrayEnabled = false;
	let xrayOpen = false;

	let thinkingSteps: Map<string, 'working' | 'done'> = new Map();
	let feedEnd: HTMLElement;
	let feedEl: HTMLElement;
	let nearBottom = true;
	/** Mobile slide-over for the resource side panel. */
	let sidePanelOpen = false;
	/** Bumped when checking starts so the resources panel opens the Checking tab. */
	let checklistFocusToken = 0;
	/** Bumped when workflow mode / panel_action changes to emphasize a tab. */
	let panelFocusToken = 0;
	let panelFocusTab: PanelTab | null = null;
	/** Live active tab reported by ResourceSidePanel (for PANEL STATE). */
	let panelActiveTab: PanelTab | null = null;
	/** Last focused panel item (click / highlight) for PANEL STATE. */
	let panelFocusHint: PanelFocusHint | null = null;
	/** SSE highlight / scroll_to target. */
	let panelHighlight: {
		kind: 'note' | 'tw' | 'verse' | 'tq' | 'article';
		id: string;
		phrase?: string;
	} | null = null;
	let panelHighlightToken = 0;
	$: workflowMode = $studySession.workflowMode;
	/**
	 * True once the user explicitly picks a mode (tab click / deterministic UI
	 * action). Sent to the server so soft mode inference and the session-start
	 * clarify question never second-guess an explicit choice.
	 */
	let workflowModeExplicit = false;
	/** True while the dock input is focused (keyboard likely open). */
	let inputFocused = false;
	let keyboardScrollTimer: ReturnType<typeof setTimeout> | undefined;
	/** Debounce timer for persisting the chat transcript to localStorage. */
	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;
	/** Skip the first reactive save cycle after a restore / intentional clear. */
	let skipNextSessionSave = false;

	const HISTORY_PAYLOAD_LIMIT = 20;

	function persistChatSession() {
		if (skipNextSessionSave) {
			skipNextSessionSave = false;
			return;
		}
		if (messages.length === 0) return;
		// Never sticky-save a failed intro — reloads must be allowed to greet again.
		if (messages.every((m) => isFailedIntroMessage(m))) return;
		saveSession(messages as unknown as Array<Record<string, unknown>>, $studySession);
	}

	function scheduleSessionSave() {
		clearTimeout(sessionSaveTimer);
		sessionSaveTimer = setTimeout(() => persistChatSession(), 800);
	}

	/** Persist when a turn finishes (not while streaming). */
	$: if (!isLoading && messages.length > 0 && !messages.every((m) => isFailedIntroMessage(m))) {
		scheduleSessionSave();
	}

	interface CatalogLanguage {
		code: string;
		name?: string;
	}

	/** tc-ready languages from Door43 (`/api/languages`). */
	let catalogLanguages: CatalogLanguage[] = [];
	let languagesLoading = true;
	let languagesError = '';
	let languageFilter = '';

	/** False until the user picks a language (or one is restored from profile). */
	let languageChosen = false;

	$: knownLanguageCodes = new Set(catalogLanguages.map((l) => l.code));

	$: filteredLanguages = (() => {
		const q = languageFilter.trim().toLowerCase();
		if (!q) return catalogLanguages;
		return catalogLanguages.filter(
			(l) => l.code.toLowerCase().includes(q) || (l.name?.toLowerCase().includes(q) ?? false)
		);
	})();

	function isKnownLanguage(code: string): boolean {
		if (!code) return false;
		// Before catalog loads, accept any saved code so returning users can greet immediately.
		if (catalogLanguages.length === 0) return true;
		return knownLanguageCodes.has(code);
	}

	async function loadCatalogLanguages() {
		languagesLoading = true;
		languagesError = '';
		try {
			const res = await fetch(withBase('/api/languages'));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { languages?: CatalogLanguage[] };
			const list = (data.languages ?? [])
				.filter((l) => l?.code)
				.map((l) => ({ code: l.code, name: l.name || l.code }))
				.sort((a, b) =>
					(a.name || a.code).localeCompare(b.name || b.code, undefined, {
						sensitivity: 'base'
					})
				);
			catalogLanguages = list;
			if (list.length === 0) {
				languagesError = 'No tc-ready languages found in the catalog.';
			}
		} catch (err) {
			languagesError = err instanceof Error ? err.message : 'Failed to load languages from Door43.';
			catalogLanguages = [];
		} finally {
			languagesLoading = false;
		}
	}

	function languageNameFor(code: string): string | undefined {
		return catalogLanguages.find((l) => l.code === code)?.name;
	}

	/** True when a transcript entry is only the failed intro greeting placeholder. */
	function isFailedIntroMessage(msg: {
		role?: string;
		mode?: string;
		content?: string;
		intent?: string;
	}): boolean {
		if (msg.role !== 'assistant') return false;
		if (msg.mode === 'error' && (msg.content ?? '').includes('could not start the greeting')) {
			return true;
		}
		return msg.intent === 'intro' && msg.mode === 'error';
	}

	/** Session that should not block a fresh intro (empty or failed-greeting-only). */
	function shouldRetryIntro(
		msgs: Array<{ role?: string; mode?: string; content?: string; intent?: string }>
	): boolean {
		if (!msgs.length) return true;
		return msgs.every(isFailedIntroMessage);
	}

	function isAbortError(err: unknown): boolean {
		if (err instanceof DOMException && err.name === 'AbortError') return true;
		// Some browsers surface aborts as a generic TypeError during navigation/HMR.
		if (err instanceof Error && err.name === 'AbortError') return true;
		return false;
	}

	function isRetryableNetworkError(err: unknown): boolean {
		if (isAbortError(err)) return false;
		if (!(err instanceof TypeError)) return false;
		const msg = err.message.toLowerCase();
		return (
			msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')
		);
	}

	/** Drop sticky greeting failure UI once a real turn succeeds. */
	function clearGreetingFailureState() {
		error = '';
		if (messages.some(isFailedIntroMessage)) {
			messages = messages.filter((m) => !isFailedIntroMessage(m));
		}
	}

	function beginChatRequest(): { signal: AbortSignal; myGenId: number } {
		// Bump generation before abort so an in-flight catch cannot overwrite the new turn.
		const myGenId = ++generationId;
		currentAbortController?.abort();
		currentAbortController = new AbortController();
		return { signal: currentAbortController.signal, myGenId };
	}

	/** Stream Ezer's intro in the source/conversation language (no user bubble). */
	async function requestIntroGreeting(name?: string, attempt = 0) {
		if (isLoading && attempt === 0) return;

		languageChosen = true;
		nearBottom = true;

		isLoading = true;
		statusLine = '';
		thinkingSteps = new Map();
		error = '';

		const { signal, myGenId } = beginChatRequest();

		messages = [
			{
				role: 'assistant',
				content: '',
				agent: 'guide',
				mode: undefined,
				latencyMs: undefined,
				model,
				traceEvents: xrayEnabled ? [] : undefined
			}
		];
		const assistantIdx = 0;
		const start = Date.now();
		await tick();
		scrollFeedToEnd('smooth');

		try {
			const res = await fetch(withBase('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					intent: 'intro',
					messages: [],
					language: targetLanguage,
					languageName: languageNameFor(sourceLanguage),
					sourceLanguage,
					targetLanguage,
					model,
					profile: {
						...profile,
						language: targetLanguage,
						sourceLanguage,
						targetLanguage,
						name: name ?? profile.name
					},
					debug: xrayEnabled
				}),
				signal
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (!res.body) throw new Error('No response body');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let sseBuffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (myGenId !== generationId) {
					reader.cancel().catch(() => {});
					break;
				}

				sseBuffer += decoder.decode(value, { stream: true });
				const frames = sseBuffer.split('\n\n');
				sseBuffer = frames.pop() ?? '';

				for (const frame of frames) {
					if (myGenId !== generationId) break;
					const lines = frame.split('\n');
					let event = 'message';
					let data = '';
					for (const line of lines) {
						if (line.startsWith('event:')) event = line.slice(6).trim();
						else if (line.startsWith('data:')) data = line.slice(5).trim();
					}
					if (!data) continue;

					try {
						const parsed = JSON.parse(data) as Record<string, unknown>;
						if (event === 'status') {
							statusLine = String(parsed.text ?? '');
						} else if (event === 'token') {
							if (!messages[assistantIdx]) return;
							messages[assistantIdx] = {
								...messages[assistantIdx],
								content: (messages[assistantIdx].content ?? '') + String(parsed.delta ?? '')
							};
							messages = messages;
							scrollFeedToEnd('auto');
						} else if (event === 'done') {
							statusLine = '';
							error = '';
							const doneResponse =
								typeof parsed.response === 'string' ? parsed.response : undefined;
							if (doneResponse) {
								messages[assistantIdx] = {
									...messages[assistantIdx],
									content: doneResponse
								};
							}
							const doneRef = typeof parsed.reference === 'string' ? parsed.reference : undefined;
							if (doneRef) {
								setPassage(doneRef, language);
								profile = { ...profile, lastReference: doneRef };
								saveProfile();
							}
							if (messages[assistantIdx]) {
								messages[assistantIdx] = {
									...messages[assistantIdx],
									agent: 'guide',
									mode: 'compose',
									reference: doneRef ?? messages[assistantIdx].reference,
									latencyMs: Date.now() - start,
									model: typeof parsed.model === 'string' ? parsed.model : model,
									intent: 'intro'
								};
							}
							messages = messages;
						} else if (event === 'error') {
							statusLine = '';
							const errMsg = String(parsed.message ?? 'Unknown error');
							messages[assistantIdx] = {
								...messages[assistantIdx],
								content: `Sorry, something went wrong: ${errMsg}`,
								mode: 'error',
								latencyMs: Date.now() - start
							};
							messages = messages;
						}
					} catch {
						/* ignore malformed SSE frame */
					}
				}
			}

			if (myGenId === generationId && messages[assistantIdx] && !messages[assistantIdx].content) {
				messages[assistantIdx] = {
					...messages[assistantIdx],
					content: 'Hi — I am Ezer. Which passage are you working on?',
					mode: 'compose',
					latencyMs: Date.now() - start
				};
				messages = messages;
			}
		} catch (err) {
			if (myGenId !== generationId) return;
			if (isAbortError(err)) return;

			// One retry covers Vite HMR / brief workerd blips on first paint.
			if (attempt < 1 && isRetryableNetworkError(err)) {
				isLoading = false;
				await new Promise((r) => setTimeout(r, 350));
				if (myGenId !== generationId) return;
				return requestIntroGreeting(name, attempt + 1);
			}

			const msg = err instanceof Error ? err.message : String(err);
			error = msg;
			messages = [
				{
					role: 'assistant',
					content: `Sorry, I could not start the greeting (${msg}). You can still ask about a passage.`,
					mode: 'error',
					agent: 'guide'
				}
			];
			// Do not persist a failed intro — otherwise reloads restore the error and skip retry.
			skipNextSessionSave = true;
			clearSession();
		} finally {
			if (myGenId === generationId) {
				isLoading = false;
				statusLine = '';
				currentAbortController = null;
				const failedOnly = messages.length > 0 && messages.every((m) => isFailedIntroMessage(m));
				if (!failedOnly && messages.some((m) => m.content?.trim())) {
					persistChatSession();
				}
			}
		}
	}

	function applyLanguagePair(pair: { sourceLanguage: string; targetLanguage: string }) {
		sourceLanguage = pair.sourceLanguage;
		language = pair.targetLanguage;
		profile = {
			...profile,
			language: pair.targetLanguage,
			sourceLanguage: pair.sourceLanguage,
			targetLanguage: pair.targetLanguage
		};
		setLanguagePair(pair);
	}

	/**
	 * Initial picker: language chosen = SOURCE (resources + conversation).
	 * Target stays the neutral "my language" placeholder — never asked in onboarding.
	 */
	function chooseLanguage(code: string) {
		if (!isKnownLanguage(code)) return;
		languageChosen = true;
		languageFilter = '';
		applyLanguagePair(resolveLanguagePair({ sourceLanguage: code }));
		saveProfile();
		void requestIntroGreeting(profile.name);
	}

	function scrollFeedToEnd(behavior: ScrollBehavior = 'smooth') {
		if (!nearBottom) return;
		tick().then(() => {
			feedEnd?.scrollIntoView({ behavior, block: 'end' });
			if (feedEl) {
				feedEl.scrollTop = feedEl.scrollHeight;
			}
		});
	}

	function handleInputFocus() {
		inputFocused = true;
		nearBottom = true;
		// Keyboard animation takes ~250–350ms on most mobile browsers.
		clearTimeout(keyboardScrollTimer);
		keyboardScrollTimer = setTimeout(() => scrollFeedToEnd('smooth'), 300);
	}

	function handleInputBlur() {
		inputFocused = false;
		clearTimeout(keyboardScrollTimer);
	}

	function studyContextWithChecklist(): string {
		const base = contextSnapshot();
		const checklist = checklistContextFor($studySession.reference);
		// Drafts: reference keys only (never draft bodies) — privacy preserved.
		const drafts = draftContextLine();
		return [base, drafts, checklist].filter(Boolean).join('\n\n');
	}

	/** Structured panel snapshot for coach awareness (no draft bodies). */
	function currentPanelState() {
		const comps = panelComponents;
		const context = comps.find((c) => c.type === 'passage_context') as
			| Extract<UIComponentData, { type: 'passage_context' }>
			| undefined;
		const notes = comps.find((c) => c.type === 'translation_notes') as
			| Extract<UIComponentData, { type: 'translation_notes' }>
			| undefined;
		const words = comps.find((c) => c.type === 'translation_words') as
			| Extract<UIComponentData, { type: 'translation_words' }>
			| undefined;
		const questions = comps.find((c) => c.type === 'translation_questions') as
			| Extract<UIComponentData, { type: 'translation_questions' }>
			| undefined;
		const challenges = comps.find((c) => c.type === 'challenge_cards') as
			| Extract<UIComponentData, { type: 'challenge_cards' }>
			| undefined;
		const article = comps.find((c) => c.type === 'academy_article') as
			| Extract<UIComponentData, { type: 'academy_article' }>
			| undefined;
		const quiz = comps.find((c) => c.type === 'context_quiz') as
			| Extract<UIComponentData, { type: 'context_quiz' }>
			| undefined;
		const scripture = comps.find(
			(c) => c.type === 'scripture_text' || c.type === 'scripture_panel'
		);

		const ref =
			(typeof context?.reference === 'string' && context.reference) ||
			(typeof notes?.reference === 'string' && notes.reference) ||
			$studySession.reference ||
			undefined;

		void $checkingChecklist;
		const passage = ref ? $checkingChecklist.passages[normalizePassageKey(ref)] : undefined;
		const items = listChecklistItems(passage);
		const progress = checklistProgress(passage);
		const pendingTitles = items
			.filter((it) => !it.completed)
			.slice(0, 5)
			.map((it) => it.title)
			.filter(Boolean);

		let quizState: {
			status: 'inactive' | 'active' | 'graded';
			answered?: number;
			total?: number;
			correct?: number;
			passed?: boolean;
		} | null = null;
		if (!quiz) {
			quizState = { status: 'inactive' };
		} else if (quiz.status === 'completed') {
			quizState = {
				status: 'graded',
				total: quiz.questions.length,
				correct: quiz.correctCount,
				answered: quiz.questions.length,
				passed: quiz.passed
			};
		} else {
			const answered = quiz.questions.filter(
				(q) => typeof q.chosen === 'string' && q.chosen.length > 0
			).length;
			quizState = {
				status: 'active',
				answered,
				total: quiz.questions.length
			};
		}

		return buildPanelState({
			open: sidePanelOpen,
			tab: panelActiveTab,
			reference: ref,
			scriptureLoaded: !!scripture,
			contextNotes: context?.notes.map((n) => ({
				id: n.id,
				title: n.title
			})),
			translationNotes: notes?.notes.map((n) => ({
				id: n.id,
				title: n.quote || n.verse
			})),
			keyTerms: words?.words.map((w) => ({
				id: w.id,
				term: w.term
			})),
			questionsCount: questions?.questions.length,
			challengesCount: challenges?.challenges.length,
			article: article ? { path: article.path, title: article.title } : null,
			quiz: quizState,
			checklist:
				progress.total > 0
					? {
							completed: progress.completed,
							total: progress.total,
							pendingTitles
						}
					: null,
			focusHint: panelFocusHint
		});
	}

	/** Execute a typed panel_action from SSE. */
	function applyPanelAction(action: PanelAction) {
		if (action.type === 'panel.open') {
			sidePanelOpen = true;
			return;
		}
		if (action.type === 'panel.focus_tab') {
			sidePanelOpen = true;
			if (action.tab === 'scripture') {
				// Scripture is the sticky header — open is enough.
				return;
			}
			panelFocusTab = action.tab;
			panelFocusToken += 1;
			if (action.tab === 'checklist') {
				checklistFocusToken += 1;
			}
			return;
		}
		if (action.type === 'panel.highlight' || action.type === 'panel.scroll_to') {
			sidePanelOpen = true;
			panelHighlight = {
				kind: action.kind,
				id: action.id,
				...(action.type === 'panel.highlight' && action.phrase ? { phrase: action.phrase } : {})
			};
			panelHighlightToken += 1;
			panelFocusHint = {
				kind:
					action.kind === 'tw'
						? 'tw'
						: action.kind === 'tq'
							? 'tq'
							: action.kind === 'article'
								? 'article'
								: action.kind === 'verse'
									? 'verse'
									: 'note',
				id: action.id,
				...(action.type === 'panel.highlight' && action.phrase ? { title: action.phrase } : {})
			};
		}
	}

	/** When panel resources arrive, bind study ref early and emphasize Context. */
	function onPanelUiComponent(component: UIComponentData) {
		const ref =
			'reference' in component && typeof component.reference === 'string'
				? component.reference
				: null;
		if (
			ref &&
			(component.type === 'passage_context' ||
				component.type === 'scripture_text' ||
				component.type === 'translation_notes' ||
				component.type === 'context_quiz')
		) {
			setPassage(ref, { sourceLanguage, targetLanguage, language: targetLanguage });
			profile = { ...profile, lastReference: ref };
			saveProfile();
		}
		if (
			component.type === 'passage_context' ||
			component.type === 'scripture_text' ||
			component.type === 'context_quiz'
		) {
			sidePanelOpen = true;
			if (component.type === 'passage_context') {
				panelFocusTab = 'context';
				panelFocusToken += 1;
			}
		}
	}

	onMount(() => {
		hydrateDrafts();
		hydrateChecklist();
		let restoredFromSession = false;
		try {
			const stored = localStorage.getItem(PROFILE_KEY);
			if (stored) {
				profile = JSON.parse(stored) as UserProfile;
			}
		} catch {
			/* ignore */
		}
		workflowModeExplicit = profile.workflowModeExplicit === true;

		try {
			xrayEnabled = localStorage.getItem(XRAY_KEY) === 'true';
		} catch {
			/* ignore */
		}

		if (profile.language || profile.targetLanguage || profile.sourceLanguage) {
			// Legacy profiles with only `language` → gateway codes (en/es-419/…)
			// map to SOURCE inside resolveLanguagePair; target defaults neutral.
			const pair = resolveLanguagePair({
				language: profile.language,
				sourceLanguage: profile.sourceLanguage,
				targetLanguage: profile.targetLanguage
			});
			applyLanguagePair(pair);
			languageChosen = true;

			const session = loadSession();
			const sessionMsgs = session?.messages ?? [];
			if (sessionMsgs.length && !shouldRetryIntro(sessionMsgs)) {
				// Continue where left off — restore transcript + study state, skip intro.
				skipNextSessionSave = true;
				messages = sessionMsgs as Message[];
				hydrateSession({
					...session!.study,
					language: pair.targetLanguage,
					sourceLanguage: pair.sourceLanguage,
					targetLanguage: pair.targetLanguage,
					workflowMode: parseWorkflowMode(session!.study.workflowMode ?? profile.workflowMode)
				});
				restoredFromSession = true;
				nearBottom = true;
				tick().then(() => scrollFeedToEnd('auto'));
			} else {
				if (sessionMsgs.length) {
					// Failed-intro-only (or empty) session — clear and greet again.
					skipNextSessionSave = true;
					clearSession();
				}
				setLanguagePair(pair);
				// No usable transcript — LLM greets in source/conversation language.
				void requestIntroGreeting(profile.name);
			}
		}

		if (!restoredFromSession && profile.workflowMode) {
			setWorkflowMode(parseWorkflowMode(profile.workflowMode));
		}

		void loadCatalogLanguages().then(() => {
			// If the saved SOURCE language is no longer in the tc-ready catalog,
			// return to picker. (Target may be the neutral "my language" label —
			// never validate it against the catalog.)
			const saved = sourceLanguage || profile.sourceLanguage;
			if (
				languageChosen &&
				saved &&
				catalogLanguages.length > 0 &&
				!catalogLanguages.some((l) => l.code === saved)
			) {
				languageChosen = false;
				messages = [];
				clearSession();
			}
		});

		const vv = window.visualViewport;
		const onVvResize = () => {
			if (!inputFocused) return;
			scrollFeedToEnd('auto');
		};
		vv?.addEventListener('resize', onVvResize);
		return () => {
			vv?.removeEventListener('resize', onVvResize);
			clearTimeout(keyboardScrollTimer);
			clearTimeout(sessionSaveTimer);
			// Invalidate in-flight greeting/chat so unmount cannot paint a stale error.
			generationId++;
			currentAbortController?.abort();
			currentAbortController = null;
			// Flush a pending save on unmount when we have content.
			if (!restoredFromSession || messages.length > 0) {
				if (messages.length > 0 && !isLoading && !messages.every((m) => isFailedIntroMessage(m))) {
					persistChatSession();
				}
			}
		};
	});

	onDestroy(() => {
		flushActiveDraft();
		clearTimeout(keyboardScrollTimer);
		clearTimeout(sessionSaveTimer);
	});

	function saveProfile() {
		try {
			localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
		} catch {
			/* ignore */
		}
	}

	/**
	 * End sticky CHECKING session in the transcript (no chat turn required).
	 * Returns true when a live marker was replaced with <!-- CHECKING:cleared -->.
	 */
	function clearStickyCheckingInMessages(): boolean {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role !== 'assistant') continue;
			if (/<!--\s*CHECKING:cleared\s*-->/i.test(m.content)) return false;
			if (/<!--\s*CHECKING:(?!cleared)[^>]*-->/i.test(m.content)) {
				messages[i] = {
					...m,
					content: ensureCheckingSessionFooter(m.content, '', { cleared: true })
				};
				messages = messages;
				return true;
			}
		}
		return false;
	}

	/** Apply Study | Translate | Check — persist, emphasize panels, open draft when needed. */
	function applyWorkflowMode(mode: WorkflowMode, opts: { explicit?: boolean } = {}) {
		const next = parseWorkflowMode(mode);
		// Leaving sticky Check via UI mode click must clear the session marker
		// so the next turn is not trapped in Checker / Revisar.
		if (next === 'study' || next === 'translate') {
			clearStickyCheckingInMessages();
		}
		setWorkflowMode(next);
		if (opts.explicit) {
			workflowModeExplicit = true;
		}
		profile = { ...profile, workflowMode: next, workflowModeExplicit };
		saveProfile();
		// Mode-only switch (no chat turn) must still land in th_session.
		scheduleSessionSave();

		const emphasis = panelEmphasisForMode(next);
		if (emphasis === 'context') {
			panelFocusTab = 'context';
			panelFocusToken += 1;
			sidePanelOpen = true;
		} else if (emphasis === 'checklist') {
			panelFocusTab = 'checklist';
			panelFocusToken += 1;
			checklistFocusToken += 1;
			sidePanelOpen = true;
		} else if (emphasis === 'draft') {
			requestOpenDraft();
		}
	}

	function handleWorkflowModeChange(e: CustomEvent<WorkflowMode>) {
		// A tab click is an explicit choice — it always wins over inference.
		applyWorkflowMode(e.detail, { explicit: true });
	}

	function saveXray() {
		try {
			localStorage.setItem(XRAY_KEY, String(xrayEnabled));
		} catch {
			/* ignore */
		}
	}

	function normalizeRef(ref?: string | null): string | null {
		if (!ref) return null;
		const t = ref.trim().toLowerCase().replace(/\s+/g, ' ');
		return t || null;
	}

	function refFromComponents(comps: UIComponentData[] | undefined): string | null {
		if (!comps?.length) return null;
		for (const c of comps) {
			if (
				(c.type === 'scripture_text' ||
					c.type === 'passage_context' ||
					c.type === 'translation_notes' ||
					c.type === 'translation_words' ||
					c.type === 'translation_questions') &&
				'reference' in c &&
				typeof c.reference === 'string' &&
				c.reference
			) {
				return c.reference;
			}
		}
		return null;
	}

	function buildPassageBlocks(msgs: Message[]): PassageBlock[] {
		const blocks: PassageBlock[] = [];
		let i = 0;

		while (i < msgs.length) {
			let user: Message | undefined;
			let userIdx: number | undefined;
			let assistant: Message | undefined;
			let assistantIdx: number | undefined;

			if (msgs[i].role === 'user') {
				user = msgs[i];
				userIdx = i;
				i++;
				if (i < msgs.length && msgs[i].role === 'assistant') {
					assistant = msgs[i];
					assistantIdx = i;
					i++;
				}
			} else {
				assistant = msgs[i];
				assistantIdx = i;
				i++;
			}

			const effectiveRef =
				assistant?.reference ?? refFromComponents(assistant?.uiComponents) ?? null;
			const effectiveNorm = normalizeRef(effectiveRef);
			const last = blocks[blocks.length - 1];
			const lastNorm = last ? normalizeRef(last.reference) : null;

			const samePassage =
				!!last &&
				((effectiveNorm && lastNorm && effectiveNorm === lastNorm) ||
					(!effectiveNorm && !!lastNorm) ||
					(!effectiveNorm && !lastNorm));

			if (samePassage && last) {
				last.exchanges.push({ user, assistant, userIdx, assistantIdx });
				if (effectiveRef && !last.reference) last.reference = effectiveRef;
			} else {
				blocks.push({
					id: `block-${blocks.length}-${effectiveNorm ?? 'general'}`,
					reference: effectiveRef,
					exchanges: [{ user, assistant, userIdx, assistantIdx }],
					components: []
				});
			}
		}

		for (const block of blocks) {
			const lists = block.exchanges.map((e) => e.assistant?.uiComponents ?? []);
			block.components = mergeNewestWins(lists);
		}

		return blocks;
	}

	function blockSummary(comps: UIComponentData[]) {
		const challenges = comps.find((c) => c.type === 'challenge_cards') as
			| Extract<UIComponentData, { type: 'challenge_cards' }>
			| undefined;
		const context = comps.find((c) => c.type === 'passage_context') as
			| Extract<UIComponentData, { type: 'passage_context' }>
			| undefined;
		const notes = comps.find((c) => c.type === 'translation_notes') as
			| Extract<UIComponentData, { type: 'translation_notes' }>
			| undefined;
		const words = comps.find((c) => c.type === 'translation_words') as
			| Extract<UIComponentData, { type: 'translation_words' }>
			| undefined;
		const questions = comps.find((c) => c.type === 'translation_questions') as
			| Extract<UIComponentData, { type: 'translation_questions' }>
			| undefined;
		const article = comps.find((c) => c.type === 'academy_article') as
			| Extract<UIComponentData, { type: 'academy_article' }>
			| undefined;
		return {
			challenges: challenges?.challenges.length ?? 0,
			context: context?.notes.length ?? 0,
			notes: notes?.notes.length ?? 0,
			words: words?.words.length ?? 0,
			questions: questions?.questions.length ?? 0,
			articles: article ? 1 : 0
		};
	}

	function scriptureFromComponents(comps: UIComponentData[]) {
		const scriptureTextComp = comps.find((c) => c.type === 'scripture_text') as
			| Extract<UIComponentData, { type: 'scripture_text' }>
			| undefined;
		const scripturePanelComp = comps.find((c) => c.type === 'scripture_panel') as
			| Extract<UIComponentData, { type: 'scripture_panel' }>
			| undefined;
		const notesComp = comps.find((c) => c.type === 'translation_notes') as
			| Extract<UIComponentData, { type: 'translation_notes' }>
			| undefined;
		const wordsComp = comps.find((c) => c.type === 'translation_words') as
			| Extract<UIComponentData, { type: 'translation_words' }>
			| undefined;
		const questionsComp = comps.find((c) => c.type === 'translation_questions') as
			| Extract<UIComponentData, { type: 'translation_questions' }>
			| undefined;
		const challengesComp = comps.find((c) => c.type === 'challenge_cards') as
			| Extract<UIComponentData, { type: 'challenge_cards' }>
			| undefined;

		const versions =
			scriptureTextComp?.versions ??
			scripturePanelComp?.verses.map((v) => ({ label: v.label, text: v.text })) ??
			[];
		if (versions.length === 0) return null;

		return {
			versions,
			reference:
				scriptureTextComp?.reference ??
				notesComp?.reference ??
				wordsComp?.reference ??
				questionsComp?.reference ??
				'',
			highlightPhrase: scriptureTextComp?.highlightPhrase ?? scripturePanelComp?.highlightPhrase,
			challenges: (challengesComp?.challenges ?? []) as StoreChallengeItem[]
		};
	}

	$: passageBlocks = buildPassageBlocks(messages);

	$: xrayTurns = (() => {
		const result: Array<{
			userSnippet: string;
			events: TimedEvent[];
			live?: boolean;
			statusText?: string;
		}> = [];
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (msg.role !== 'assistant') continue;
			const userMsg = i > 0 && messages[i - 1].role === 'user' ? messages[i - 1].content : '…';
			result.push({
				userSnippet: userMsg.slice(0, 80) + (userMsg.length > 80 ? '…' : ''),
				events: msg.traceEvents ?? [],
				live: isLoading && i === messages.length - 1,
				statusText: isLoading && i === messages.length - 1 ? statusLine : undefined
			});
		}
		return result;
	})();

	$: xrayEventCount = messages.reduce((s, m) => s + (m.traceEvents?.length ?? 0), 0);

	$: hasAnyResources = messages.some(
		(m) => m.role === 'assistant' && (m.uiComponents?.length ?? 0) > 0
	);

	$: scope = $studySession.scope;

	/** Keep Mi traducción bound to the current study passage (switch keys; don't wipe text). */
	$: bindDraftReference($studySession.reference);

	/**
	 * Latest passage block feeds the side panel, but book/chapter context is
	 * retained from earlier same-book blocks (TIT → TIT 1 → TIT 1:1-4).
	 * Falls back to studySession.reference so a general follow-up turn cannot
	 * clear the empty-state when Tito/TIT is already bound.
	 */
	$: panelComponents = (() => {
		if (passageBlocks.length === 0) return [] as UIComponentData[];
		const latest = passageBlocks[passageBlocks.length - 1];
		const latestBook =
			bookCodeFromReference(latest.reference ?? '') ||
			bookCodeFromReference($studySession.reference ?? '');
		if (!latestBook) {
			return retainContextForPanel(
				passageBlocks.map((b) => b.components),
				latest.components
			);
		}
		const sameBookComponents = passageBlocks
			.filter((b) => {
				const book = bookCodeFromReference(b.reference ?? '');
				return !!book && book === latestBook;
			})
			.map((b) => b.components);
		// Include any orphaned same-book uiComponents from messages whose block
		// reference was missing (e.g. streaming before done sets reference).
		const orphaned = messages
			.filter((m) => m.role === 'assistant' && (m.uiComponents?.length ?? 0) > 0)
			.filter((m) => {
				const ref = m.reference ?? refFromComponents(m.uiComponents);
				const book = bookCodeFromReference(ref ?? '');
				return book === latestBook;
			})
			.map((m) => m.uiComponents ?? []);
		const mergedLists =
			orphaned.length > 0 ? [...sameBookComponents, ...orphaned] : sameBookComponents;
		return retainContextForPanel(mergedLists, latest.components);
	})();

	$: panelSummary = blockSummary(panelComponents);
	$: panelResourceCount =
		panelSummary.challenges +
		panelSummary.context +
		panelSummary.notes +
		panelSummary.words +
		panelSummary.questions +
		panelSummary.articles;

	function actionChipText(payload: ResourcePayload): string {
		switch (payload.kind) {
			case 'note': {
				const q = payload.note?.quote;
				return q ? `Explain note: "${q}"` : 'Explain this translation note';
			}
			case 'word':
				return payload.word?.term ? `Explain word: ${payload.word.term}` : 'Explain this key term';
			case 'article':
				return payload.article?.title
					? `Explain translation concept: ${payload.article.title}`
					: 'Explain this translation concept';
			case 'challenge':
				return payload.challenge
					? `Explain challenge: "${payload.challenge.phrase}"`
					: 'Explain this challenge';
			case 'question':
				return 'Help with this comprehension question';
			case 'verse':
				return payload.verse?.reference
					? `Explain verse: ${payload.verse.reference}`
					: 'Explain this verse';
			default:
				return `Explain: ${resourceLabel(payload)}`;
		}
	}

	function scriptureContextFromPanel(): {
		reference: string;
		versions: Array<{ label?: string; resourceType?: string; text: string }>;
	} | null {
		const scripture = scriptureFromComponents(panelComponents);
		if (!scripture?.versions?.length) {
			const ref = $studySession.reference;
			return ref ? { reference: ref, versions: [] } : null;
		}
		return {
			reference: scripture.reference || $studySession.reference || '',
			versions: scripture.versions.map((v) => ({
				label: v.label,
				resourceType: (v as { resourceType?: string }).resourceType,
				text: v.text
			}))
		};
	}

	function onFeedScroll() {
		if (!feedEl) return;
		const dist = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
		nearBottom = dist < 120;
	}

	$: if ((messages.length || isLoading) && nearBottom) {
		scrollFeedToEnd('smooth');
	}

	function stripUsfm(text: string): string {
		return text
			.replace(/\\zaln-[se][^\\]*\\\*/g, '')
			.replace(/\\zaln-[se]\s*\\\*/g, '')
			.replace(/\\w\s+(.*?)\|[^\\]+\\w\*/g, '$1')
			.replace(/\\w\s+(.*?)\\w\*/g, '$1')
			.replace(/\\v\s+\d+\s*/g, '')
			.replace(/\\c\s+\d+\s*/g, '')
			.replace(/\\[a-zA-Z0-9]+\*?\s*/g, '');
	}

	function renderMarkdownLocal(text: string): string {
		try {
			const clean = stripUsfm(text.replace(/<!--[\s\S]*?-->/g, '').trimEnd());
			return renderMarkdown(clean);
		} catch {
			return text;
		}
	}

	function modeLabel(mode?: string): string {
		if (mode === 'compose') return 'passage + RAG + AI';
		if (mode === 'rag') return 'semantic search + AI';
		if (mode === 'training-only') return '⚠ training knowledge only';
		if (mode === 'error') return 'error';
		return '';
	}

	/** Merge UI components by type — prefer existing, fill gaps from fallback. */
	function mergeUiComponents(
		existing: UIComponentData[],
		fallback: UIComponentData[]
	): UIComponentData[] {
		if (!fallback.length) return existing;
		if (!existing.length) return fallback;
		const byType = new Map<string, UIComponentData>();
		for (const c of fallback) byType.set(c.type, c);
		for (const c of existing) byType.set(c.type, c);
		return [...byType.values()];
	}

	function compactGlobalHistory(): string {
		const recent = messages.slice(-6);
		if (recent.length === 0) return '';
		return recent
			.map((m) => {
				const who =
					m.role === 'user'
						? 'User'
						: m.agent === 'scholar'
							? 'Scholar'
							: m.agent === 'checker'
								? 'Checker'
								: 'Guide';
				// Draft bodies stay on-device — redact recall cards here too.
				return `${who}: ${redactDraftRecallForOutbound(m).slice(0, 200)}`;
			})
			.join('\n');
	}

	/**
	 * Client-safe passage-ref detectors for routing out of sticky Scholar scope.
	 * Keep these local — do NOT import $core/harness/intent (pulls door43/fflate
	 * into the browser bundle and breaks /chat with a bare "fflate" specifier).
	 * The server still does precise resolution via extractReferenceInfo / relativeRef.
	 */
	function looksLikeExplicitRef(text: string): boolean {
		// USFM-ish: RUT 1, TIT 1:1, 1CO 3:16
		if (/\b[1-3]?[A-Za-z]{2,3}\s+\d+(?::\d+(?:-\d+)?)?\b/.test(text)) return true;
		// Named book + chapter/verse: "Rut 1:1", "Juan 3", "1 Corintios 2:5"
		if (
			/\b(?:[123]\s+)?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)?\s+\d+(?::\d+(?:-\d+)?)?\b/.test(
				text
			)
		) {
			return true;
		}
		return false;
	}

	function mentionsRelativeRef(text: string): boolean {
		const hasUnit =
			/\b(vers[ií]culos?|versos?|verses?|cap[ií]tulos?|chapters?)\b/i.test(text) ||
			/\b(ch|cap)\.?\s*\d+/i.test(text);
		if (!hasUnit) return false;
		const hasNumber = /\d+/.test(text);
		const hasOrdinal =
			/\b(first|second|third|fourth|fifth|primer[ao]?|segund[ao]|tercer[ao]?|cuart[ao]|quint[ao]|1st|2nd|3rd|4th|5th)\b/i.test(
				text
			);
		return hasNumber || hasOrdinal;
	}

	async function send() {
		const text = input.trim();
		if (!text || isLoading) return;

		input = '';
		clearGreetingFailureState();
		nearBottom = true;

		// Client-side draft recall — local th_drafts assemble (no server round-trip).
		const draftReply = tryHandleDraftRecall(text, $studySession.reference);
		if (draftReply !== null) {
			messages = [
				...messages,
				{ role: 'user', content: text },
				{
					role: 'assistant',
					content: draftReply,
					agent: 'guide',
					reference: $studySession.reference ?? undefined,
					intent: DRAFT_RECALL_INTENT
				}
			];
			return;
		}

		// Escape sticky Scholar scope when the user names a new passage (explicit
		// "Rut 1:1" or relative "verse 1" / "capítulo 1") so the Guide can fetch
		// scripture + resources via MCP tools.
		if (scope.kind === 'resource') {
			if (looksLikeExplicitRef(text) || mentionsRelativeRef(text)) {
				clearScope();
				await sendGlobalChat(text);
				return;
			}
			await sendResourceChat(text);
		} else {
			await sendGlobalChat(text);
		}
	}

	/** Mi traducción / Check draft → main chat coach (skillChat checking path). */
	let handlingDraftCoach = false;
	$: if ($pendingDraftCoach && !isLoading && !handlingDraftCoach) {
		void flushPendingDraftCoach();
	}

	async function flushPendingDraftCoach() {
		const pending = consumePendingDraftCoach();
		if (!pending || isLoading) return;
		handlingDraftCoach = true;
		try {
			applyWorkflowMode('check', { explicit: true });
			clearScope();
			clearGreetingFailureState();
			nearBottom = true;
			await sendGlobalChat(pending.message);
		} finally {
			handlingDraftCoach = false;
		}
	}

	/**
	 * Checking-checklist item click → coach checks that single item in chat.
	 * Sends visible "Let's check: …" + hidden CHECKITEM marker (draft-submit
	 * pattern). Never toggles the item — only coach CHECK markers complete it.
	 */
	async function handleChecklistItemCheck(item: ChecklistItem) {
		if (isLoading) return;
		applyWorkflowMode('check', { explicit: true });
		panelFocusHint = {
			kind: 'checklist',
			id: item.resourceId,
			title: item.title
		};
		clearScope();
		sidePanelOpen = false;
		clearGreetingFailureState();
		nearBottom = true;
		await sendGlobalChat(
			formatCheckItemMessage({
				kind: item.kind,
				resourceId: item.resourceId,
				title: item.title,
				verse: item.verse,
				language: sourceLanguage,
				completed: item.completed
			})
		);
	}

	/**
	 * Context-quiz Submit from the resources panel → one structured chat
	 * message (visible answer summary + hidden QUIZSUBMIT marker). The server
	 * grades the whole set and Ezer replies with coherent feedback.
	 */
	async function handleQuizSubmit(payload: { reference: string; answers: (string | null)[] }) {
		if (isLoading) return;
		panelFocusHint = {
			kind: 'quiz',
			id: payload.reference,
			title: `${payload.answers.filter((a) => a != null && a !== '').length}/${payload.answers.length} answered`
		};
		sidePanelOpen = false;
		clearGreetingFailureState();
		nearBottom = true;
		await sendGlobalChat(formatQuizSubmitMessage({ payload, language: sourceLanguage }));
	}

	async function streamScholarReply(opts: {
		action: Record<string, unknown>;
		userContent: string;
		actionChip?: boolean;
		context?: string;
	}): Promise<void> {
		const ref = $studySession.reference ?? undefined;
		messages = [
			...messages,
			{ role: 'user', content: opts.userContent, actionChip: opts.actionChip },
			{
				role: 'assistant',
				content: '',
				agent: 'scholar',
				reference: ref
			}
		];
		const assistantIdx = messages.length - 1;
		nearBottom = true;

		isLoading = true;
		statusLine = '';
		thinkingSteps = new Map();
		clearGreetingFailureState();

		const { signal, myGenId } = beginChatRequest();

		try {
			const res = await fetch(withBase('/api/agent'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					agent: 'scholar',
					action: opts.action,
					context: opts.context
				}),
				signal
			});

			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			let content = '';
			let citations: Message['citations'] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (myGenId !== generationId) break;
				buf += decoder.decode(value, { stream: true });
				const frames = buf.split('\n\n');
				buf = frames.pop() ?? '';
				for (const frame of frames) {
					if (!frame.trim()) continue;
					const lines = frame.split('\n');
					let ev = 'message';
					let data = '';
					for (const l of lines) {
						if (l.startsWith('event:')) ev = l.slice(6).trim();
						else if (l.startsWith('data:')) data = l.slice(5).trim();
					}
					if (!data) continue;
					try {
						const parsed = JSON.parse(data) as Record<string, unknown>;
						if (ev === 'status') {
							statusLine = String(parsed.text ?? '');
						} else if (ev === 'ui') {
							const component = parsed as UIComponentData;
							if (component.type) {
								const existing = messages[assistantIdx].uiComponents ?? [];
								messages[assistantIdx] = {
									...messages[assistantIdx],
									uiComponents: [...existing, component]
								};
								messages = messages;
							}
						} else if (ev === 'token') {
							content += String(parsed.delta ?? '');
							messages[assistantIdx] = { ...messages[assistantIdx], content };
							messages = messages;
						} else if (ev === 'done') {
							if (Array.isArray(parsed.citations)) {
								citations = parsed.citations as Message['citations'];
							}
						} else if (ev === 'error') {
							content = `Sorry: ${String(parsed.message ?? 'error')}`;
							messages[assistantIdx] = { ...messages[assistantIdx], content };
							messages = messages;
						}
					} catch {
						/* ignore */
					}
				}
			}

			messages[assistantIdx] = {
				...messages[assistantIdx],
				content: content || 'No response.',
				citations
			};
			messages = messages;
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				error = e instanceof Error ? e.message : String(e);
				messages[assistantIdx] = {
					...messages[assistantIdx],
					content: `Sorry, something went wrong: ${error}`
				};
				messages = messages;
			}
		} finally {
			isLoading = false;
			statusLine = '';
		}
	}

	async function sendResourceChat(text: string) {
		if (scope.kind !== 'resource') return;
		const resource = scope.resource;
		const scripture = scriptureContextFromPanel();

		// Thread history for this resource: prior scholar turns about it (from main feed)
		const thread = messages
			.filter((m) => m.role === 'user' || m.agent === 'scholar')
			.slice(-10)
			.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

		const globalCtx = [studyContextWithChecklist(), compactGlobalHistory()]
			.filter(Boolean)
			.join('\n\n');

		await streamScholarReply({
			userContent: text,
			context: globalCtx,
			action: {
				type: 'resource_chat',
				resource,
				question: text,
				thread,
				language: sourceLanguage,
				scripture
			}
		});
	}

	async function explainResource(payload: ResourcePayload) {
		if (isLoading) return;
		selectResource(payload);
		if (payload.kind === 'note' && payload.note?.id) {
			panelFocusHint = {
				kind: 'note',
				id: payload.note.id,
				title: payload.note.quote
			};
		} else if (payload.kind === 'word' && payload.word) {
			panelFocusHint = {
				kind: 'tw',
				id: payload.word.path || payload.word.term,
				title: payload.word.term
			};
		} else if (payload.kind === 'article' && payload.article?.path) {
			panelFocusHint = {
				kind: 'article',
				id: payload.article.path,
				title: payload.article.title
			};
		} else if (payload.kind === 'question' && payload.question?.id) {
			panelFocusHint = {
				kind: 'tq',
				id: payload.question.id,
				title: payload.question.question?.slice(0, 60)
			};
		}
		sidePanelOpen = false;
		error = '';

		const scripture = scriptureContextFromPanel();
		await streamScholarReply({
			userContent: actionChipText(payload),
			actionChip: true,
			action: {
				type: 'explain_resource',
				resource: payload,
				language: sourceLanguage,
				scripture
			}
		});
	}

	async function sendGlobalChat(text: string) {
		clearGreetingFailureState();
		messages = [...messages, { role: 'user', content: text }];

		isLoading = true;
		statusLine = '';
		thinkingSteps = new Map();

		const { signal, myGenId } = beginChatRequest();

		const assistantIdx = messages.length;
		messages = [
			...messages,
			{
				role: 'assistant',
				content: '',
				citations: [],
				mode: undefined,
				latencyMs: undefined,
				model,
				traceEvents: xrayEnabled ? [] : undefined
			}
		];

		const start = Date.now();

		try {
			const res = await fetch(withBase('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: messages
						.slice(0, assistantIdx)
						.slice(-HISTORY_PAYLOAD_LIMIT)
						.map((m) => {
							// Privacy: recall cards render the saved draft locally; never
							// replay the draft body to the server in later history payloads.
							const content = redactDraftRecallForOutbound(m);
							return {
								role: m.role,
								content:
									m.role === 'assistant' &&
									m.reference &&
									m.intent !== DRAFT_RECALL_INTENT &&
									!content.includes('<!-- REF:') &&
									!content.includes(`<!-- CHALLENGES:`)
										? `${content}\n<!-- REF:${m.reference} -->`
										: content
							};
						}),
					language: targetLanguage,
					sourceLanguage,
					targetLanguage,
					model,
					profile: {
						...profile,
						language: targetLanguage,
						sourceLanguage,
						targetLanguage,
						workflowMode
					},
					workflowMode,
					workflowModeExplicit,
					debug: xrayEnabled,
					context: studyContextWithChecklist(),
					panelState: currentPanelState()
				}),
				signal
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (!res.body) throw new Error('No response body');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let sseBuffer = '';
			const t0 = Date.now();

			function appendTrace(ev: AnyEvent) {
				if (!xrayEnabled) return;
				if (myGenId !== generationId) return;
				const te: TimedEvent = { t: Date.now() - t0, ev };
				const existing = messages[assistantIdx]?.traceEvents ?? [];
				messages[assistantIdx] = {
					...messages[assistantIdx],
					traceEvents: [...existing, te]
				};
				messages = messages;
			}

			const processFrame = (frame: string) => {
				if (myGenId !== generationId) return;

				const lines = frame.split('\n');
				let event = 'message';
				let data = '';
				for (const line of lines) {
					if (line.startsWith('event:')) event = line.slice(6).trim();
					else if (line.startsWith('data:')) data = line.slice(5).trim();
				}
				if (!data) return;

				try {
					const parsed = JSON.parse(data) as Record<string, unknown>;

					if (event === 'trace') {
						appendTrace({ kind: 'trace', ev: parsed as TraceEvent });
					} else if (event === 'status') {
						statusLine = String(parsed.text ?? '');
						appendTrace({ kind: 'status', text: statusLine });
					} else if (event === 'thinking') {
						const label = String(parsed.label ?? '');
						const state = String(parsed.state ?? 'working') as 'working' | 'done';
						if (label) thinkingSteps = new Map(thinkingSteps).set(label, state);
						appendTrace({ kind: 'thinking', label, state });
					} else if (event === 'ui') {
						const component = parsed as UIComponentData;
						if (component.type) {
							if (!messages[assistantIdx]) return;
							const existing = messages[assistantIdx].uiComponents ?? [];
							messages[assistantIdx] = {
								...messages[assistantIdx],
								uiComponents: [...existing, component],
								...(typeof component === 'object' &&
								'reference' in component &&
								typeof component.reference === 'string' &&
								component.reference &&
								!messages[assistantIdx].reference
									? { reference: component.reference }
									: {})
							};
							messages = messages;
							onPanelUiComponent(component);
						}
						appendTrace({ kind: 'ui', data: parsed });
					} else if (event === 'panel_action') {
						const action = parsePanelAction(parsed);
						if (action) applyPanelAction(action);
						appendTrace({ kind: 'meta', data: { panel_action: parsed } });
					} else if (event === 'token') {
						if (!messages[assistantIdx]) return;
						const delta = String(parsed.delta ?? '');
						messages[assistantIdx] = {
							...messages[assistantIdx],
							content: (messages[assistantIdx].content ?? '') + delta
						};
						messages = messages;
					} else if (event === 'meta') {
						if (parsed.setLanguage && typeof parsed.setLanguage === 'string') {
							language = parsed.setLanguage;
							profile = {
								...profile,
								language: parsed.setLanguage,
								targetLanguage: parsed.setLanguage
							};
							setLanguagePair({
								sourceLanguage,
								targetLanguage: parsed.setLanguage
							});
							saveProfile();
						}
						if (parsed.setSourceLanguage && typeof parsed.setSourceLanguage === 'string') {
							sourceLanguage = parsed.setSourceLanguage;
							profile = { ...profile, sourceLanguage: parsed.setSourceLanguage };
							setLanguagePair({
								sourceLanguage: parsed.setSourceLanguage,
								targetLanguage
							});
							saveProfile();
						}
						if (parsed.setName && typeof parsed.setName === 'string') {
							profile = { ...profile, name: parsed.setName };
							saveProfile();
						}
						if (
							parsed.setWorkflowMode === 'study' ||
							parsed.setWorkflowMode === 'translate' ||
							parsed.setWorkflowMode === 'check'
						) {
							applyWorkflowMode(parsed.setWorkflowMode);
						}
						appendTrace({ kind: 'meta', data: parsed });
					} else if (event === 'done') {
						statusLine = '';
						error = '';
						thinkingSteps = new Map();
						const doneResponse = typeof parsed.response === 'string' ? parsed.response : undefined;
						// Prefer the server's final response (may include normalized
						// [Step N/M] footers / hidden markers after streaming).
						if (doneResponse) {
							messages[assistantIdx] = {
								...messages[assistantIdx],
								content: doneResponse
							};
						}
						{
							const content = doneResponse ?? messages[assistantIdx]?.content ?? '';
							const ref =
								(typeof parsed.reference === 'string' && parsed.reference) ||
								messages[assistantIdx]?.reference ||
								$studySession.reference ||
								'';
							if (ref && content) applyMarkersFromText(ref, content);
						}
						{
							const doneIntent =
								typeof parsed.intent === 'string' ? parsed.intent : messages[assistantIdx].intent;
							messages[assistantIdx] = {
								...messages[assistantIdx],
								agent:
									doneIntent === 'checking' ? 'checker' : (messages[assistantIdx].agent ?? 'guide'),
								intent: doneIntent
							};
							if (doneIntent === 'checking') {
								applyWorkflowMode('check');
							}
						}
						messages[assistantIdx] = {
							...messages[assistantIdx],
							citations:
								(parsed.citations as { path: string; title?: string }[] | undefined) ??
								messages[assistantIdx].citations ??
								[],
							reference:
								typeof parsed.reference === 'string'
									? parsed.reference
									: messages[assistantIdx].reference,
							mode: (parsed.mode as Message['mode']) ?? messages[assistantIdx].mode,
							dataWarning:
								typeof parsed.dataWarning === 'string'
									? parsed.dataWarning
									: messages[assistantIdx].dataWarning,
							latencyMs: Date.now() - start,
							model: typeof parsed.model === 'string' ? parsed.model : model,
							nextBatch:
								typeof parsed.nextBatch === 'string'
									? parsed.nextBatch
									: messages[assistantIdx].nextBatch,
							challenges:
								(parsed.challenges as ChallengeItem[] | undefined) ??
								messages[assistantIdx].challenges,
							drillIndex:
								typeof parsed.drillIndex === 'number'
									? parsed.drillIndex
									: messages[assistantIdx].drillIndex,
							totalChallenges:
								typeof parsed.totalChallenges === 'number'
									? parsed.totalChallenges
									: messages[assistantIdx].totalChallenges,
							toolCalls:
								(parsed.toolCalls as ToolCallTrace[] | undefined) ??
								messages[assistantIdx].toolCalls
						};
						messages = messages;

						{
							const doneRef = typeof parsed.reference === 'string' ? parsed.reference : undefined;
							if (doneRef) {
								setPassage(doneRef, language);
								profile = { ...profile, lastReference: doneRef };
								saveProfile();
							}
						}

						{
							const pendingChallenges = messages[assistantIdx].challenges;
							const pendingUiComponents = messages[assistantIdx].uiComponents ?? [];
							const doneUi = Array.isArray(parsed.uiComponents)
								? (parsed.uiComponents as UIComponentData[])
								: [];
							let nextUi = mergeUiComponents(pendingUiComponents, doneUi);
							if (
								pendingChallenges &&
								pendingChallenges.length > 0 &&
								!nextUi.some((c) => c.type === 'challenge_cards')
							) {
								nextUi = [
									...nextUi,
									{
										type: 'challenge_cards',
										challenges:
											pendingChallenges as import('$core/harness/PassageAnnotator.js').Challenge[]
									}
								];
							}
							if (nextUi.length !== pendingUiComponents.length || doneUi.length > 0) {
								messages[assistantIdx] = {
									...messages[assistantIdx],
									uiComponents: nextUi
								};
								messages = messages;
							}
						}

						appendTrace({ kind: 'done', data: parsed });
						// Explicit persist as soon as the turn is complete.
						persistChatSession();
					} else if (event === 'error') {
						statusLine = '';
						thinkingSteps = new Map();
						const errMsg = String(parsed.message ?? 'Unknown error');
						messages[assistantIdx] = {
							...messages[assistantIdx],
							content: `Sorry, something went wrong: ${errMsg}`,
							mode: 'error',
							latencyMs: Date.now() - start
						};
						messages = messages;
						appendTrace({ kind: 'error', data: parsed });
					}
				} catch (err) {
					console.warn('[SSE] Failed to parse frame', { event, data: data.slice(0, 200), err });
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				sseBuffer += decoder.decode(value, { stream: true });
				const frames = sseBuffer.split('\n\n');
				sseBuffer = frames.pop() ?? '';
				for (const frame of frames) {
					if (frame.trim()) processFrame(frame);
				}
			}
		} catch (e) {
			statusLine = '';
			error = e instanceof Error ? e.message : String(e);
			if (!messages[assistantIdx]?.content) {
				messages = messages.filter((_, i) => i !== assistantIdx);
			}
		} finally {
			isLoading = false;
			await tick();
			persistChatSession();
		}
	}

	function handleTargetLanguageChange(e: CustomEvent<string>) {
		const code = e.detail?.trim();
		if (!code || !isKnownLanguage(code)) return;
		applyLanguagePair(
			resolveLanguagePair({
				sourceLanguage,
				targetLanguage: code
			})
		);
		saveProfile();
	}

	function handleSourceLanguageChange(e: CustomEvent<string>) {
		const code = e.detail?.trim();
		if (!code || !isKnownLanguage(code)) return;
		applyLanguagePair({ sourceLanguage: code, targetLanguage });
		saveProfile();
	}

	function handleQuickAction(e: CustomEvent<string>) {
		const prompt = e.detail?.trim();
		if (!prompt || isLoading) return;
		input = prompt;
		send();
	}

	function clearChat() {
		generationId++;
		currentAbortController?.abort();
		currentAbortController = null;
		skipNextSessionSave = true;
		clearSession();
		messages = [];
		error = '';
		isLoading = false;
		statusLine = '';
		input = '';
		resetSession();
		// Keep language preference; re-generate Ezer's greeting in source language.
		if (languageChosen && language) {
			setLanguagePair({ sourceLanguage, targetLanguage });
			void requestIntroGreeting(profile.name);
		}
	}

	/** Wipe profile + study state and return to the language picker. */
	function resetSessionFromScratch() {
		generationId++;
		currentAbortController?.abort();
		currentAbortController = null;
		skipNextSessionSave = true;
		clearSession();
		messages = [];
		error = '';
		isLoading = false;
		statusLine = '';
		input = '';
		languageChosen = false;
		language = 'en';
		sourceLanguage = 'en';
		languageFilter = '';
		workflowModeExplicit = false;
		profile = {};
		try {
			localStorage.removeItem(PROFILE_KEY);
		} catch {
			/* ignore */
		}
		resetSession();
	}

	function toggleXray() {
		if (xrayOpen) {
			xrayOpen = false;
		} else {
			xrayEnabled = true;
			saveXray();
			xrayOpen = true;
		}
	}

	function handleClearScope() {
		clearScope();
	}
</script>

<svelte:head>
	<title>Workbench · Translation Helps MCP</title>
</svelte:head>

<div class="relative flex h-full min-h-0 overflow-hidden bg-slate-950">
	<!-- Left: chat column -->
	<div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
		<div
			bind:this={feedEl}
			on:scroll={onFeedScroll}
			class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2.5 py-2.5 sm:space-y-5 sm:px-3 sm:py-3 md:px-4"
		>
			{#if messages.length === 0 && !isLoading}
				<div class="flex h-full flex-col items-center justify-center px-4 py-10">
					<div class="w-full max-w-lg space-y-5 text-center">
						<div>
							<p
								class="text-3xl tracking-tight text-slate-100"
								style="font-family: var(--font-heading); font-weight: 500;"
							>
								Ezer
							</p>
							<p class="mt-2 text-sm text-slate-400">
								Which language will you be translating from? This is the language of your source
								Bible and resources — Ezer will speak with you in it.
							</p>
						</div>

						{#if languagesLoading}
							<p class="text-sm text-slate-500">Loading languages from Door43…</p>
						{:else if languagesError}
							<div class="space-y-3">
								<p class="text-sm text-red-400">{languagesError}</p>
								<button
									type="button"
									on:click={() => loadCatalogLanguages()}
									class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-sky-500"
								>
									Retry
								</button>
							</div>
						{:else}
							<label class="block text-left">
								<span class="sr-only">Filter languages</span>
								<input
									type="search"
									bind:value={languageFilter}
									placeholder="Search languages…"
									class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
								/>
							</label>

							<div
								class="max-h-[min(50vh,28rem)] space-y-2 overflow-y-auto overscroll-contain pr-0.5"
								role="listbox"
								aria-label="Source language (translating from)"
							>
								<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
									{#each filteredLanguages as opt (opt.code)}
										<button
											type="button"
											role="option"
											aria-selected={false}
											on:click={() => chooseLanguage(opt.code)}
											class="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-left transition
												hover:border-sky-500/50 hover:bg-white hover:shadow-md"
										>
											<span class="block text-sm font-semibold text-slate-100"
												>{opt.name || opt.code}</span
											>
											<span
												class="mt-0.5 block font-mono text-[11px] tracking-wide text-slate-500 uppercase"
												>{opt.code}</span
											>
										</button>
									{/each}
								</div>
								{#if filteredLanguages.length === 0}
									<p class="py-4 text-sm text-slate-500">No languages match.</p>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{:else}
				{#each passageBlocks as block (block.id)}
					<section class="space-y-3">
						{#if block.reference}
							<!-- Passage grouping chip — counts live in the resources panel only. -->
							<div class="flex flex-wrap items-center gap-1.5 px-0.5">
								<span
									class="inline-flex items-center gap-1 rounded-md bg-sky-950 px-2 py-0.5 font-mono text-xs text-sky-300"
								>
									<BookOpen size={12} strokeWidth={2} />
									{block.reference}
								</span>
							</div>
						{/if}

						{#each block.exchanges as exchange}
							{#if exchange.user}
								<div class="flex justify-end">
									{#if exchange.user.actionChip}
										<div
											class="max-w-[85%] rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs text-sky-900"
										>
											{stripHiddenMarkers(exchange.user.content)}
										</div>
									{:else}
										<div
											class="max-w-[85%] rounded-2xl rounded-tr-sm bg-sky-600 px-3 py-2 text-sm text-white"
										>
											{stripHiddenMarkers(exchange.user.content)}
										</div>
									{/if}
								</div>
							{/if}

							{#if exchange.assistant}
								{@const msg = exchange.assistant}
								{@const i = exchange.assistantIdx ?? -1}
								{@const agent = msg.agent ?? 'guide'}
								<div class="flex justify-start">
									<div class="w-full max-w-full space-y-1.5 sm:max-w-[95%]">
										<AgentBadge {agent} size="sm" />

										{#if msg.content}
											<div
												class="prose prose-sm max-w-none rounded-2xl rounded-tl-sm px-3 py-2.5 text-[15px] leading-relaxed break-words text-slate-100 sm:text-sm
													{agent === 'scholar' ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-slate-800'}"
											>
												{@html renderMarkdownLocal(msg.content)}
											</div>
										{:else if isLoading && i === messages.length - 1}
											<div
												class="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2.5"
											>
												<span
													class="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.3s]"
												></span>
												<span
													class="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.15s]"
												></span>
												<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400"></span>
											</div>
										{/if}

										{#if msg.dataWarning}
											<div
												class="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900"
											>
												<AlertTriangle size={14} strokeWidth={2} class="mt-0.5 shrink-0" />
												<span>{msg.dataWarning}</span>
											</div>
										{/if}

										{#if (msg.mode && msg.mode !== 'compose') || (xrayEnabled && msg.latencyMs) || (msg.traceEvents && msg.traceEvents.length > 0)}
											<!-- Reference lives in the block header; latency is X-ray-only. -->
											<div class="flex flex-wrap items-center gap-2 px-0.5">
												{#if msg.mode && msg.mode !== 'compose'}
													<span
														class="text-xs {msg.mode === 'training-only'
															? 'text-amber-600'
															: 'text-slate-600'}"
													>
														{modeLabel(msg.mode)}
													</span>
												{/if}
												{#if xrayEnabled && msg.latencyMs}
													<span class="text-xs text-slate-700">{msg.latencyMs}ms</span>
												{/if}
												{#if msg.traceEvents && msg.traceEvents.length > 0}
													<button
														type="button"
														on:click={() => (xrayOpen = true)}
														class="inline-flex items-center gap-0.5 text-xs text-sky-500 hover:text-sky-400"
														title="View X-ray trace"
													>
														<Zap size={12} strokeWidth={2} />
														{msg.traceEvents.length}
													</button>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{/if}
						{/each}
					</section>
				{/each}

				{#if isLoading && thinkingSteps.size > 0}
					<div class="flex justify-start">
						<div
							class="w-56 space-y-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs"
						>
							<p class="mb-1 font-semibold tracking-wider text-slate-500 uppercase">Analyzing</p>
							{#each [...thinkingSteps.entries()] as [label, state]}
								<div class="flex items-center gap-1.5">
									{#if state === 'done'}
										<Check size={12} strokeWidth={2.5} class="shrink-0 text-emerald-400" />
									{:else}
										<span
											class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400"
										></span>
									{/if}
									<span class={state === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}
										>{label}</span
									>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if isLoading && statusLine}
					<div class="animate-pulse px-1 py-0.5 text-xs text-sky-400 italic">{statusLine}</div>
				{/if}
			{/if}
			<div bind:this={feedEnd}></div>
		</div>

		<!-- X-ray overlay -->
		{#if xrayOpen}
			<button
				type="button"
				class="absolute inset-0 z-40 bg-black/50"
				aria-label="Close X-ray"
				on:click={() => (xrayOpen = false)}
			></button>
			<div
				class="absolute inset-2 z-50 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl md:inset-3"
			>
				<XrayPanel
					turns={xrayTurns}
					onClose={() => (xrayOpen = false)}
					hasResources={hasAnyResources}
				/>
			</div>
		{/if}

		<!-- Error banner -->
		{#if error}
			<div
				class="mx-3 mb-1 rounded-lg border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800"
			>
				{error}
			</div>
		{/if}

		<!-- Mi traducción — docked draft workspace (local th_drafts) -->
		{#if languageChosen && (messages.length > 0 || $studySession.reference)}
			<DraftWorkspace
				{language}
				{sourceLanguage}
				{workflowMode}
				studyReference={$studySession.reference}
				reviewDisabled={isLoading}
			/>
		{/if}

		<!-- Chat dock -->
		{#if messages.length > 0 || isLoading}
			<ChatDock
				bind:input
				bind:model
				bind:language
				bind:sourceLanguage
				languages={catalogLanguages}
				{isLoading}
				hasMessages={messages.length > 0}
				xrayActive={xrayOpen}
				{xrayEnabled}
				{xrayEventCount}
				resourceCount={panelResourceCount}
				resourcesOpen={sidePanelOpen}
				{workflowMode}
				on:send={send}
				on:clearScope={handleClearScope}
				on:toggleXray={toggleXray}
				on:clearChat={clearChat}
				on:resetSession={resetSessionFromScratch}
				on:quickAction={handleQuickAction}
				on:languageChange={handleTargetLanguageChange}
				on:sourceLanguageChange={handleSourceLanguageChange}
				on:workflowModeChange={handleWorkflowModeChange}
				on:openResources={() => (sidePanelOpen = !sidePanelOpen)}
				on:inputFocus={handleInputFocus}
				on:inputBlur={handleInputBlur}
			/>
		{/if}
	</div>

	<!-- Right: resource side panel (desktop) -->
	<aside class="hidden w-[min(42%,28rem)] shrink-0 lg:flex lg:flex-col">
		<ResourceSidePanel
			components={panelComponents}
			{isLoading}
			{language}
			{checklistFocusToken}
			{panelFocusTab}
			{panelFocusToken}
			{panelHighlight}
			{panelHighlightToken}
			{workflowMode}
			onTabChange={(tab) => (panelActiveTab = tab)}
			onExplain={explainResource}
			onExplored={() => {}}
			onCheckItem={handleChecklistItemCheck}
			onQuizSubmit={handleQuizSubmit}
		/>
	</aside>

	<!-- Mobile: bottom sheet for resources -->
	{#if sidePanelOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/55 lg:hidden"
			aria-label="Close resources"
			on:click={() => (sidePanelOpen = false)}
		></button>
		<div
			class="fixed inset-x-0 bottom-0 z-50 flex h-[min(88dvh,40rem)] flex-col shadow-2xl lg:hidden"
			style="padding-bottom: env(safe-area-inset-bottom, 0px)"
			role="dialog"
			aria-modal="true"
			aria-label="Passage helps"
		>
			<ResourceSidePanel
				components={panelComponents}
				{isLoading}
				{language}
				{checklistFocusToken}
				{panelFocusTab}
				{panelFocusToken}
				{panelHighlight}
				{panelHighlightToken}
				{workflowMode}
				sheet
				onTabChange={(tab) => (panelActiveTab = tab)}
				onExplain={explainResource}
				onExplored={() => {}}
				onCheckItem={handleChecklistItemCheck}
				onQuizSubmit={handleQuizSubmit}
				onClose={() => (sidePanelOpen = false)}
			/>
		</div>
	{/if}
</div>
