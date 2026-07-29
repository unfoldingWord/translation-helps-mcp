/**
 * skillChat.ts — server-side helper that wires ContextHarness to the MCP server.
 *
 * Usage in +server.ts endpoints:
 *   const { callTool, llm } = createSkill(platform, url.origin);
 *   const result = await answer({ callTool, llm }, userMessage, language);
 */

import { OpenAILLMProvider } from '$core/rag/providers/OpenAILLMProvider.js';
import { TracingLLMProvider } from '$core/rag/providers/TracingLLMProvider.js';
import { getStatusText } from './i18n.js';
import { ContextHarness } from '$core/harness/ContextHarness.js';
import type { TraceEvent } from '$core/harness/traceEvents.js';
import type { Challenge } from '$core/harness/PassageAnnotator.js';
import type { ToolCallTrace } from '$core/harness/ContextHarness.js';
import {
	buildLangMarker,
	buildPendingMarkers,
	buildNameInvitedMarker,
	hasNameInvited,
	extractLang,
	isAffirmative as isAffirmativeMessage,
	resolveLanguage,
	type LanguageOption
} from '$core/harness/warmup.js';
import {
	classifyIntent,
	ensureCheckingSessionFooter,
	extractCheckingFromHistory,
	extractQuizFromHistory,
	extractReferenceInfo,
	extractSessionContext,
	hasQuizFollowOnRequest,
	isCheckingRoutingIntent,
	isContinuationMessage,
	isQuizRoutingIntent,
	reinforceCheckingSession,
	reinforceQuizSession,
	stripQuizOptOutPhrases,
	VALID_USFM_BOOKS,
	type IntentResult,
	type IntentType
} from '$core/harness/intent.js';
import {
	appendCheckMarkersToResponse,
	extractChecklistReference,
	findFocusedCheckItem,
	parseCheckItemFromMessage,
	parseUncheckedFromStudyContext,
	resolveValidatedCheckMarkers
} from '$core/checklist/checkingChecklist.js';
import { endsWithQuestion, truncateAtFirstQuestion } from '$core/harness/chatPacing.js';
import { detectDraftSubmitIntent } from '$core/harness/coachPedagogy.js';
import {
	buildQuizClearedMarker,
	buildQuizMarker,
	buildQuizPanelMarker,
	fallbackQuizCompleteMessage,
	generateQuiz,
	generateQuizResultFeedback,
	gradeAnswer
} from '$core/harness/QuizAgents.js';
import {
	buildQuizPanelComponent,
	buildQuizResultComponent,
	fallbackQuizResultFeedback,
	gradeQuizSubmission,
	parseQuizSubmitFromMessage
} from '$core/harness/quizPanel.js';
import {
	formulateChapterOrientationReply,
	formulateQuizPanelReferral,
	formulateQuizProgressFooter,
	formulateQuizSkippedMessage,
	formulateReadinessGateQuestion,
	formulateStaleQuizNotice
} from '$core/harness/coachReplyFormulator.js';
import {
	buildQuizRetryMarker,
	buildQuizScopeMarker,
	buildQuizScoreMarker,
	buildReadinessGateMarker,
	buildReadinessOptOutMarker,
	buildReadyMarker,
	deriveReadiness,
	detectReadinessGate,
	extractPendingQuizRetry,
	extractPendingReadinessGate,
	extractQuizScopeFromHistory,
	extractQuizScoreFromHistory,
	interpretQuizRetryReply,
	interpretReadinessGateReply,
	isBookSettled,
	isChapterSettled,
	isQuizPass,
	parseRefParts,
	quizScopeForReference,
	type ReadinessScope
} from '$core/harness/contextReadiness.js';
import {
	detectOnDemandQuizIntent,
	quizKindMarksReadiness,
	readinessScopeForQuizKind,
	type QuizKind
} from '$core/harness/onDemandQuiz.js';
import type { EnrichedBundle } from '$core/harness/budgeter.js';
import {
	isNeutralTarget,
	languagePairPromptGuidance,
	resolveLanguagePair,
	type LanguagePair
} from '$core/harness/languagePair.js';
import {
	DEFAULT_WORKFLOW_MODE,
	WORKFLOW_CLARIFY_MARKER,
	buildWorkflowClarifyQuestion,
	detectWorkflowModeIntent,
	hasPendingWorkflowClarify,
	inferWorkflowMode,
	parseWorkflowClarifyAnswer,
	parseWorkflowMode,
	shouldAskWorkflowClarify,
	workflowClarifyPromptInstruction,
	workflowModePromptBias,
	type WorkflowMode
} from '$core/harness/workflowMode.js';
import {
	composeRelativeReference,
	extractChapterOfferFromAssistant,
	extractRelativeRefFallback,
	mentionsRelativeRef,
	mentionsSectionSelection,
	parsePositiveInt,
	parseStudyRefParts,
	resolveSectionSelection,
	type RelativeRefSignals
} from '$core/harness/relativeRef.js';
import type { UIComponent } from '$core/harness/uiComponents.js';
import { coalescePanelActions, extractPanelActionsFromText } from '$core/harness/panelActions.js';
import {
	formatPanelStateForPrompt,
	mergePanelStateIntoStudyContext,
	parsePanelState,
	PANEL_STATE_PROMPT_GUIDANCE,
	type PanelState
} from '$core/harness/panelState.js';
import {
	bookOrientationCoachGuidance,
	buildBookContextPanelComponent,
	extractContextNoteText,
	isWholeChapterReference,
	panelFocusActionsForContext,
	preferredContextNoteId
} from '$core/harness/bookContextPanel.js';
import { bookNameToUsfm } from '@translation-helps/door43';
import { withBase } from '$lib/paths.js';
import { canRunToolsInProcess, runToolInProcess } from '$lib/server/runTool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * LLM-based contextual classifier for short conversational messages.
 *
 * Replaces all brittle multilingual regex patterns (AFFIRMATIVE_RE, CONTINUATION_PATTERN,
 * NAME_RE) with a single small structured LLM call. Only fires when the message has no
 * Bible reference and is short enough to be conversational (≤ 120 chars).
 *
 * Returns flags the caller can use to override/enrich the rule-based intentResult.
 */
type ContextualFlags = RelativeRefSignals & {
	isAffirmative: boolean;
	isNegative: boolean;
	isContinuation: boolean;
	extractedName: string | null;
	/** Raw language name/code if the user expressed a translation language preference, e.g. "Spanish". */
	extractedLanguage: string | null;
	/** True when the user asks to show/load the current passage text or its study resources. */
	wantsPassageResources: boolean;
};

async function resolveContextual(
	llm: OpenAILLMProvider,
	message: string,
	history: ConversationTurn[]
): Promise<ContextualFlags> {
	const empty: ContextualFlags = {
		isAffirmative: false,
		isNegative: false,
		isContinuation: false,
		extractedName: null,
		extractedLanguage: null,
		wantsPassageResources: false,
		extractedBook: null,
		extractedChapter: null,
		extractedVerse: null,
		extractedVerseEnd: null
	};

	// Only worth calling for short, reference-free messages
	if (message.trim().length > 120 || extractReferenceInfo(message)) return empty;

	// Give the LLM the last assistant turn for context (strip hidden markers).
	// Keep enough of the overview so numbered section lists (verse ranges) are visible.
	const lastAssistant =
		[...history]
			.reverse()
			.find((m) => m.role === 'assistant')
			?.content?.replace(/<!--[\s\S]*?-->/g, '')
			.trim()
			.slice(0, 2000) ?? '';

	const system = `You are a conversation classifier for a Bible translation assistant.

The assistant's last message was:
"${lastAssistant || '(conversation start)'}"

For the user's reply classify:
- "isAffirmative": true if the user is saying yes / confirming / agreeing to what the assistant just asked or offered
- "isNegative": true if the user is declining / saying no / rejecting what the assistant just asked or offered
- "isContinuation": true if the user is saying next / continue / proceed to advance through a sequence WITHOUT naming a specific chapter, verse, or section (e.g. "next", "continue", "siguiente"). False when they name a chapter/verse/section — including "continue to chapter 1", "continuemos con el capítulo 1", "quiero traducir la sección 1", "traduzcamos 1:1-4".
- "extractedName": the user's preferred name or alias if they introduced themselves in this message, otherwise null
- "extractedLanguage": if the user mentions a specific natural language they want to use for translation (e.g. "I want to translate in Spanish", "working in French", "translate to English from Portuguese"), output that language name as a short string like "Spanish", "French", "English", "Portuguese", etc. Output null if no translation language is mentioned.
- "wantsPassageResources": true if the user is asking to show, display, open, load, or bring up the scripture text and/or translation helps for the passage already under discussion (e.g. "show me the text", "muéstrame el texto", "load the notes", "open Titus again"). False for greetings, yes/no answers, or unrelated questions.
- "extractedBook": if the user names a whole Bible book they want to work on / translate / study, WITHOUT a chapter or verse (e.g. "Titus", "Tito", "Juan", "the book of Romans", "quiero traducir Tito"), output the English canonical book name (e.g. "Titus", "John", "Romans", "1 Corinthians"). Output null if they give a chapter/verse, or if no book is named.
- "extractedChapter": if the user asks to start / work on / translate / continue to a specific CHAPTER without naming the book (e.g. "chapter 1", "continue to chapter 1", "continuemos con el capítulo 1", "empecemos por el primer capítulo", "vamos al capítulo 2", "start with the first chapter"), output the chapter number as an integer. Ordinals count ("primer"/"first" → 1, "segundo"/"second" → 2). Set extractedChapter (not only isContinuation) whenever a chapter number/ordinal is named. Also set when the user gives a bare C:V reference like "1:1-4" (chapter=1). Output null if they name a book, only a verse without chapter, or no chapter.
- "extractedVerse": if the user asks to work on / translate a specific VERSE without naming the book (e.g. "let's translate verse 1", "el versículo 3", "traduzcamos el verso 1", "verse 1-5"), output the starting verse number as an integer. Ordinals count. Also set when the user picks a numbered SECTION / PART from the assistant's last message (e.g. "section 1", "la sección 2", "quiero traducir la primera sección", "parte 1") — look up that section's verse range in the assistant message (headings like "Versículos 1-4", "vv. 5-9") and output the START verse. Also set for bare C:V refs like "1:1-4" (verse=1). Output null if they only name a chapter, or no verse.
- "extractedVerseEnd": if the user gives a verse RANGE (e.g. "verses 1-5", "versículos 2 al 4", "1:1-4") OR picks a section whose heading has an end verse, output the end verse number; otherwise null.
- IMPORTANT: When the user selects a section/part by number or ordinal from the assistant's section list, set isContinuation=false and fill extractedVerse/extractedVerseEnd (and extractedChapter when the heading shows a chapter, otherwise leave chapter null so the study context supplies it).

Reply ONLY with valid JSON on one line, for example: {"isAffirmative":false,"isNegative":false,"isContinuation":false,"extractedName":null,"extractedLanguage":null,"wantsPassageResources":false,"extractedBook":null,"extractedChapter":null,"extractedVerse":null,"extractedVerseEnd":null}`;

	try {
		const raw = await llm.generate(
			[
				{ role: 'system', content: system },
				{ role: 'user', content: message }
			],
			{ maxTokens: 160 }
		);
		const match = raw.match(/\{[\s\S]*?\}/);
		if (!match) return empty;
		const parsed = JSON.parse(match[0]) as Record<string, unknown>;
		return {
			isAffirmative: Boolean(parsed.isAffirmative),
			isNegative: Boolean(parsed.isNegative),
			isContinuation: Boolean(parsed.isContinuation),
			extractedName:
				typeof parsed.extractedName === 'string' && parsed.extractedName !== 'null'
					? parsed.extractedName
					: null,
			extractedLanguage:
				typeof parsed.extractedLanguage === 'string' && parsed.extractedLanguage !== 'null'
					? parsed.extractedLanguage
					: null,
			wantsPassageResources: Boolean(parsed.wantsPassageResources),
			extractedBook:
				typeof parsed.extractedBook === 'string' && parsed.extractedBook !== 'null'
					? parsed.extractedBook
					: null,
			extractedChapter: parsePositiveInt(parsed.extractedChapter),
			extractedVerse: parsePositiveInt(parsed.extractedVerse),
			extractedVerseEnd: parsePositiveInt(parsed.extractedVerseEnd)
		};
	} catch {
		return empty;
	}
}

/** Map a free-text book name (or USFM code) to a validated USFM book code. */
function resolveBookToUsfm(bookName: string): string | null {
	const trimmed = bookName.trim();
	if (!trimmed) return null;

	const upper = trimmed.toUpperCase().replace(/\s+/g, '');
	if (VALID_USFM_BOOKS.has(upper)) return upper;

	const titleCase = trimmed
		.split(/\s+/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
	for (const candidate of [trimmed, titleCase]) {
		const code = bookNameToUsfm(candidate);
		if (VALID_USFM_BOOKS.has(code)) return code;
	}
	return null;
}

type ContextNote = {
	scope?: string;
	note?: string;
	noteText?: string;
	body?: string;
	text?: string;
	title?: string;
	chapter?: string;
	verse?: string;
	id?: string;
};

type PassageContextPayload = {
	notes: ContextNote[];
	notesError?: string;
	availabilityError?: string;
};

type BookContextResult = {
	notes: ContextNote[];
	sourceLanguage: string;
	notesError?: string;
	availabilityError?: string;
};

function unwrapPassageContextRaw(raw: unknown): Record<string, unknown> | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const nested = r.structuredContent;
	if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
	// MCP content[] wrapper (same shape ContextHarness.extractPayload handles)
	if (Array.isArray(r.content)) {
		const first = r.content[0] as Record<string, unknown> | undefined;
		if (first && typeof first.text === 'string') {
			try {
				return JSON.parse(first.text) as Record<string, unknown>;
			} catch {
				return null;
			}
		}
	}
	return r;
}

/** Pull book/chapter intro notes (+ error fields) from a get_passage_context tool result. */
function extractPassageContextPayload(raw: unknown): PassageContextPayload {
	const r = unwrapPassageContextRaw(raw);
	if (!r) return { notes: [] };
	const context = r.context as ContextNote[] | undefined;
	const notes = Array.isArray(context)
		? context.filter((n) => extractContextNoteText(n).length > 0)
		: [];
	const notesError =
		typeof r.notesError === 'string' && r.notesError.trim() ? r.notesError : undefined;
	const availabilityError =
		typeof r.availabilityError === 'string' && r.availabilityError.trim()
			? r.availabilityError
			: undefined;
	return { notes, notesError, availabilityError };
}

async function fetchPassageContextWithTimeout(
	callTool: CallTool,
	reference: string,
	language: string,
	timeoutMs = 8000
): Promise<unknown | null> {
	const promise = callTool('get_passage_context', { reference, language }).catch(() => null);
	const raced = await Promise.race([
		promise,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
	]);
	// Keep the fetch alive so a late result can still warm caches.
	void promise;
	return raced;
}

/**
 * Fetch book/chapter intro notes for Path B / intro resume.
 * Tries the study language first; if zero intro notes and no fetch error,
 * falls back once to English.
 */
async function fetchBookContext(
	callTool: CallTool,
	reference: string,
	language: string,
	timeoutMs = 10000
): Promise<BookContextResult> {
	const requested = language.trim() || 'en';
	const raw = await fetchPassageContextWithTimeout(callTool, reference, requested, timeoutMs);
	if (!raw) {
		return {
			notes: [],
			sourceLanguage: requested,
			notesError: 'Timed out or failed fetching passage context'
		};
	}

	const first = extractPassageContextPayload(raw);
	if (first.notes.length > 0 || first.notesError || primarySubtag(requested) === 'en') {
		return {
			notes: first.notes,
			sourceLanguage: requested,
			notesError: first.notesError,
			availabilityError: first.availabilityError
		};
	}

	// Genuine empty in study language → try English once.
	const enRaw = await fetchPassageContextWithTimeout(callTool, reference, 'en', timeoutMs);
	if (!enRaw) {
		return {
			notes: [],
			sourceLanguage: requested,
			notesError: 'Timed out or failed fetching English fallback passage context',
			availabilityError: first.availabilityError
		};
	}

	const en = extractPassageContextPayload(enRaw);
	if (en.notes.length > 0) {
		return {
			notes: en.notes,
			sourceLanguage: 'en',
			availabilityError: en.availabilityError ?? first.availabilityError
		};
	}

	return {
		notes: [],
		sourceLanguage: requested,
		notesError: en.notesError,
		availabilityError: en.availabilityError ?? first.availabilityError
	};
}

/**
 * Fetch verse-scoped translation notes for a passage quiz (get_note without id).
 * Returns notes shaped for generateQuiz's EnrichedBundle.
 */
async function fetchPassageNotesForQuiz(
	callTool: CallTool,
	reference: string,
	language: string
): Promise<Array<{ id: string; text: string; quote?: string; verse?: string }>> {
	try {
		const raw = await callTool('get_note', { reference, language });
		const r =
			raw && typeof raw === 'object'
				? (((raw as Record<string, unknown>).structuredContent as
						| Record<string, unknown>
						| undefined) ?? (raw as Record<string, unknown>))
				: null;
		const notes = (r?.notes as Array<Record<string, unknown>> | undefined) ?? [];
		return notes
			.map((n, i) => {
				const text = String(n.note ?? n.text ?? n.noteText ?? '').trim();
				if (!text) return null;
				return {
					id: String(n.id ?? `tn-${i}`),
					text,
					...(n.quote ? { quote: String(n.quote) } : {}),
					...(n.verse ? { verse: String(n.verse) } : {})
				};
			})
			.filter((n): n is NonNullable<typeof n> => n !== null);
	} catch {
		return [];
	}
}

/** Prompt guidance for book-context — panel-first; do not dump intro into chat. */
function bookContextPromptGuidance(
	result: BookContextResult,
	studyLanguage: string,
	_maxChars = 1800
): string {
	void _maxChars;
	return bookOrientationCoachGuidance({
		hasPanelNotes: result.notes.length > 0,
		notesError: result.notesError,
		sourceLanguage: result.sourceLanguage,
		studyLanguage
	});
}

/**
 * Push book/chapter intro notes into the passage resources panel as a
 * `passage_context` UI component (retained independently of verse-scoped TN).
 * Returns true when a component was emitted.
 */
function emitBookContextNotes(
	emit: { ui: (component: UIComponent) => void },
	reference: string,
	bookCtx: BookContextResult
): boolean {
	const component = buildBookContextPanelComponent(reference, bookCtx.notes);
	if (!component) return false;
	emit.ui(component);
	return true;
}

const ORIGINAL_SCRIPTURE_LABELS = new Set(['UGNT', 'UHB']);

function unwrapToolPayload(raw: unknown): Record<string, unknown> | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.structuredContent && typeof r.structuredContent === 'object') {
		return r.structuredContent as Record<string, unknown>;
	}
	if (Array.isArray(r.content)) {
		const first = r.content[0] as Record<string, unknown> | undefined;
		if (first && typeof first.text === 'string') {
			try {
				return JSON.parse(first.text) as Record<string, unknown>;
			} catch {
				return null;
			}
		}
	}
	return r;
}

/** Fetch scripture versions for a chapter/passage (get_passage). */
async function fetchPassageScripture(
	callTool: CallTool,
	reference: string,
	language: string,
	timeoutMs = 10000
): Promise<Extract<UIComponent, { type: 'scripture_text' }> | null> {
	const promise = callTool('get_passage', { reference, language }).catch(() => null);
	const raced = await Promise.race([
		promise,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
	]);
	void promise;
	const payload = unwrapToolPayload(raced);
	if (!payload) return null;
	const versions = payload.versions as
		| Array<{ label?: string; text?: string; resourceType?: string; role?: string }>
		| undefined;
	if (!Array.isArray(versions) || versions.length === 0) return null;
	const mapped = versions
		.map((v) => {
			const label = String(v.label ?? v.resourceType ?? '').trim();
			const text = String(v.text ?? '').trim();
			if (!label || !text) return null;
			return {
				label,
				text,
				direction: ORIGINAL_SCRIPTURE_LABELS.has(label) ? ('rtl' as const) : ('ltr' as const),
				...(v.resourceType ? { resourceType: String(v.resourceType) } : {})
			};
		})
		.filter((v): v is NonNullable<typeof v> => v !== null);
	if (mapped.length === 0) return null;
	return {
		type: 'scripture_text',
		reference: String(payload.reference ?? reference).trim() || reference,
		versions: mapped
	};
}

function sameChapterReference(a: string | null | undefined, b: string | null | undefined): boolean {
	const pa = parseStudyRefParts(a);
	const pb = parseStudyRefParts(b);
	return Boolean(
		pa.book && pb.book && pa.book === pb.book && pa.chapter != null && pa.chapter === pb.chapter
	);
}

function panelAlreadyHasChapterContext(
	panelState: PanelState | null | undefined,
	reference: string
): boolean {
	if (!panelState || (panelState.contextNotes?.count ?? 0) <= 0) return false;
	return sameChapterReference(panelState.reference, reference);
}

function panelAlreadyHasScripture(
	panelState: PanelState | null | undefined,
	reference: string
): boolean {
	if (!panelState?.scriptureLoaded) return false;
	return sameChapterReference(panelState.reference, reference);
}

function emitContextPanelFocus(
	emit: StreamEmit,
	notes: Array<{ id?: string; scope?: string }>
): void {
	const scrollToNoteId = preferredContextNoteId(notes);
	for (const action of panelFocusActionsForContext({ scrollToNoteId })) {
		emit.panelAction?.(action);
	}
}

/**
 * Whole-chapter panel-first orientation (Path B-ch): emit scripture + chapter
 * intro into the resources panel, focus Context tab, short coach reply — no
 * overview dump / paraphrase in chat.
 */
async function runChapterOrientation(opts: {
	callTool: CallTool;
	llm: OpenAILLMProvider;
	emit: StreamEmit;
	reference: string;
	language: string;
	panelState?: PanelState | null;
}): Promise<void> {
	const { callTool, llm, emit, reference, language, panelState } = opts;
	const orientRef = reference.trim();
	const alreadyHasContext = panelAlreadyHasChapterContext(panelState, orientRef);
	const alreadyHasScripture = panelAlreadyHasScripture(panelState, orientRef);

	emit.status(getStatusText(language, 'loading'));

	const emptyCtx: BookContextResult = {
		notes: [],
		sourceLanguage: language
	};
	const [bookCtx, scripture] = await Promise.all([
		alreadyHasContext
			? Promise.resolve(emptyCtx)
			: fetchBookContext(callTool, orientRef, language, 10000),
		alreadyHasScripture
			? Promise.resolve(null)
			: fetchPassageScripture(callTool, orientRef, language, 10000)
	]);

	// Scripture first (open only), then passage_context (focus Context wins).
	let hasScripture = alreadyHasScripture;
	if (scripture) {
		emit.ui(scripture);
		hasScripture = true;
	}

	let hasPanelNotes = alreadyHasContext;
	const focusNotes: Array<{ id?: string; scope?: string }> = [];
	if (!alreadyHasContext) {
		hasPanelNotes = emitBookContextNotes(emit, orientRef, bookCtx);
		for (const n of bookCtx.notes) {
			focusNotes.push({
				id: n.id,
				scope: n.scope === 'book' || String(n.chapter ?? '') === 'front' ? 'book' : 'chapter'
			});
		}
	} else {
		for (const it of panelState?.contextNotes?.items ?? []) {
			focusNotes.push({ id: it.id, scope: 'chapter' });
		}
	}

	// Explicit focus even when UI companions were coalesced elsewhere this turn.
	emitContextPanelFocus(emit, focusNotes);

	const visible = await formulateChapterOrientationReply(language, llm, {
		reference: orientRef,
		hasPanelNotes,
		hasScripture,
		notesError: alreadyHasContext ? undefined : bookCtx.notesError,
		sourceLanguage: bookCtx.sourceLanguage
	});

	for (const word of visible.split(/(\s+)/)) emit.token(word);

	emit.done({
		response: visible,
		citations: hasPanelNotes
			? [
					{
						path: `tn/${orientRef.replace(/\s+/g, '/')}/intro`,
						title: `${orientRef} chapter introduction`
					}
				]
			: [],
		reference: orientRef,
		mode: 'compose',
		intent: 'chapter_orientation',
		latencyMs: 0
	});
}

/** Parse client study-session snapshot for the loaded passage reference. */
function extractStudyReference(studyContext?: string): string | null {
	if (!studyContext?.trim()) return null;
	const match = /Loaded passage:\s*([^\n(]+)/i.exec(studyContext);
	const ref = match?.[1]?.trim();
	return ref || null;
}

/**
 * Recover a study book/chapter from recent history when the client snapshot
 * is missing (e.g. API probes, or Spanish overview text without a Loaded passage line).
 * Prefers book+chapter (e.g. "TIT 1") so section picks can compose verse ranges.
 */
function extractStudyRefFromHistory(
	history: Array<{ role: string; content: string }>
): string | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const content = (history[i].content ?? '').replace(/<!--[\s\S]*?-->/g, '');
		const refMark = history[i].content?.match(/<!-- REF:([^>\s]+) -->/);
		if (refMark?.[1]) {
			const parts = parseStudyRefParts(refMark[1].trim());
			if (parts.book && parts.chapter) return `${parts.book} ${parts.chapter}`;
			if (parts.book) return parts.book;
		}
		const info = extractReferenceInfo(content);
		if (!info?.ref) continue;
		const parts = parseStudyRefParts(info.ref);
		if (parts.book && parts.chapter) return `${parts.book} ${parts.chapter}`;
		if (parts.book) return parts.book;
	}
	return null;
}

/** Primary BCP-47 subtag so "es" matches "es-419". */
function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

function buildLangSwitchMarker(code: string, pendingRef?: string, pendingIntent?: string): string {
	if (pendingRef) {
		return `<!-- AWAITING_LANG_SWITCH:${code}|${pendingRef}|${pendingIntent ?? 'annotated_passage'} -->`;
	}
	return `<!-- AWAITING_LANG_SWITCH:${code} -->`;
}

function extractAwaitingLangSwitch(history: ConversationTurn[]): {
	code: string;
	pendingRef?: string;
	pendingIntent?: string;
} | null {
	const last = [...history].reverse().find((m) => m.role === 'assistant');
	if (!last) return null;
	const match = /<!-- AWAITING_LANG_SWITCH:([a-zA-Z0-9_-]+)(?:\|([^|>]+)\|([^>]+))? -->/.exec(
		last.content
	);
	if (!match) return null;
	return {
		code: match[1],
		pendingRef: match[2] || undefined,
		pendingIntent: match[3] || undefined
	};
}

function hasRecentLangSwitchDecline(history: ConversationTurn[]): boolean {
	return history
		.filter((m) => m.role === 'assistant')
		.slice(-6)
		.some((m) => m.content.includes('<!-- LANG_SWITCH_DECLINED -->'));
}

/**
 * LLM-only detection of the language the user is writing in vs the selected UI language.
 * No hardcoded word lists — the model reasons from the message text.
 */
async function detectSpokenLanguage(
	llm: OpenAILLMProvider,
	message: string,
	currentLanguage: string
): Promise<{ spokenCode: string | null; mismatches: boolean }> {
	const trimmed = message.trim();
	if (!trimmed) return { spokenCode: null, mismatches: false };

	const system =
		`You detect which natural language a user is writing in for a Bible translation app.\n` +
		`Current study UI language code: ${currentLanguage}.\n` +
		`Given the user message, output ONLY valid JSON on one line:\n` +
		`{"spokenLanguage":"<BCP-47 code or null>","mismatchesCurrent":<true|false>}\n` +
		`Rules:\n` +
		`- spokenLanguage is the language of the writing itself (e.g. "es", "pt", "fr", "en"), not the Bible topic.\n` +
		`- Judge by the FRAMING language of the message. Quoted words/phrases in another language (e.g. target-language translation choices in quotes) are content, not the writing language — ignore them.\n` +
		`- mismatchesCurrent is true ONLY when spokenLanguage is clearly different from the current UI language.\n` +
		`- Compare primary language subtags only ("es" matches "es-419"; "pt" matches "pt-br").\n` +
		`- Short greetings or phrases can be enough when the language is clear.\n` +
		`- If the message is only a scripture reference / numbers with no other wording, use spokenLanguage null and mismatchesCurrent false.\n` +
		`- Do not use any fixed word list — reason from the text. No markdown fences.`;

	try {
		const raw = await llm.generate(
			[
				{ role: 'system', content: system },
				{ role: 'user', content: trimmed }
			],
			{ maxTokens: 40 }
		);
		const match = raw.match(/\{[\s\S]*?\}/);
		if (!match) return { spokenCode: null, mismatches: false };
		const parsed = JSON.parse(match[0]) as Record<string, unknown>;
		const spokenCode =
			typeof parsed.spokenLanguage === 'string' &&
			parsed.spokenLanguage !== 'null' &&
			parsed.spokenLanguage.trim()
				? parsed.spokenLanguage.trim().toLowerCase()
				: null;
		let mismatches = Boolean(parsed.mismatchesCurrent);
		if (spokenCode && primarySubtag(spokenCode) === primarySubtag(currentLanguage)) {
			mismatches = false;
		}
		return { spokenCode, mismatches };
	} catch {
		return { spokenCode: null, mismatches: false };
	}
}

async function generateLangSwitchAsk(
	llm: OpenAILLMProvider,
	message: string,
	currentLanguage: string,
	spokenCode: string,
	history: ConversationTurn[]
): Promise<string> {
	const system =
		`You are Ezer, a Bible translation helper. The user just wrote in a different language ` +
		`than the selected study UI language (${currentLanguage}). They appear to be writing in "${spokenCode}".\n` +
		`Write a brief friendly reply (1–3 short sentences) that:\n` +
		`1) Responds naturally to their message if it is a greeting or opener.\n` +
		`2) Notices they are writing in a different language than the selected study language.\n` +
		`3) Asks whether they want to switch the study language to match (mention the language, not technical jargon).\n` +
		`Reply in the language the user was writing in. No markdown. No HTML comments.`;

	try {
		return (
			(
				await llm.generate(
					[
						{ role: 'system', content: system },
						...history.slice(-4).map((m) => ({
							role: m.role,
							content: m.content.replace(/<!--[\s\S]*?-->/g, '').trim()
						})),
						{ role: 'user', content: message }
					],
					{ maxTokens: 120 }
				)
			)?.trim() || ''
		);
	} catch {
		return '';
	}
}

async function generateLangSwitchConfirm(
	llm: OpenAILLMProvider,
	resolvedCode: string,
	declined: boolean
): Promise<string> {
	const system = declined
		? `You are Ezer. The user declined switching the study language. Briefly acknowledge (1 sentence) and invite them to continue. Match their language from context if clear. No markdown.`
		: `You are Ezer. The study language is now set to "${resolvedCode}". Briefly confirm (1–2 sentences) and invite them to share which Bible passage they are working on. Reply in that language. No markdown.`;

	try {
		return (
			(
				await llm.generate(
					[
						{ role: 'system', content: system },
						{ role: 'user', content: declined ? 'no' : 'yes' }
					],
					{
						maxTokens: 80
					}
				)
			)?.trim() || ''
		);
	} catch {
		return '';
	}
}

async function fetchLanguageList(
	callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<LanguageOption[]> {
	try {
		const raw = (await callTool('list_languages', {})) as
			| { languages?: LanguageOption[] }
			| LanguageOption[];
		return Array.isArray(raw) ? raw : ((raw as { languages?: LanguageOption[] }).languages ?? []);
	} catch {
		return [];
	}
}

async function resolveAndUpgradeLanguage(
	llm: OpenAILLMProvider,
	reply: string,
	langList: LanguageOption[]
): Promise<string | null> {
	let resolvedCode =
		resolveLanguage(reply, langList) ?? (await resolveLanguageLLM(llm, reply, langList));
	if (!resolvedCode) return null;
	if (!resolvedCode.includes('-') && langList.length > 0) {
		const prefix = resolvedCode + '-';
		const variant = langList.find((l) => (l.code ?? '').startsWith(prefix))?.code;
		if (variant) resolvedCode = variant;
	}
	return resolvedCode;
}

/**
 * Returns true when conversation history shows an active Bible passage session
 * (annotated passage, batch drill, checklist, or any response mentioning a USFM ref).
 * Path G (conversational) should be skipped in this case.
 *
 * NOTE: All checks here are structural pattern matches on deterministic content
 * (HTML comment markers, USFM reference format, batch footer pattern) rather than
 * free-form intent classification. They are reliable and do not benefit from LLM
 * replacement. No TODO(llm-intent) needed.
 */
function hasActivePassageSession(history: ConversationTurn[]): boolean {
	const assistantMsgs = history
		.filter((m) => m.role === 'assistant')
		.slice(-4)
		.map((m) => m.content);

	for (const content of assistantMsgs) {
		if (/<!-- CHALLENGES:\d+/.test(content)) return true;
		if (/<!-- PHRASE_DRILL:\d+/.test(content)) return true;
		if (/<!-- QUIZ:(?:\d+|panel)\/\d+/.test(content)) return true;
		if (/<!-- CHECKLIST:\d+\/\d+ -->/.test(content)) return true;
		if (/<!-- BATCH:[A-Z0-9]+ \d+:\d+/i.test(content)) return true;
		if (/<!-- REF:[^>]+ -->/.test(content)) return true;
		if (/Say "next" for [A-Z0-9]+ \d+:\d+/i.test(content)) return true;
		if (/\[Step \d+\/\d+\]/i.test(content)) return true;
		// Any USFM reference pattern (e.g. "TIT 2:12", "JHN 3:16")
		if (/\b[A-Z0-9]{2,3}\s+\d+:\d+\b/.test(content)) return true;
		// Natural-language refs ("Tito 2:12", "John 3:16") via shared extractor
		if (extractReferenceInfo(content) !== null) return true;
		// Language confirmed marker in assistant content
		if (/extractReferenceInfo|<!-- LANG:/.test(content)) return true;
	}

	// Also check if any user message in the last 4 turns contained a reference
	const userMsgs = history
		.filter((m) => m.role === 'user')
		.slice(-4)
		.map((m) => m.content);
	for (const content of userMsgs) {
		if (extractReferenceInfo(content) !== null) return true;
	}

	return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ChatAnswer {
	response: string;
	citations: { path: string; title?: string }[];
	reference?: string;
	mode: 'compose' | 'rag' | 'training-only';
	latencyMs: number;
	dataWarning?: string;
	intent?: string;
	/** Next verse-batch reference when in a progressive-disclosure session. */
	nextBatch?: string;
	/** Structured translation challenges from an annotated_passage response. */
	challenges?: Challenge[];
	/** For phrase_drill: the 1-based index of the challenge just answered. */
	drillIndex?: number;
	/** Total number of challenges in the current session. */
	totalChallenges?: number;
	/** Every MCP tool call made during this turn, in invocation order. */
	toolCalls?: ToolCallTrace[];
}

export type { Challenge, ToolCallTrace };

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export interface StreamEmit {
	/** Send a progress/status message (not part of the final answer text) */
	status(text: string): void;
	/** Send a token delta for the in-progress assistant message */
	token(delta: string): void;
	/** Send a named sub-agent progress update (for the thinking panel in the UI) */
	thinking(label: string, state: 'working' | 'done'): void;
	/** Send structured metadata (language, name, flags) */
	meta(data: StreamMeta): void;
	/** Emit a structured UI component for generative-UI rendering */
	ui(component: UIComponent): void;
	/** Imperative resources-panel command (open / focus tab / highlight / scroll) */
	panelAction?(action: import('$core/harness/panelActions.js').PanelAction): void;
	/** Signal end of stream */
	done(data?: Partial<ChatAnswer>): void;
	/** Signal an error */
	error(message: string): void;
	/** Emit a debug trace event (only when debug mode is active) */
	trace?(ev: import('$core/harness/traceEvents.js').TraceEvent): void;
}

export type { UIComponent };

/**
 * Wrap StreamEmit so `done` extracts `<!-- PANEL:… -->` trailers into
 * `panel_action` SSE events and strips them from the final response text.
 */
export function wrapEmitForPanelMarkers(emit: StreamEmit): StreamEmit {
	return {
		...emit,
		done(data) {
			const response = data?.response;
			if (typeof response !== 'string' || !response.includes('<!-- PANEL:')) {
				emit.done(data);
				return;
			}
			const { actions, cleaned } = extractPanelActionsFromText(response);
			for (const action of coalescePanelActions(actions)) {
				emit.panelAction?.(action);
			}
			emit.done({ ...data, response: cleaned });
		}
	};
}

/** Re-export for API route body parsing. */
export { parsePanelState, type PanelState };

export interface StreamMeta {
	/** Legacy / receptor target language switch. */
	setLanguage?: string;
	/** Door43 resource language variant resolution (e.g. es → es-419). */
	setSourceLanguage?: string;
	setName?: string;
	/** Sync Study / Translate / Check control when intent switches mode. */
	setWorkflowMode?: WorkflowMode;
	awaitingLanguage?: boolean;
	reference?: string;
	intent?: string;
	citations?: { path: string; title?: string }[];
	challenges?: Challenge[];
	nextBatch?: string;
	toolCalls?: ToolCallTrace[];
}

export interface UserProfile {
	name?: string;
	/** Legacy single field — receptor / target when source+target unset. */
	language?: string;
	/** Door43 resources + coach conversation language. */
	sourceLanguage?: string;
	/** Receptor label only ("translating into X"). */
	targetLanguage?: string;
	/** Last passage/book reference the user worked on (e.g. "TIT 1"), for resume. */
	lastReference?: string;
	/** Active Study / Translate / Check workflow mode. */
	workflowMode?: WorkflowMode;
}

interface PlatformEnv {
	OPENAI_API_KEY?: string;
	/** Worker base URL for tool calls (e.g. http://localhost:8787 in dev). */
	MCP_BASE_URL?: string;
	/** REST Data API base URL (e.g. http://localhost:8788 when running the API worker locally).
	 *  When set, can be used by tooling that calls the REST API directly.
	 *  The MCP worker itself uses the API service binding in production;
	 *  for local dev, set API_BASE_URL on the MCP worker process instead. */
	API_BASE_URL?: string;
	/** Service binding to the REST API worker (production). */
	API?: Fetcher;
	/** Allow other Cloudflare bindings through for in-process tool calls. */
	[key: string]: unknown;
}

export type ChatModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1' | 'gpt-4.1-mini';
export const DEFAULT_MODEL: ChatModel = 'gpt-4o';

export type CallTool = (name: string, params: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LLM-driven language resolver
// ---------------------------------------------------------------------------

/**
 * Ask the LLM to map a free-text language reply to a BCP-47 code, then
 * validate the result against the catalog list.
 *
 * Returns the matched code string, or null if the LLM can't resolve it.
 */
async function resolveLanguageLLM(
	llm: OpenAILLMProvider,
	reply: string,
	langList: LanguageOption[]
): Promise<string | null> {
	// Build a compact catalog string for context (cap at 120 entries to stay within token budget)
	const catalogSample = langList
		.slice(0, 120)
		.map((l) => `${l.code}${l.name ? ` (${l.name})` : ''}`)
		.join(', ');

	const system =
		`You are a language-code resolver for Bible translation software. ` +
		`Given the user's reply, output ONLY a BCP-47 language code (e.g. es, es-419, pt-br, zh-Hans) ` +
		`or the word NONE if you cannot determine a language. ` +
		`Do not output anything else — no punctuation, no explanation. ` +
		(catalogSample ? `Known catalog codes: ${catalogSample}.` : '');

	let raw: string;
	try {
		raw = await llm.generate(
			[
				{ role: 'system', content: system },
				{ role: 'user', content: reply }
			],
			{ maxTokens: 12 }
		);
	} catch {
		return null;
	}

	const candidate = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '');
	if (!candidate || candidate === 'none') return null;

	// Validate: exact match in catalog
	const codeSet = new Set(langList.map((l) => (l.code ?? '').toLowerCase()));
	if (codeSet.has(candidate)) {
		// Return with original casing from catalog
		return langList.find((l) => (l.code ?? '').toLowerCase() === candidate)?.code ?? null;
	}

	// Try base language (es-419 -> es) if the full code isn't in the catalog
	const base = candidate.split('-')[0];
	if (base !== candidate && codeSet.has(base)) {
		return langList.find((l) => (l.code ?? '').toLowerCase() === base)?.code ?? null;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Immediate acknowledgment — fires synchronously before any awaits
// ---------------------------------------------------------------------------

/**
 * Emit a templated status acknowledgment immediately after intent classification,
 * before any async work starts. This eliminates the cold-start dead window by
 * giving the user visual feedback within < 1ms on every request.
 */
function immediateAck(emit: StreamEmit, intent: string, ref?: string, language = 'en'): void {
	const refLabel = ref ? `**${ref}**` : 'this passage';
	const acks: Record<string, string> = {
		annotated_passage: getStatusText(language, 'reading'),
		passage_overview: `Preparing a full overview of ${refLabel} \u2014 this may take a moment\u2026`,
		phrase_drill: `Exploring that phrase from ${refLabel}\u2026`,
		word_study: `Looking up that term\u2026`,
		open_ended: `Let me look that up for you\u2026`,
		language_answer: `Updating your language preference\u2026`
	};
	emit.status(acks[intent] ?? `Working on your request\u2026`);
}

// ---------------------------------------------------------------------------

/**
 * Build callTool + LLM provider.
 *
 * Prefer in-process tool handlers when `platform.env` has API bindings.
 * Never `fetch()` this Worker's own `/api/tool` in production — that triggers
 * Cloudflare error 1042 (same-zone Worker self-fetch).
 *
 * HTTP fallback (vite / external MCP_BASE_URL only):
 *   1. platform.env.MCP_BASE_URL
 *   2. process.env.MCP_BASE_URL
 *   3. requestOrigin + kit.paths.base + /api/tool
 */
export function createSkill(
	platformEnv: PlatformEnv | undefined | null,
	requestOrigin: string,
	model: ChatModel = DEFAULT_MODEL,
	opts?: { waitUntil?: (promise: Promise<unknown>) => void }
): { callTool: CallTool; llm: OpenAILLMProvider } {
	const apiKey =
		platformEnv?.OPENAI_API_KEY ??
		(typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined) ??
		'';

	// Attach waitUntil without spreading platform.env (bindings are non-enumerable).
	const toolEnv: PlatformEnv | undefined | null =
		platformEnv && opts?.waitUntil
			? (new Proxy(platformEnv, {
					get(target, prop, receiver) {
						if (prop === 'waitUntil') return opts.waitUntil;
						return Reflect.get(target, prop, receiver);
					},
					has(target, prop) {
						return prop === 'waitUntil' || Reflect.has(target, prop);
					}
				}) as PlatformEnv)
			: platformEnv;

	const callTool: CallTool = async (name, params) => {
		const requestId = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

		if (canRunToolsInProcess(toolEnv)) {
			return runToolInProcess(name, params, toolEnv, requestId);
		}

		const toolBase =
			(toolEnv?.MCP_BASE_URL as string | undefined) ??
			(typeof process !== 'undefined' ? process.env?.MCP_BASE_URL : undefined) ??
			requestOrigin;
		const toolUrl = `${toolBase.replace(/\/$/, '')}${withBase('/api/tool')}`;

		const res = await fetch(toolUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, params, requestId })
		});

		const data = (await res.json()) as { structuredContent?: unknown; error?: string };

		if (!res.ok || data.error) {
			throw new Error(data.error ?? `Tool "${name}" failed with HTTP ${res.status}`);
		}

		return data.structuredContent ?? data;
	};

	const llm = new OpenAILLMProvider({ apiKey, model });

	return { callTool, llm };
}

// ---------------------------------------------------------------------------
// Answer router — delegates to ContextHarness
// ---------------------------------------------------------------------------

/**
 * Route a user message through the ContextHarness:
 *   classify intent → select resources → parallel-fetch → rc-link expand
 *   → budget → intent-specific prompt → generate.
 *
 * Falls back gracefully when no data is available.
 */
export async function answer(
	{ callTool, llm }: { callTool: CallTool; llm: OpenAILLMProvider },
	message: string,
	language: string,
	conversationHistory?: ConversationTurn[]
): Promise<ChatAnswer> {
	const start = Date.now();

	const harness = new ContextHarness(llm, callTool);

	const result = await harness.run(message, { language, conversationHistory });

	return {
		response: result.response,
		citations: result.citations,
		reference: result.reference,
		mode: result.mode,
		dataWarning: result.dataWarning,
		intent: result.intent,
		nextBatch: result.nextBatch,
		challenges: result.challenges,
		drillIndex: result.drillIndex,
		totalChallenges: result.totalChallenges,
		toolCalls: result.toolCalls,
		latencyMs: Date.now() - start
	};
}

// ---------------------------------------------------------------------------
// Intro greeting (language-first chat home)
// ---------------------------------------------------------------------------

/**
 * Stream Ezer's first-turn introduction in the user's study language.
 * Used when the user picks a language (or returns with a saved preference)
 * so any Door43 catalog language can be greeted without hardcoded copy.
 *
 * When `lastReference` is set, fetches book context (with timeout) and offers
 * to resume studying that book's context or verse-by-verse work.
 */
export async function streamIntroGreeting(
	llm: OpenAILLMProvider,
	opts: {
		/** Legacy / receptor target when source unset. */
		language: string;
		languageName?: string;
		sourceLanguage?: string;
		targetLanguage?: string;
		name?: string;
		lastReference?: string;
		callTool?: CallTool;
	},
	emit: StreamEmit
): Promise<void> {
	const pair = resolveLanguagePair({
		language: opts.language,
		sourceLanguage: opts.sourceLanguage,
		targetLanguage: opts.targetLanguage
	});
	/** Coach greets in source/conversation language. */
	const code = pair.sourceLanguage;
	const targetCode = pair.targetLanguage;
	const langLabel = opts.languageName?.trim() ? `${opts.languageName.trim()} (${code})` : code;
	const name = opts.name?.trim();
	const lastRef = opts.lastReference?.trim();

	const nameCtx = name
		? `Address the user by the name "${name}" in the greeting (natural and warm).`
		: `You do not know the user's name yet. In ONE combined, low-pressure question, ask what to call them AND which book or passage they are working on. If they only name a passage later, proceed without insisting on a name.`;

	const receptorHint =
		!isNeutralTarget(targetCode) && primarySubtag(targetCode) !== primarySubtag(code)
			? `They are translating into ${targetCode} (receptor). Mention that briefly if natural, but converse in ${code}. Do not ask them to paste their receptor draft.`
			: '';

	emit.status('Ezer is greeting you…');

	let contextGuidance = '';
	let hasContextNotes = false;
	let resumeRef: string | undefined;
	if (lastRef && opts.callTool) {
		// Prefer book-level orientation: bare book code → front:intro only.
		const bookMatch = lastRef.match(/^(\S+)/);
		const orientRef = bookMatch ? bookMatch[1].toUpperCase() : lastRef;
		resumeRef = orientRef;
		emit.status('Loading your previous study context…');
		const bookCtx = await fetchBookContext(opts.callTool, orientRef, code, 10000);
		hasContextNotes = emitBookContextNotes(emit, orientRef, bookCtx);
		contextGuidance = bookContextPromptGuidance(bookCtx, code);
	}

	const resumeCtx = resumeRef
		? [
				`The user was previously working on ${resumeRef}. Mention that book and welcome them back.`,
				contextGuidance ||
					`You do not have intro notes loaded — still mention the book without inventing background.`,
				`End with exactly ONE clear question offering either reading book context in the panel OR starting/resuming chapter 1 verse-by-verse.`,
				`Do not summarize the book intro in chat when the panel has the notes.`
			]
				.filter(Boolean)
				.join(' ')
		: `End with exactly ONE clear combined question about what to call them and which Bible passage or book they are working on.`;

	const systemMsg = [
		`You are Ezer — a Bible translation consultant. Your name means "helper" in Hebrew; mention that briefly when you introduce yourself.`,
		`You consult translators with CANA questions (Consistent, Accurate, Natural, Clear) — you do not dump notes, rewrite their draft, or grade unknown receptor-language form.`,
		`Write ONLY in the source/conversation language: ${langLabel}.`,
		receptorHint,
		`Do not use markdown, bullet lists, or headings.`,
		`Reply in 2–3 short sentences max.`,
		`Never instruct the user to type a keyword (like "next" or "skip").`,
		`Never ask them to paste their receptor-language draft for you to read.`,
		nameCtx,
		resumeCtx
	]
		.filter(Boolean)
		.join(' ');

	const userMsg = resumeRef
		? `Please introduce yourself and help me resume studying ${resumeRef}.`
		: 'Please introduce yourself and start the conversation.';

	const chunks: string[] = [];
	if (llm.generateStream) {
		for await (const delta of llm.generateStream(
			[
				{ role: 'system', content: systemMsg },
				{ role: 'user', content: userMsg }
			],
			{ maxTokens: 220 }
		)) {
			emit.token(delta);
			chunks.push(delta);
		}
	} else {
		const text = await llm.generate(
			[
				{ role: 'system', content: systemMsg },
				{ role: 'user', content: userMsg }
			],
			{ maxTokens: 220 }
		);
		emit.token(text);
		chunks.push(text);
	}

	emit.done({
		response: chunks.join(''),
		citations: hasContextNotes
			? [{ path: `tn/${resumeRef ?? 'context'}`, title: 'Book introduction' }]
			: [],
		reference: resumeRef,
		mode: 'compose',
		latencyMs: 0,
		intent: 'intro'
	});
}

// ---------------------------------------------------------------------------
// Streaming orchestrator
// ---------------------------------------------------------------------------

/** Default strategic language — gate fires when language is still this value. */
const DEFAULT_LANGUAGE = 'en';

/**
 * Stream an answer through the language-gate → full pipeline.
 *
 * Emitter callbacks are called synchronously from within this async function.
 * The caller is responsible for buffering / encoding SSE frames.
 *
 * @param ctx          - { callTool, llm } from createSkill()
 * @param message      - latest user message
 * @param language     - legacy / receptor target from the UI (or source when pair omitted)
 * @param history      - prior conversation turns (excluding the current message)
 * @param emit         - SSE emitter callbacks
 * @param profile      - optional browser profile (name + language preference)
 * @param waitUntil    - optional CF waitUntil for background work
 * @param onTrace      - optional trace callback (debug mode)
 * @param studyContext - optional compact study-session context snapshot from the client
 * @param langPairOpts - optional explicit source/target override from the client
 * @param workflowMode - Study / Translate / Check bias for coach + quiz offers
 * @param workflowModeExplicit - true when the user explicitly picked the mode
 *   (UI tab click). Explicit choices always win: soft conversation cues never
 *   flip the mode and the session-start clarify question is never asked.
 * @param panelState - optional structured resources-panel snapshot from the client
 */
export async function answerStream(
	{ callTool, llm }: { callTool: CallTool; llm: OpenAILLMProvider },
	message: string,
	language: string,
	history: ConversationTurn[],
	emit: StreamEmit,
	profile?: UserProfile,
	waitUntil?: (p: Promise<unknown>) => void,
	onTrace?: (ev: TraceEvent) => void,
	studyContext?: string,
	langPairOpts?: { sourceLanguage?: string; targetLanguage?: string },
	workflowMode?: WorkflowMode | string,
	workflowModeExplicit?: boolean,
	panelState?: PanelState | null
): Promise<void> {
	try {
		// Parse LLM PANEL trailers into typed SSE actions before closing the stream.
		emit = wrapEmitForPanelMarkers(emit);

		// Merge structured panel snapshot into STUDY CONTEXT (compact, no draft bodies).
		const panelBlock = panelState ? formatPanelStateForPrompt(panelState) : undefined;
		studyContext = mergePanelStateIntoStudyContext(studyContext, panelBlock);
		const panelGuidance = panelBlock ? PANEL_STATE_PROMPT_GUIDANCE : '';

		// When debug/trace mode is active, wrap the LLM so every call emits a trace event.
		const activeLlm: OpenAILLMProvider = onTrace
			? (new TracingLLMProvider(llm, onTrace, 'contextual') as unknown as OpenAILLMProvider)
			: llm;

		// Resolve source (resources + coach) vs target (receptor metadata).
		// Legacy `language` / profile.language → SOURCE when a gateway language
		// (en/es-419/…); target stays neutral unless explicitly set — we never
		// ask the user for a target language.
		const langPair: LanguagePair = resolveLanguagePair({
			language: language?.trim() || profile?.language || DEFAULT_LANGUAGE,
			sourceLanguage: langPairOpts?.sourceLanguage?.trim() || profile?.sourceLanguage || undefined,
			targetLanguage: langPairOpts?.targetLanguage?.trim() || profile?.targetLanguage || undefined
		});
		/** Source / conversation language — tools + coach replies. */
		const effectiveLang = langPair.sourceLanguage;
		/** Receptor label — metadata only; never coach locale. */
		const targetLang = langPair.targetLanguage;
		const pairGuidance = languagePairPromptGuidance(langPair);
		const historyForClassify = history as Array<{
			role: 'user' | 'assistant' | 'system';
			content: string;
		}>;

		// Workflow mode: intent switch wins for this turn, else client/profile, else Study.
		const clientMode = parseWorkflowMode(
			workflowMode ?? profile?.workflowMode ?? DEFAULT_WORKFLOW_MODE
		);
		// The user picked the mode via a UI tab click — soft cues must not flip
		// it and the session-start clarify question must not second-guess it.
		const modeExplicit = workflowModeExplicit === true;
		const intentMode = detectWorkflowModeIntent(message);
		const draftCheckCue = detectDraftSubmitIntent(message);
		// Checklist-item click — hidden CHECKITEM marker from the resources panel.
		// Deterministic UI action: always Check mode, regardless of what the
		// item's visible title text looks like to the NL mode detector.
		const checkItemClick = parseCheckItemFromMessage(message);
		// Panel-quiz submission — hidden QUIZSUBMIT marker from the resources
		// panel. Deterministic UI action (like CHECKITEM): graded in Path QP
		// below, never re-routed by conversational classification.
		const quizSubmit = parseQuizSubmitFromMessage(message);
		// Answer to a pending session-start clarify question ("study / translate /
		// check?") — routes the mode like an explicit switch.
		const clarifyAnswerMode = hasPendingWorkflowClarify(historyForClassify)
			? parseWorkflowClarifyAnswer(message)
			: null;
		// Soft conversation cues ("how do I say…" → translate, "I finished my
		// draft" → check). Gated by current mode so ordinary coaching questions
		// never ping-pong modes; never breaks a sticky Check session. Skipped
		// entirely when the user explicitly clicked a mode tab — explicit wins.
		const softInferenceRaw = inferWorkflowMode(message, clientMode);
		const softModeInference =
			modeExplicit && softInferenceRaw?.confidence === 'soft' ? null : softInferenceRaw;
		const activeWorkflowMode: WorkflowMode = checkItemClick
			? 'check'
			: (intentMode ??
				clarifyAnswerMode ??
				(draftCheckCue ? 'check' : (softModeInference?.mode ?? clientMode)));
		if (activeWorkflowMode !== clientMode) {
			emit.meta({ setWorkflowMode: activeWorkflowMode });
		}
		// Session-start clarify: passage session but no mode signal anywhere —
		// coach asks ONE simple question this turn (final gate on a resolved
		// passage reference happens in the done wrapper below).
		const workflowClarifyEligible =
			!checkItemClick &&
			!draftCheckCue &&
			shouldAskWorkflowClarify({
				message,
				currentMode: clientMode,
				modeExplicit,
				history: historyForClassify,
				sessionActive:
					Boolean(extractCheckingFromHistory(historyForClassify)) ||
					Boolean(extractQuizFromHistory(historyForClassify))
			});

		// Build name-aware system snippet (optionally enriched with study context)
		let nameSnippet = profile?.name ? `Address the user as ${profile.name} when natural.` : '';
		nameSnippet = nameSnippet ? `${nameSnippet}\n\n${pairGuidance}` : pairGuidance;
		nameSnippet = `${nameSnippet}\n\n${workflowModePromptBias(activeWorkflowMode)}`;
		if (workflowClarifyEligible) {
			nameSnippet = `${nameSnippet}\n\n${workflowClarifyPromptInstruction(effectiveLang)}`;
		}
		if (studyContext) {
			nameSnippet = `${nameSnippet}\n\nSTUDY CONTEXT:\n${studyContext}`;
		}
		if (panelGuidance) {
			nameSnippet = `${nameSnippet}\n\n${panelGuidance}`;
		}

		const traceStart = Date.now();

		// 1. Fast rule-based intent classification (synchronous, no LLM)
		let intentResult: IntentResult = classifyIntent(message, historyForClassify);

		// 1b. LLM contextual enrichment for short conversational messages.
		//     Replaces ALL hardcoded multilingual regex patterns — the LLM understands
		//     "sí", "sim", "oui", "はい", "Me llamo X", etc. without any word lists.
		let ctx: ContextualFlags = {
			isAffirmative: false,
			isNegative: false,
			isContinuation: false,
			extractedName: null,
			extractedLanguage: null,
			wantsPassageResources: false,
			extractedBook: null,
			extractedChapter: null,
			extractedVerse: null,
			extractedVerseEnd: null
		};
		// Skip contextual enrichment for deterministic panel clicks (CHECKITEM /
		// QUIZSUBMIT): they are not conversational speech and must not be re-routed.
		if (!intentResult.reference && !checkItemClick && !quizSubmit && message.trim().length <= 120) {
			ctx = await resolveContextual(activeLlm, message, history);

			// Override: batch / checklist continuation
			// Skip when the user named a relative chapter/verse/section — those are not
			// vague "next" continuations; they need a composed reference below.
			const hasRelativeRef =
				ctx.extractedChapter != null ||
				ctx.extractedVerse != null ||
				mentionsRelativeRef(message) ||
				mentionsSectionSelection(message);

			// Explicit checklist step jump: "paso 3", "step 2", "vamos al paso 4".
			// Takes priority over LLM verse/section extraction — "paso" ≠ "sección".
			const stepJumpMatch = message.match(/\b(?:paso|step|étape)\s*(\d{1,2})\b/i);
			const stepJump = stepJumpMatch ? Number.parseInt(stepJumpMatch[1], 10) : null;
			const session = extractSessionContext(historyForClassify);

			if (
				!intentResult.continuationRef &&
				session?.type === 'checklist' &&
				stepJump != null &&
				stepJump >= 1 &&
				stepJump <= session.totalSteps
			) {
				intentResult = {
					...intentResult,
					intent: 'checklist_step',
					nextStep: stepJump,
					totalSteps: session.totalSteps,
					confidence: 'high'
				};
				// Clear any LLM-misread verse signals so composeRelativeReference
				// does not override the checklist jump below.
				ctx = {
					...ctx,
					extractedChapter: null,
					extractedVerse: null,
					extractedVerseEnd: null,
					isContinuation: false
				};
			} else if (
				!intentResult.continuationRef &&
				!hasRelativeRef &&
				ctx.isContinuation &&
				// A plain negative must NOT advance checklist/batch — Path G+ offers alternatives.
				!ctx.isNegative
			) {
				if (session?.type === 'batch') {
					intentResult = {
						...intentResult,
						intent: 'passage_help',
						reference: session.nextRef,
						continuationRef: session.nextRef,
						confidence: 'high'
					};
				} else if (session?.type === 'checklist') {
					const nextStep = session.currentStep + 1;
					if (nextStep <= session.totalSteps) {
						intentResult = {
							...intentResult,
							intent: 'checklist_step',
							nextStep,
							totalSteps: session.totalSteps,
							confidence: 'high'
						};
					}
				}
			}

			// Name extraction — LLM result wins over regex
			if (ctx.extractedName && !profile?.name) {
				emit.meta({ setName: ctx.extractedName });
			}
		}

		// Client study-session snapshot — keep passage-aware routing even when
		// chat history markers were lost (e.g. Spanish guide copy without USFM codes).
		// Fall back to the most recent book/chapter mentioned in history so
		// "sección 1" still composes when context is absent.
		const studyRef = extractStudyReference(studyContext) ?? extractStudyRefFromHistory(history);
		const activePassage = hasActivePassageSession(history) || Boolean(studyRef);

		// Relative chapter/verse ("chapter 1", "verse 1", "1:1-4") → compose full
		// USFM ref against the active study context so Path F runs with MCP tools.
		// Deterministic fallback when the LLM classifier treats "continue to
		// chapter 1" as bare isContinuation and leaves extractedChapter null.
		if (
			!intentResult.reference &&
			ctx.extractedChapter == null &&
			ctx.extractedVerse == null &&
			mentionsRelativeRef(message)
		) {
			const fallback = extractRelativeRefFallback(message);
			if (fallback) {
				ctx = {
					...ctx,
					extractedChapter: fallback.extractedChapter,
					extractedVerse: fallback.extractedVerse,
					extractedVerseEnd: fallback.extractedVerseEnd,
					isContinuation: false
				};
				emit.trace?.({
					type: 'route',
					path: 'F',
					reason: `relative-ref fallback: ch=${fallback.extractedChapter} v=${fallback.extractedVerse}`
				});
			}
		}

		// Section selection ("quiero traducir la sección 1") → look up the Nth
		// verse-range heading in the last assistant overview.
		if (
			!intentResult.reference &&
			intentResult.intent !== 'checklist_step' &&
			ctx.extractedChapter == null &&
			ctx.extractedVerse == null &&
			mentionsSectionSelection(message)
		) {
			const lastAssistantFull =
				[...history]
					.reverse()
					.find((m) => m.role === 'assistant')
					?.content?.replace(/<!--[\s\S]*?-->/g, '')
					.trim() ?? '';
			const section = resolveSectionSelection(message, lastAssistantFull);
			if (section) {
				ctx = {
					...ctx,
					extractedChapter: section.extractedChapter,
					extractedVerse: section.extractedVerse,
					extractedVerseEnd: section.extractedVerseEnd,
					isContinuation: false
				};
				emit.trace?.({
					type: 'route',
					path: 'F',
					reason: `section-selection fallback: v=${section.extractedVerse}-${section.extractedVerseEnd}`
				});
			}
		}

		let composedPassageHint: string | null = null;
		// Do not compose a passage ref when already advancing a checklist / quiz step.
		if (
			!intentResult.reference &&
			intentResult.intent !== 'checklist_step' &&
			!isQuizRoutingIntent(intentResult.intent) &&
			(ctx.extractedChapter != null || ctx.extractedVerse != null)
		) {
			const composed = composeRelativeReference(ctx, studyRef, resolveBookToUsfm);
			if (composed) {
				intentResult = {
					...intentResult,
					reference: composed.reference,
					intent: composed.intent,
					confidence: 'high'
				};
				composedPassageHint = composed.reference;
				emit.trace?.({
					type: 'route',
					path: 'F',
					reason: `composed ${composed.reference} from relative chapter/verse + study context`
				});
			}
		}

		// Bare affirmative accepting the assistant's chapter offer ("¿te gustaría
		// comenzar con el capítulo 1?" → "sí, empecemos") carries no reference of
		// its own, so it used to route to open conversation and the readiness
		// gate (context quiz offer) never fired on a fresh flow. Compose the
		// offered chapter against the book-only study ref so both the gate and
		// the passage pipeline see the advancement.
		if (
			!intentResult.reference &&
			intentResult.intent !== 'checklist_step' &&
			!isQuizRoutingIntent(intentResult.intent) &&
			!isCheckingRoutingIntent(intentResult.intent) &&
			(ctx.isAffirmative || ctx.isContinuation) &&
			ctx.extractedChapter == null &&
			ctx.extractedVerse == null
		) {
			const study = parseStudyRefParts(studyRef);
			if (study.book && study.chapter == null) {
				const lastAssistantContent = [...historyForClassify]
					.reverse()
					.find((m) => m.role === 'assistant')?.content;
				const offeredChapter = extractChapterOfferFromAssistant(lastAssistantContent);
				if (offeredChapter != null) {
					intentResult = {
						...intentResult,
						reference: `${study.book} ${offeredChapter}`,
						intent: 'passage_overview',
						confidence: 'high'
					};
					composedPassageHint = intentResult.reference ?? null;
					emit.trace?.({
						type: 'route',
						path: 'F',
						reason: `affirmative accepted chapter offer → ${study.book} ${offeredChapter}`
					});
				}
			}
		}

		// "Show me the text" / similar — bind to the loaded passage and run the
		// annotated-passage pipeline so MCP tools actually fetch scripture + helps.
		// Never steal an active Path Q quiz intent or sticky checking session.
		if (
			!isQuizRoutingIntent(intentResult.intent) &&
			!isCheckingRoutingIntent(intentResult.intent) &&
			ctx.wantsPassageResources &&
			(intentResult.reference || studyRef) &&
			(intentResult.intent === 'open_ended' ||
				intentResult.intent === 'passage_help' ||
				!intentResult.reference)
		) {
			intentResult = {
				...intentResult,
				reference: intentResult.reference ?? studyRef!,
				intent: 'annotated_passage',
				confidence: 'high'
			};
		}

		// Reinforce quiz routing after contextual LLM flags / passage binding.
		// Abandon only when the *user message* names a new Bible reference —
		// studyRef / wantsPassageResources must not clear a live QUIZ:0 offer.
		const quizReinforced = reinforceQuizSession({
			message,
			intentResult,
			history: historyForClassify,
			isAffirmative: ctx.isAffirmative,
			isContinuation: ctx.isContinuation
		});
		intentResult = quizReinforced.intentResult;
		let clearQuizOnResponse = quizReinforced.clearQuizOnResponse;

		// Sticky checking (Pedir revisión): keep validation replies on checking
		// even when classifyIntent would fall through to Guide / open_ended.
		const checkingReinforced = reinforceCheckingSession({
			message,
			intentResult,
			history: historyForClassify
		});
		intentResult = checkingReinforced.intentResult;
		let clearCheckingOnResponse = checkingReinforced.clearCheckingOnResponse;
		// Belt-and-suspenders: Study/Translate mode intent always ends sticky check
		// so done-handler cannot re-force Checker / check mode. Clarify answers
		// count as explicit; soft cues never end a sticky check session.
		const explicitModeSwitch = intentMode ?? clarifyAnswerMode;
		if (
			(explicitModeSwitch === 'study' || explicitModeSwitch === 'translate') &&
			extractCheckingFromHistory(historyForClassify)
		) {
			clearCheckingOnResponse = true;
			if (intentResult.intent === 'checking') {
				intentResult = {
					...intentResult,
					intent: 'open_ended',
					confidence: intentResult.confidence === 'high' ? 'medium' : intentResult.confidence
				};
			}
		}

		// Checklist-item click → checking path scoped to that item. Bind the
		// study reference so the harness fetches this passage's TN/TW/TQ, and
		// end any live quiz — the panel click is an explicit checking action.
		if (checkItemClick) {
			if (extractQuizFromHistory(historyForClassify)) {
				clearQuizOnResponse = true;
			}
			clearCheckingOnResponse = false;
			intentResult = {
				...intentResult,
				intent: 'checking',
				reference:
					intentResult.reference ??
					studyRef ??
					extractChecklistReference(studyContext) ??
					undefined,
				confidence: 'high'
			};
			// The harness re-classifies the raw click message, which carries no
			// parseable reference on the FIRST click (no sticky CHECKING footer
			// yet). Pass the resolved reference as an explicit Passage hint so
			// the checking plan always fetches this passage's TN/TW/TQ instead
			// of falling into a training-only reply.
			if (intentResult.reference) {
				composedPassageHint = intentResult.reference;
			}
			emit.trace?.({
				type: 'route',
				path: 'F',
				reason: `checklist item click ${checkItemClick.kind}:${checkItemClick.resourceId}`
			});
		}

		// Prior assistant turn — used to map probe ids → CHECK markers.
		const priorAssistantContent = [...historyForClassify]
			.reverse()
			.find((m) => m.role === 'assistant')?.content;

		// Ensure abandoned/skipped quizzes persist a cleared marker in history so
		// later turns cannot be force-graded as Path Q answers.
		// Also: deterministic CHECK markers + sticky CHECKING footer on checking turns.
		// Extra hidden markers (e.g. readiness opt-out) ride along on whatever
		// response this turn produces.
		const extraDoneMarkers: string[] = [];
		const rawDone = emit.done.bind(emit);
		emit.done = (data) => {
			let response = typeof data?.response === 'string' ? data.response : '';
			let doneIntent = data?.intent ?? intentResult.intent;
			let doneReference =
				(typeof data?.reference === 'string' && data.reference) ||
				intentResult.reference ||
				studyRef ||
				undefined;

			if (
				clearQuizOnResponse &&
				response &&
				!/<!-- QUIZ:cleared -->/.test(response) &&
				!/<!-- QUIZ:(?:\d+|panel)\/\d+(?::(?:context|passage|practice))? /.test(response)
			) {
				response = `${response}\n${buildQuizClearedMarker()}`;
			}

			const checkingActive =
				doneIntent === 'checking' || Boolean(extractCheckingFromHistory(historyForClassify));
			// Any Pedir revisión / ready-for-check turn is a (re)start: the user is
			// not answering a probe, so never auto-complete items on these turns —
			// including re-clicks while a session is already active. Checklist-item
			// clicks are also starts: clicking must never tick the item.
			const isSessionStart = detectDraftSubmitIntent(message) || checkItemClick !== null;

			if (checkingActive && !clearCheckingOnResponse && response) {
				// Deterministic one-question rule for checking replies (item check +
				// Pedir revisión probes): keep only up to the FIRST question. The
				// harness already enforces this for its checking path — this covers
				// every other route that ends in a checking reply. Never applied to
				// quiz turns (doneIntent guards).
				if (doneIntent === 'checking') {
					response = truncateAtFirstQuestion(response).text;
				}
				// CHECKITEM scope: while a clicked-item session is active, only the
				// focused item may tick from this exchange (issue: one answer ticked
				// the clicked note plus two related TW items the user never validated).
				const focusedCheckItem = findFocusedCheckItem(
					message,
					historyForClassify,
					detectDraftSubmitIntent
				);
				const validated = resolveValidatedCheckMarkers({
					userMessage: message,
					priorAssistantContent,
					studyContext,
					isSessionStart,
					focusedItem: focusedCheckItem
				});
				response = appendCheckMarkersToResponse(response, validated);
				const refForFooter =
					doneReference || extractCheckingFromHistory(historyForClassify)?.reference || '';
				if (refForFooter) {
					response = ensureCheckingSessionFooter(response, refForFooter);
					doneReference = refForFooter;
				}
				// Clear sticky session when every STUDY CONTEXT item is done.
				const stillUnchecked = parseUncheckedFromStudyContext(studyContext).filter(
					(u) => !validated.some((v) => v.kind === u.kind && v.resourceId === u.resourceId)
				);
				if (
					parseUncheckedFromStudyContext(studyContext).length > 0 &&
					stillUnchecked.length === 0
				) {
					response = ensureCheckingSessionFooter(response, refForFooter, {
						cleared: true
					});
				}
				doneIntent = 'checking';
			} else if (clearCheckingOnResponse && response) {
				response = ensureCheckingSessionFooter(response, doneReference || '', {
					cleared: true
				});
			}

			// Session-start mode clarify: a passage loaded this turn with no mode
			// signal anywhere — make sure the reply ends with the ONE mode question
			// and mark it so the next user turn routes the answer to a mode.
			const clarifyIntentOk =
				doneIntent === 'passage_help' ||
				doneIntent === 'annotated_passage' ||
				doneIntent === 'passage_overview' ||
				doneIntent === 'chapter_orientation' ||
				doneIntent === 'book_orientation' ||
				doneIntent === 'open_ended';
			if (
				workflowClarifyEligible &&
				response &&
				doneReference &&
				clarifyIntentOk &&
				!checkingActive &&
				!clearCheckingOnResponse
			) {
				if (!endsWithQuestion(response)) {
					response = `${response.trimEnd()}\n\n${buildWorkflowClarifyQuestion(effectiveLang)}`;
				}
				response = `${response}\n${WORKFLOW_CLARIFY_MARKER}`;
			}

			if (extraDoneMarkers.length > 0 && response) {
				response = `${response}\n${extraDoneMarkers.join('\n')}`;
			}

			rawDone({
				...data,
				response: response || data?.response,
				intent: doneIntent,
				reference: doneReference ?? data?.reference
			});
		};

		// -----------------------------------------------------------------------
		// Path QP: panel-quiz submission — the user answered every question in
		// the resources panel and pressed Submit. Grade the whole set against
		// the answer key in the QUIZ history marker, reply with ONE coherent
		// encouraging message, mark readiness on majority-correct, and clear
		// the quiz session (panel submit must not leave a stale chat quiz).
		// On fail: no READY; emit QUIZ:retry so an affirmative can regenerate.
		// -----------------------------------------------------------------------
		if (quizSubmit) {
			const qpLang = extractLang(historyForClassify) ?? effectiveLang;
			const quizSession = extractQuizFromHistory(historyForClassify);
			const questions = quizSession?.questions ?? [];
			emit.trace?.({
				type: 'route',
				path: 'QP',
				reason: `panel quiz submit for ${quizSubmit.reference} (${quizSubmit.answers.length} answers, ${questions.length} session questions)`
			});

			if (questions.length > 0) {
				const grade = gradeQuizSubmission(questions, quizSubmit.answers);
				const quizKind: QuizKind = quizSession?.kind ?? 'context';
				const quizScope = quizKindMarksReadiness(quizKind)
					? (extractQuizScopeFromHistory(historyForClassify) ??
						(() => {
							const p = parseRefParts(quizSubmit.reference);
							if (!p) return null;
							return p.chapter
								? {
										level: 'chapter' as const,
										book: p.book,
										chapter: p.chapter
									}
								: { level: 'book' as const, book: p.book };
						})())
					: null;
				emit.status(getStatusText(qpLang, 'thinking'));
				emit.thinking?.('Grading', 'working');
				const feedback =
					(await generateQuizResultFeedback(
						grade.results,
						quizSubmit.reference,
						qpLang,
						activeLlm
					)) ?? fallbackQuizResultFeedback(grade, qpLang);
				emit.thinking?.('Grading', 'done');

				// Update the panel with graded results (correct/expected per question).
				emit.ui(buildQuizResultComponent(quizSubmit.reference, questions, grade, quizScope));
				for (const word of feedback.split(/(\s+)/)) emit.token(word);

				// READY only for readiness-eligible context quizzes — never for
				// on-demand passage/practice kinds.
				const readyMarker =
					quizKindMarksReadiness(quizKind) && quizScope && grade.passed
						? buildReadyMarker(quizScope)
						: '';
				// Fail → retry marker (last-turn only). Pass → READY only, no retry.
				const retryMarker = !grade.passed
					? buildQuizRetryMarker(quizScope, quizSubmit.reference, quizKind)
					: '';
				emit.done({
					response: `${feedback}\n${readyMarker}${buildQuizClearedMarker()}${retryMarker}`,
					citations: [],
					mode: 'compose',
					intent: 'quiz_answer',
					reference: quizSubmit.reference,
					latencyMs: 0
				});
				return;
			}

			// No active quiz session (stale panel after a cleared quiz) — degrade
			// gently instead of guessing at an answer key.
			const stale = await formulateStaleQuizNotice(qpLang, activeLlm);
			for (const word of stale.split(/(\s+)/)) emit.token(word);
			emit.done({
				response: stale,
				citations: [],
				mode: 'compose',
				intent: 'open_ended',
				latencyMs: 0
			});
			return;
		}

		// -----------------------------------------------------------------------
		// Path QR: failed-quiz retry pending on the last assistant turn.
		// Affirm / "I'm ready" / "try again" → regenerate a fresh panel quiz.
		// Decline / other → fall through (retry expires with that turn).
		// -----------------------------------------------------------------------
		const pendingRetry = extractPendingQuizRetry(historyForClassify);
		if (pendingRetry && !checkItemClick) {
			const retryReply = interpretQuizRetryReply(
				message,
				{ isAffirmative: ctx.isAffirmative, isNegative: ctx.isNegative },
				isAffirmativeMessage
			);
			emit.trace?.({
				type: 'route',
				path: 'QR',
				reason: `quiz retry reply "${retryReply}" (${pendingRetry.kind}:${pendingRetry.level ?? '_'}:${pendingRetry.book ?? pendingRetry.quizRef}${pendingRetry.chapter ? ':' + pendingRetry.chapter : ''})`
			});

			if (retryReply === 'accept') {
				const retryLang = extractLang(historyForClassify) ?? effectiveLang;
				const retryKind: QuizKind = pendingRetry.kind ?? 'context';
				const retryScope: ReadinessScope | null =
					pendingRetry.level && pendingRetry.book
						? {
								level: pendingRetry.level,
								book: pendingRetry.book,
								chapter: pendingRetry.chapter
							}
						: readinessScopeForQuizKind(retryKind, pendingRetry.quizRef);
				const quizRef = pendingRetry.quizRef;
				emit.status(getStatusText(retryLang, 'thinking'));
				emit.thinking?.('Context quiz', 'working');
				const usePassageNotes = retryKind === 'passage' || /:\d/.test(quizRef);
				let retryNotes: Array<{
					id: string;
					text: string;
					quote?: string;
					verse?: string;
				}> = [];
				if (usePassageNotes) {
					retryNotes = await fetchPassageNotesForQuiz(callTool, quizRef, retryLang);
				} else {
					const retryCtx = await fetchBookContext(callTool, quizRef, retryLang, 4000);
					retryNotes = retryCtx.notes
						.map((n, i) => ({
							id: typeof n.id === 'string' && n.id.trim() ? n.id : `intro-${i}`,
							text: extractContextNoteText(n)
						}))
						.filter((n) => n.text.length > 0);
				}
				const retryBundle = {
					scriptures: [],
					notes: retryNotes,
					tw: [],
					ta: [],
					questions: []
				} as unknown as EnrichedBundle;
				const retryQuestions =
					retryNotes.length > 0
						? await generateQuiz(retryBundle, quizRef, retryLang, activeLlm)
						: [];
				emit.thinking?.('Context quiz', 'done');

				if (retryQuestions.length >= 3) {
					const retryPanel = buildQuizPanelComponent(quizRef, retryQuestions, retryScope);
					if (retryPanel) {
						emit.ui(retryPanel);
						const visible = await formulateQuizPanelReferral(retryLang, activeLlm);
						for (const word of visible.split(/(\s+)/)) emit.token(word);
						const scopeMarker =
							retryScope && quizKindMarksReadiness(retryKind)
								? buildQuizScopeMarker(retryScope)
								: '';
						emit.done({
							response:
								`${visible}\n` +
								buildQuizPanelMarker(retryQuestions, retryKind) +
								scopeMarker +
								buildQuizScoreMarker(0),
							citations: [],
							mode: 'compose',
							intent: 'quiz_answer',
							reference: quizRef,
							latencyMs: 0
						});
						return;
					}
					// Options degraded — chat turn-by-turn fallback.
					const first = retryQuestions[0];
					const hint = await formulateQuizProgressFooter(
						retryLang,
						1,
						retryQuestions.length,
						activeLlm
					);
					const visible = `**1/${retryQuestions.length}** ${first.q}` + (hint ? `\n\n${hint}` : '');
					const scopeMarker =
						retryScope && quizKindMarksReadiness(retryKind) ? buildQuizScopeMarker(retryScope) : '';
					for (const word of visible.split(/(\s+)/)) emit.token(word);
					emit.done({
						response:
							`${visible}\n` +
							buildQuizMarker(1, retryQuestions, retryKind) +
							scopeMarker +
							buildQuizScoreMarker(0),
						citations: [],
						mode: 'compose',
						intent: 'quiz_answer',
						reference: quizRef,
						latencyMs: 0
					});
					return;
				}
				// Regeneration failed — fall through without leaving a sticky retry.
				emit.trace?.({
					type: 'route',
					path: 'QR',
					reason: 'quiz retry regenerate failed — fall through'
				});
			}
			// decline / other / failed regenerate → continue normal routing
		}

		// -----------------------------------------------------------------------
		// Path R (reply): context-readiness gate offer pending from the last turn.
		// Accept → start a scoped context quiz (Path Q takes over from Q1).
		// Decline / ignore → opt-out marker (never nag again) + proceed.
		// -----------------------------------------------------------------------
		const pendingGate = extractPendingReadinessGate(historyForClassify);
		if (pendingGate && !checkItemClick) {
			const gateLang = extractLang(historyForClassify) ?? effectiveLang;
			const gateScope: ReadinessScope = {
				level: pendingGate.level,
				book: pendingGate.book,
				chapter: pendingGate.chapter
			};
			const gateReply = interpretReadinessGateReply(
				message,
				{ isAffirmative: ctx.isAffirmative, isNegative: ctx.isNegative },
				isAffirmativeMessage
			);
			emit.trace?.({
				type: 'route',
				path: 'R',
				reason: `readiness gate reply "${gateReply}" (${pendingGate.level}:${pendingGate.book}${pendingGate.chapter ? ':' + pendingGate.chapter : ''})`
			});

			let gateQuizFailed = false;
			if (gateReply === 'accept') {
				emit.status(getStatusText(gateLang, 'thinking'));
				emit.thinking?.('Context quiz', 'working');
				const quizRef =
					pendingGate.level === 'book'
						? pendingGate.book
						: `${pendingGate.book} ${pendingGate.chapter}`;
				const gateCtx = await fetchBookContext(callTool, quizRef, gateLang, 4000);
				const gateNotes = gateCtx.notes
					.map((n, i) => ({
						id: typeof n.id === 'string' && n.id.trim() ? n.id : `intro-${i}`,
						text: extractContextNoteText(n)
					}))
					.filter((n) => n.text.length > 0);
				const gateBundle = {
					scriptures: [],
					notes: gateNotes,
					tw: [],
					ta: [],
					questions: []
				} as unknown as EnrichedBundle;
				const gateQuestions =
					gateNotes.length > 0 ? await generateQuiz(gateBundle, quizRef, gateLang, activeLlm) : [];
				emit.thinking?.('Context quiz', 'done');

				if (gateQuestions.length >= 3) {
					// Interactive quiz in the resources panel (multiple choice).
					// When the panel component is available, chat ONLY refers the user
					// to the panel — no question text in chat, and the panel-mode
					// marker carries the answer key without hijacking chat turns.
					const gatePanel = buildQuizPanelComponent(quizRef, gateQuestions, gateScope);
					if (gatePanel) {
						emit.ui(gatePanel);
						const visible = await formulateQuizPanelReferral(gateLang, activeLlm);
						for (const word of visible.split(/(\s+)/)) emit.token(word);
						emit.done({
							response:
								`${visible}\n` +
								buildQuizPanelMarker(gateQuestions, 'context') +
								buildQuizScopeMarker(gateScope) +
								buildQuizScoreMarker(0),
							citations: [],
							mode: 'compose',
							intent: 'quiz_answer',
							reference: quizRef,
							latencyMs: 0
						});
						return;
					}
					// No panel component (options degraded to open-ended) — chat
					// turn-by-turn fallback.
					const first = gateQuestions[0];
					const hint = await formulateQuizProgressFooter(
						gateLang,
						1,
						gateQuestions.length,
						activeLlm
					);
					const visible = `**1/${gateQuestions.length}** ${first.q}` + (hint ? `\n\n${hint}` : '');
					for (const word of visible.split(/(\s+)/)) emit.token(word);
					emit.done({
						response:
							`${visible}\n` +
							buildQuizMarker(1, gateQuestions, 'context') +
							buildQuizScopeMarker(gateScope) +
							buildQuizScoreMarker(0),
						citations: [],
						mode: 'compose',
						intent: 'quiz_answer',
						reference: quizRef,
						latencyMs: 0
					});
					return;
				}
				// Quiz generation failed — degrade gracefully: opt this scope out so
				// the user is not repeatedly nagged by a gate that cannot deliver.
				gateQuizFailed = true;
			}

			// Decline, ignore, or failed accept → opt-out marker; never nag again.
			extraDoneMarkers.push(buildReadinessOptOutMarker(gateScope));

			if (gateReply !== 'other' || gateQuizFailed) {
				// Pure yes/no reply carries no new request — resume the pending action.
				// Whole-chapter pending refs use panel-first chapter orientation (not
				// the heavy overview dump).
				if (isWholeChapterReference(pendingGate.pendingRef)) {
					emit.trace?.({
						type: 'route',
						path: 'B-ch',
						reason: `readiness gate resume → chapter orientation (${pendingGate.pendingRef})`
					});
					await runChapterOrientation({
						callTool,
						llm: activeLlm,
						emit,
						reference: pendingGate.pendingRef,
						language: gateLang,
						panelState
					});
					return;
				}
				emit.status(getStatusText(gateLang, 'loading'));
				const harness = new ContextHarness(activeLlm, callTool);
				// Let the harness see the opt-out immediately so its own quiz-offer
				// footer stays suppressed on the resumed response.
				const historyWithOptOut = [
					...historyForClassify,
					{ role: 'assistant' as const, content: buildReadinessOptOutMarker(gateScope) }
				];
				const result = await harness.run(pendingGate.pendingRef, {
					language: gateLang,
					targetLanguage: targetLang,
					workflowMode: activeWorkflowMode,
					studyContext,
					conversationHistory: historyWithOptOut,
					emit: {
						status: (s) => emit.status(s),
						token: (d) => emit.token(d),
						thinking: (l, s) => emit.thinking(l, s),
						ui: (c) => emit.ui(c),
						trace: (ev) => emit.trace?.(ev)
					}
				});
				if (result.effectiveLanguage && result.effectiveLanguage !== gateLang) {
					emit.meta({ setSourceLanguage: result.effectiveLanguage });
				}
				emit.done({
					response: result.response,
					citations: result.citations,
					reference: result.reference,
					mode: result.mode,
					dataWarning: result.dataWarning,
					intent: result.intent,
					nextBatch: result.nextBatch,
					challenges: result.challenges,
					toolCalls: result.toolCalls,
					latencyMs: 0
				});
				return;
			}
			// "other": the user asked for something else — fall through and route
			// their message normally; the opt-out marker rides along on the reply.
		}

		// -----------------------------------------------------------------------
		// Path QO: on-demand quiz — user asks for a quiz/practice check, or
		// accepts a coach QUIZOFFER. Panel-first; no READY unless kind=context.
		// Runs after gate/retry handling so readiness paths stay authoritative.
		// -----------------------------------------------------------------------
		if (!checkItemClick && !quizSubmit) {
			const activeQuiz = extractQuizFromHistory(historyForClassify);
			const onDemand = detectOnDemandQuizIntent({
				message,
				studyRef,
				reference: intentResult.reference ?? studyRef ?? null,
				history: historyForClassify,
				isAffirmative: ctx.isAffirmative,
				hasActiveQuiz: Boolean(activeQuiz)
			});
			if (onDemand) {
				const qoLang = extractLang(historyForClassify) ?? effectiveLang;
				const quizRef = onDemand.quizRef;
				const quizKind = onDemand.kind;
				// When book/chapter readiness is already settled, force practice
				// so a fresh on-demand intro quiz cannot re-emit READY.
				const settledScope = quizScopeForReference(quizRef);
				const readinessState = deriveReadiness(historyForClassify);
				const alreadySettled = settledScope
					? settledScope.level === 'book'
						? isBookSettled(readinessState, settledScope.book)
						: isChapterSettled(readinessState, settledScope.book, settledScope.chapter!)
					: false;
				const effectiveKind: QuizKind =
					quizKind === 'context' && alreadySettled ? 'practice' : quizKind;
				const effectiveSource =
					onDemand.source === 'passage' || /:\d/.test(quizRef) ? 'passage' : 'context';

				emit.trace?.({
					type: 'route',
					path: 'QO',
					reason: `on-demand quiz ${effectiveKind}/${effectiveSource} for ${quizRef}${onDemand.fromOfferAccept ? ' (offer accept)' : ''}`
				});
				emit.status(getStatusText(qoLang, 'thinking'));
				emit.thinking?.('Context quiz', 'working');

				let notes: Array<{
					id: string;
					text: string;
					quote?: string;
					verse?: string;
				}> = [];
				if (effectiveSource === 'passage') {
					notes = await fetchPassageNotesForQuiz(callTool, quizRef, qoLang);
				} else {
					const ctxNotes = await fetchBookContext(callTool, quizRef, qoLang, 4000);
					notes = ctxNotes.notes
						.map((n, i) => ({
							id: typeof n.id === 'string' && n.id.trim() ? n.id : `intro-${i}`,
							text: extractContextNoteText(n)
						}))
						.filter((n) => n.text.length > 0);
				}

				const bundle = {
					scriptures: [],
					notes,
					tw: [],
					ta: [],
					questions: []
				} as unknown as EnrichedBundle;
				const questions =
					notes.length > 0 ? await generateQuiz(bundle, quizRef, qoLang, activeLlm) : [];
				emit.thinking?.('Context quiz', 'done');

				if (questions.length >= 3) {
					const scope = readinessScopeForQuizKind(effectiveKind, quizRef);
					const panel = buildQuizPanelComponent(quizRef, questions, scope);
					if (panel) {
						emit.ui(panel);
						const visible = await formulateQuizPanelReferral(qoLang, activeLlm);
						for (const word of visible.split(/(\s+)/)) emit.token(word);
						const scopeMarker =
							scope && quizKindMarksReadiness(effectiveKind) ? buildQuizScopeMarker(scope) : '';
						emit.done({
							response:
								`${visible}\n` +
								buildQuizPanelMarker(questions, effectiveKind) +
								scopeMarker +
								buildQuizScoreMarker(0),
							citations: [],
							mode: 'compose',
							intent: 'quiz_answer',
							reference: quizRef,
							latencyMs: 0
						});
						return;
					}
					// Chat turn-by-turn fallback when panel options are unavailable.
					const first = questions[0];
					const hint = await formulateQuizProgressFooter(qoLang, 1, questions.length, activeLlm);
					const visible = `**1/${questions.length}** ${first.q}` + (hint ? `\n\n${hint}` : '');
					const scopeMarker =
						scope && quizKindMarksReadiness(effectiveKind) ? buildQuizScopeMarker(scope) : '';
					for (const word of visible.split(/(\s+)/)) emit.token(word);
					emit.done({
						response:
							`${visible}\n` +
							buildQuizMarker(1, questions, effectiveKind) +
							scopeMarker +
							buildQuizScoreMarker(0),
						citations: [],
						mode: 'compose',
						intent: 'quiz_answer',
						reference: quizRef,
						latencyMs: 0
					});
					return;
				}
				emit.trace?.({
					type: 'route',
					path: 'QO',
					reason: 'on-demand quiz generation failed — fall through'
				});
			}
		}

		// -----------------------------------------------------------------------
		// Path L: Spoken-language mismatch — LLM detects writing language ≠ UI language
		// and asks whether to switch (no hardcoded language word lists).
		// -----------------------------------------------------------------------
		const awaitingSwitch = extractAwaitingLangSwitch(history);
		if (awaitingSwitch) {
			emit.trace?.({
				type: 'route',
				path: 'L',
				reason: `awaiting language switch reply for ${awaitingSwitch.code}`
			});

			if (ctx.isAffirmative) {
				emit.status(getStatusText(effectiveLang, 'searching'));
				const langList = await fetchLanguageList(callTool);
				const resolvedCode =
					(await resolveAndUpgradeLanguage(activeLlm, awaitingSwitch.code, langList)) ??
					(await resolveAndUpgradeLanguage(activeLlm, message, langList));

				if (resolvedCode) {
					emit.meta({ setLanguage: resolvedCode });

					// If the original mismatched message also had a passage, resume it now.
					if (awaitingSwitch.pendingRef) {
						emit.status(getStatusText(resolvedCode, 'loading'));
						const harness = new ContextHarness(activeLlm, callTool);
						const harnessHistory = historyForClassify.filter(
							(m) => !(m.role === 'assistant' && m.content.includes('<!-- AWAITING_LANG_SWITCH:'))
						);
						// Spoken-language switch updates conversation/source language.
						emit.meta({ setSourceLanguage: resolvedCode });
						const result = await harness.run(awaitingSwitch.pendingRef, {
							language: resolvedCode,
							targetLanguage: targetLang,
							workflowMode: activeWorkflowMode,
							studyContext,
							conversationHistory: harnessHistory,
							emit: {
								status: (s) => emit.status(s),
								token: (d) => emit.token(d),
								thinking: (l, s) => emit.thinking(l, s),
								ui: (c) => emit.ui(c),
								trace: (ev) => emit.trace?.(ev)
							}
						});
						if (result.effectiveLanguage && result.effectiveLanguage !== resolvedCode) {
							emit.meta({ setSourceLanguage: result.effectiveLanguage });
						}
						emit.done({
							response: result.response + '\n' + buildLangMarker(resolvedCode),
							citations: result.citations,
							reference: result.reference,
							mode: result.mode,
							dataWarning: result.dataWarning,
							intent: result.intent,
							nextBatch: result.nextBatch,
							challenges: result.challenges,
							latencyMs: 0
						});
						return;
					}

					const confirm =
						(await generateLangSwitchConfirm(activeLlm, resolvedCode, false)) ||
						`Got it — study language set to ${resolvedCode}.`;
					emit.token(confirm);
					emit.done({
						response: confirm + '\n' + buildLangMarker(resolvedCode),
						citations: [],
						mode: 'compose',
						latencyMs: 0
					});
					return;
				}
				// Could not resolve — fall through and re-ask via mismatch detection below
			} else if (ctx.isNegative) {
				const decline =
					(await generateLangSwitchConfirm(activeLlm, effectiveLang, true)) ||
					'Okay — keeping the current study language.';
				emit.token(decline);
				emit.done({
					response: decline + '\n<!-- LANG_SWITCH_DECLINED -->',
					citations: [],
					mode: 'compose',
					latencyMs: 0
				});
				return;
			}
			// Neither yes nor no (e.g. new request) — continue without switching.
		} else if (
			intentResult.intent !== 'language_answer' &&
			// Deterministic panel clicks (checklist items) are not typed speech —
			// never interrupt them with a language-switch ask.
			!checkItemClick &&
			// Don't ask to switch language for checklist/batch triggers like "next"
			// (kept as English keywords in localized footers on purpose).
			intentResult.intent !== 'checklist_step' &&
			// Don't interrupt an active context quiz with a language-switch ask.
			intentResult.intent !== 'quiz_answer' &&
			intentResult.intent !== 'quiz_skip' &&
			!intentResult.continuationRef &&
			!ctx.isContinuation &&
			!intentResult.pendingRef &&
			!hasRecentLangSwitchDecline(history)
		) {
			const spoken = await detectSpokenLanguage(activeLlm, message, effectiveLang);
			if (spoken.mismatches && spoken.spokenCode) {
				emit.trace?.({
					type: 'route',
					path: 'L',
					reason: `spoken ${spoken.spokenCode} mismatches UI ${effectiveLang}`
				});
				const ask =
					(await generateLangSwitchAsk(
						activeLlm,
						message,
						effectiveLang,
						spoken.spokenCode,
						history
					)) ||
					`You're writing in a different language than the selected study language (${effectiveLang}). Switch to ${spoken.spokenCode}?`;
				emit.token(ask);
				emit.done({
					response:
						ask +
						'\n' +
						buildLangSwitchMarker(
							spoken.spokenCode,
							intentResult.reference ?? undefined,
							intentResult.intent
						),
					citations: [],
					mode: 'compose',
					latencyMs: 0
				});
				return;
			}
		}

		// 1a. Immediate acknowledgment — after contextual enrichment so it uses the correct intent.
		immediateAck(emit, intentResult.intent, intentResult.reference, effectiveLang);

		// Emit intent trace
		emit.trace?.({ type: 'intent', result: intentResult, ms: Date.now() - traceStart });

		// -----------------------------------------------------------------------
		// Path A: Language answer — user replied to the language-gate prompt
		// -----------------------------------------------------------------------
		if (intentResult.intent === 'language_answer' && intentResult.pendingRef) {
			emit.trace?.({ type: 'route', path: 'A', reason: 'language_answer intent with pendingRef' });
			const { pendingRef, pendingIntent } = intentResult;

			// Fetch language list to resolve the user's reply
			emit.status(getStatusText(effectiveLang, 'searching'));
			let langList: LanguageOption[] = [];
			try {
				const raw = (await callTool('list_languages', {})) as
					| { languages?: LanguageOption[] }
					| LanguageOption[];
				langList = Array.isArray(raw)
					? raw
					: ((raw as { languages?: LanguageOption[] }).languages ?? []);
			} catch {
				// Continue with empty list — we'll still try to match
			}

			// Resolve order: exact heuristic → LLM → affirmative-default fallback
			let resolvedCode =
				resolveLanguage(message, langList) ??
				(await resolveLanguageLLM(activeLlm, message, langList));

			if (!resolvedCode) {
				// Last resort: if LLM classified this as an affirmative and we have a
				// suggested default (profile source or resolved source), treat it as
				// "go with what you have". profile.language is no longer used here —
				// it may hold the neutral "my language" receptor placeholder.
				const suggestedDefault = profile?.sourceLanguage ?? effectiveLang;
				if (ctx.isAffirmative && suggestedDefault) {
					resolvedCode = suggestedDefault;
				}
			}

			if (!resolvedCode) {
				// Could not resolve — re-ask
				const clarifyText = `I wasn't sure which language that is. Could you type the language name (like "Spanish") or its code (like "es" or "es-419")?`;
				emit.token(clarifyText);
				// Keep AWAITING_LANG + PENDING_PASSAGE markers alive
				const markers = buildPendingMarkers(pendingRef, pendingIntent ?? 'annotated_passage');
				emit.done({
					response: clarifyText + '\n' + markers,
					citations: [],
					mode: 'compose',
					latencyMs: 0
				});
				return;
			}

			// Resolve variant upfront: if the code is a base (no hyphen) and a known
			// variant exists in the language list, upgrade it now so every subsequent
			// tool call passes the exact variant (e.g. "es" → "es-419") and the
			// server-side fallback is never needed during this session.
			if (!resolvedCode.includes('-') && langList.length > 0) {
				const prefix = resolvedCode + '-';
				const variant = langList.find((l) => (l.code ?? '').startsWith(prefix))?.code;
				if (variant) resolvedCode = variant;
			}

			// Name already captured by resolveContextual above (no regex needed)

			// Language now known — run the harness directly.
			emit.status(getStatusText(effectiveLang, 'loading'));
			{
				const harness = new ContextHarness(activeLlm, callTool);
				// Strip the lang-gate assistant turn from history before calling the harness.
				// That turn contains <!-- AWAITING_LANG --> which would make classifyIntent
				// return 'language_answer' for pendingRef, causing selectResources to return
				// an empty initialFetches plan and the response to come from training-only.
				const harnessHistory = (
					history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
				).filter((m) => !(m.role === 'assistant' && m.content.includes('<!-- AWAITING_LANG -->')));
				// Use pendingRef as the synthetic message so the harness classifies it
				// as an annotated_passage / passage intent with the correct reference.
				// Gate asks for the SOURCE language — the answer sets source; the
				// receptor target stays whatever the profile had (usually neutral).
				const answerPair = resolveLanguagePair({
					sourceLanguage: resolvedCode,
					targetLanguage: profile?.targetLanguage
				});
				emit.meta({
					setLanguage: answerPair.targetLanguage,
					setSourceLanguage: answerPair.sourceLanguage
				});
				const result = await harness.run(pendingRef, {
					language: answerPair.sourceLanguage,
					targetLanguage: answerPair.targetLanguage,
					workflowMode: activeWorkflowMode,
					studyContext,
					conversationHistory: harnessHistory,
					emit: {
						status: (s) => emit.status(s),
						token: (d) => emit.token(d),
						thinking: (l, s) => emit.thinking(l, s),
						ui: (c) => emit.ui(c),
						trace: (ev) => emit.trace?.(ev)
					}
				});

				if (result.effectiveLanguage && result.effectiveLanguage !== answerPair.sourceLanguage) {
					emit.meta({ setSourceLanguage: result.effectiveLanguage });
				}

				emit.done({
					response: result.response,
					citations: result.citations,
					reference: result.reference,
					mode: result.mode,
					dataWarning: result.dataWarning,
					intent: result.intent,
					nextBatch: result.nextBatch,
					challenges: result.challenges,
					drillIndex: result.drillIndex,
					totalChallenges: result.totalChallenges,
					toolCalls: result.toolCalls,
					latencyMs: 0
				});
			}
			return;
		}

		// -----------------------------------------------------------------------
		// Path D: Language gate — ask for language before warming
		// -----------------------------------------------------------------------
		const langInHistory = extractLang(
			history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
		);
		// Language is "known" when any of these apply:
		//   a) a <!-- LANG:code --> marker was confirmed during THIS conversation
		//   b) the user's profile already has a language set (from a prior session)
		//   c) the UI dropdown has ANY non-empty selection, including the default 'en'
		//      (English is a perfectly valid working language — no need to ask)
		// We intentionally no longer require the language to be non-default:
		// if the user starts asking about a passage without changing the dropdown,
		// we assume the current selection (even 'en') and proceed immediately.
		const langPreset = language.trim().length > 0;
		const langKnown =
			!!langInHistory || !!profile?.sourceLanguage || !!profile?.language || langPreset;

		// Fire the language gate for ANY message that contains a passage reference,
		// regardless of intent. This covers both passage-specific intents AND
		// open-ended questions that mention a reference (e.g. "Can you help me
		// with John 3:16?"). The intent check is deliberately omitted here so that
		// indirect phrasings don't silently bypass the gate.
		if (!langKnown && intentResult.reference) {
			emit.trace?.({
				type: 'route',
				path: 'D',
				reason: 'reference found but language unknown — language gate'
			});
			// Language list is not fetched here — the user knows their own language.
			// (list_languages is still called in Path A when the user answers, to validate.)

			// Use the explicit dropdown language as the suggestion hint.
			// profile.language is intentionally NOT used here: it may be stale from a
			// previous session and not visible in the UI dropdown, which would cause the
			// LLM to suggest a code (e.g. "te") that contradicts what the user sees.
			const suggestedDefault = language;
			// Do NOT instruct "say go ahead" — that creates a clunky two-step confirmation.
			// Just let the user name any language and we resolve it automatically.
			const defaultHint = suggestedDefault
				? ` If they seem unsure, mention ${suggestedDefault} as a common choice.`
				: '';

			// Let the LLM ask the question in whatever language the user is using.
			const langGateSystem = [
				`${nameSnippet}You are Ezer, a Bible translation helper (your name means "helper" in Hebrew).`,
				`The user has asked about ${intentResult.reference}.`,
				`You need to know their SOURCE language — the language they will be translating FROM: the language of their source Bible and helps resources, and the language you will speak with them. NEVER ask which language they are translating INTO (the target); you do not need it.`,
				`Ask, in plain words and a single short sentence (max 20 words), which language they will be translating from (their source Bible and resources).`,
				defaultHint,
				`Match the language of the user's last message. No markdown.`
			].join(' ');

			const langGateChunks: string[] = [];
			if (activeLlm.generateStream) {
				for await (const delta of activeLlm.generateStream(
					[
						{ role: 'system', content: langGateSystem },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 60 }
				)) {
					emit.token(delta);
					langGateChunks.push(delta);
				}
			} else {
				const t = await activeLlm.generate(
					[
						{ role: 'system', content: langGateSystem },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 60 }
				);
				emit.token(t);
				langGateChunks.push(t);
			}

			const langGateText = langGateChunks.join('');

			// Name invite is handled separately in a later turn — don't bundle it here.
			const nameMarker = !hasNameInvited(
				history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
			)
				? '\n' + buildNameInvitedMarker()
				: '';
			const pendingMarkers =
				'\n' + buildPendingMarkers(intentResult.reference, intentResult.intent);

			emit.meta({ awaitingLanguage: true });
			emit.done({
				response: langGateText + nameMarker + pendingMarkers,
				citations: [],
				mode: 'compose',
				latencyMs: 0
			});
			return;
		}

		const resolvedLang = langInHistory ?? effectiveLang;

		// Background cache-warming: fire-and-forget get_passage so caches are warm
		// before the full pipeline fetches the same data. No confirmation asked.
		if (intentResult.reference) {
			emit.trace?.({ type: 'warm', reference: intentResult.reference, language: resolvedLang });
			const warmPromise = callTool('get_passage', {
				reference: intentResult.reference,
				language: resolvedLang
			}).catch(() => {});
			if (waitUntil) waitUntil(warmPromise);
		}

		// -----------------------------------------------------------------------
		// Path R (offer): context-readiness soft gate at advancement points —
		// chapter drill (book readiness), section/verse pick (chapter readiness),
		// explicit Translate switch. ONE question; declining/ignoring opts out.
		// -----------------------------------------------------------------------
		if (!checkItemClick) {
			const readinessGate = detectReadinessGate({
				intent: intentResult.intent,
				reference: intentResult.reference,
				continuationRef: intentResult.continuationRef,
				explicitModeSwitch: intentMode ?? clarifyAnswerMode,
				workflowMode: activeWorkflowMode,
				history: historyForClassify,
				studyRef,
				studyContext
			});
			if (readinessGate) {
				emit.trace?.({
					type: 'route',
					path: 'R',
					reason: `readiness gate offer ${readinessGate.level}:${readinessGate.book}${readinessGate.chapter ? ':' + readinessGate.chapter : ''} (pending ${readinessGate.pendingRef})`
				});
				const gateQuestion = await formulateReadinessGateQuestion(
					readinessGate.level,
					resolvedLang,
					activeLlm
				);
				for (const word of gateQuestion.split(/(\s+)/)) emit.token(word);
				emit.done({
					response: `${gateQuestion}\n${buildReadinessGateMarker(readinessGate)}`,
					citations: [],
					mode: 'compose',
					intent: 'readiness_gate',
					reference: readinessGate.pendingRef,
					latencyMs: 0
				});
				return;
			}
		}

		// -----------------------------------------------------------------------
		// Path B: Book orientation — user named a whole book (no chapter/verse)
		// -----------------------------------------------------------------------
		// Fetch book intro via get_passage_context, emit passage_context for the
		// resources panel, then coach panel-first next steps (no intro dump in chat).
		// Also re-runs when a study session is already open but the user named a
		// whole book again (or studyRef is book-only) so the panel is not left empty.
		if (
			!intentResult.reference &&
			ctx.extractedBook &&
			ctx.extractedChapter == null &&
			ctx.extractedVerse == null
		) {
			const bookCode = resolveBookToUsfm(ctx.extractedBook);
			const studyParts = parseStudyRefParts(studyRef);
			const shouldOrient =
				!!bookCode &&
				(!activePassage ||
					!studyParts?.book ||
					studyParts.book !== bookCode ||
					studyParts.chapter == null);
			if (bookCode && shouldOrient) {
				const orientRef = bookCode;
				emit.trace?.({
					type: 'route',
					path: 'B',
					reason: `bare book mention → orient with get_passage_context (${orientRef})`
				});
				emit.status(getStatusText(effectiveLang, 'loading'));

				const bookCtx = await fetchBookContext(callTool, orientRef, effectiveLang, 10000);
				const emitted = emitBookContextNotes(emit, orientRef, bookCtx);
				emitContextPanelFocus(
					emit,
					bookCtx.notes.map((n) => ({
						id: n.id,
						scope: n.scope === 'book' || String(n.chapter ?? '') === 'front' ? 'book' : 'chapter'
					}))
				);
				const notes = bookCtx.notes;
				const contextGuidance = bookContextPromptGuidance(bookCtx, effectiveLang);

				const bookLabel = ctx.extractedBook;
				const nameCtx = profile?.name
					? `The user goes by "${profile.name}". Use that name when it feels natural.`
					: '';

				const systemMsg = [
					`You are Ezer — a Bible translation consultant. Consult with CANA questions; do not dump notes or grade unknown receptor-language form.`,
					nameCtx,
					pairGuidance,
					`Always reply in the source/conversation language (${effectiveLang}).`,
					`The user wants to work on the book of ${bookLabel} (${orientRef}).`,
					`Pedagogy: resources appear in the translation helps panel beside the chat — point there first; get familiar with book context, then chapter 1 verse by verse; invite drafts in Mi traducción when ready. Do not ask them to paste their receptor draft.`,
					contextGuidance,
					emitted
						? `Context notes are in the panel now — do not retell the intro.`
						: `Panel could not load intro notes — do not invent background.`,
					`Reply in 2 short sentences max, then ONE next-step question.`,
					`Do not use markdown, bullet lists, or headings.`
				]
					.filter(Boolean)
					.join(' ');

				const chunks: string[] = [];
				if (activeLlm.generateStream) {
					for await (const delta of activeLlm.generateStream(
						[
							{ role: 'system', content: systemMsg },
							...historyForClassify,
							{ role: 'user', content: message }
						],
						{ maxTokens: 180 }
					)) {
						emit.token(delta);
						chunks.push(delta);
					}
				} else {
					const text = await activeLlm.generate(
						[
							{ role: 'system', content: systemMsg },
							...historyForClassify,
							{ role: 'user', content: message }
						],
						{ maxTokens: 180 }
					);
					emit.token(text);
					chunks.push(text);
				}

				const citations =
					notes.length > 0
						? [{ path: `tn/${bookCode}/front/intro`, title: `${bookLabel} introduction` }]
						: [];

				emit.done({
					response: chunks.join(''),
					citations,
					reference: orientRef,
					mode: 'compose',
					intent: 'book_orientation',
					latencyMs: 0
				});
				return;
			}
		}

		// -----------------------------------------------------------------------
		// Path B-ch: Chapter orientation — whole chapter (book + chapter, no verse)
		// -----------------------------------------------------------------------
		// Fetch chapter intro + scripture, emit passage_context + scripture_text,
		// focus Context tab, short panel-first coach (no intro/scripture dump).
		// Re-runs when the user re-asks the same chapter (focus + short guide;
		// re-emit notes only when the panel does not already have them).
		if (
			intentResult.reference &&
			isWholeChapterReference(intentResult.reference) &&
			!isQuizRoutingIntent(intentResult.intent) &&
			!isCheckingRoutingIntent(intentResult.intent) &&
			intentResult.intent !== 'checklist_step' &&
			intentResult.intent !== 'phrase_drill' &&
			intentResult.intent !== 'word_study' &&
			intentResult.intent !== 'methodology' &&
			(intentResult.intent === 'passage_overview' ||
				intentResult.intent === 'open_ended' ||
				intentResult.intent === 'passage_help' ||
				intentResult.intent === 'annotated_passage')
		) {
			const chapterRef = intentResult.reference;
			emit.trace?.({
				type: 'route',
				path: 'B-ch',
				reason: `whole chapter → panel-first chapter orientation (${chapterRef})`
			});
			await runChapterOrientation({
				callTool,
				llm: activeLlm,
				emit,
				reference: chapterRef,
				language: resolvedLang,
				panelState
			});
			return;
		}

		// -----------------------------------------------------------------------
		// Path G: Conversational path — no Bible reference detected
		// -----------------------------------------------------------------------
		// For messages that contain no passage reference (greetings, small talk,
		// general questions), use a single direct LLM call with name context
		// rather than the full harness. The LLM decides naturally:
		//   • If it reads as a greeting → greet by name (if known) or ask for it
		//   • If it's a general question → answer briefly
		// Task-oriented questions with a reference always skip this path and go
		// to the full harness (Path F) below.
		if (
			!intentResult.reference &&
			!activePassage &&
			intentResult.intent !== 'quiz_answer' &&
			intentResult.intent !== 'quiz_skip' &&
			intentResult.intent !== 'checking'
		) {
			emit.trace?.({
				type: 'route',
				path: 'G',
				reason: 'no reference and no active passage session — conversational'
			});

			// If the user expressed a language preference (e.g. "I want to translate in Spanish"),
			// resolve it and update the dropdown before replying.
			let pathGLang = effectiveLang;
			if (ctx.extractedLanguage) {
				try {
					const langList = await callTool('list_languages', { stage: 'prod' }).then(
						(r) => (r as { languages?: Array<{ code: string; name?: string }> }).languages ?? []
					);
					const resolved = await resolveLanguageLLM(activeLlm, ctx.extractedLanguage, langList);
					if (resolved) {
						pathGLang = resolved;
						emit.meta({ setLanguage: resolved });
					}
				} catch {
					/* ignore — best effort */
				}
			}

			const nameCtx = profile?.name
				? `The user goes by "${profile.name}". Use that name when it feels natural.`
				: `You do not know what to call the user yet. If their message is a greeting or conversational opener, briefly introduce yourself as Ezer (your name means "helper" in Hebrew) and ask — in ONE combined, low-pressure question — what to call them AND which book or passage they are working on. If they only name a passage, proceed without insisting on a name.`;

			const langHint =
				ctx.extractedLanguage && pathGLang !== effectiveLang
					? `The user wants to work in ${ctx.extractedLanguage} (set to ${pathGLang}). Confirm that and ask which Bible passage they'd like to start with.`
					: '';

			const systemMsg = [
				`You are Ezer — a Bible translation consultant (your name means "helper" in Hebrew). You guide translators with CANA questions; you do not lecture, dump notes, or rewrite their draft.`,
				nameCtx,
				langHint,
				pairGuidance,
				`Language lock: Always reply in the source/conversation language (${pathGLang}). Target/receptor language is metadata only — never switch into it because the user pasted target text.`,
				`Reply in 2–3 short sentences max. Do not use markdown.`,
				`End with exactly ONE consultant question (what's hard, which passage, or invite a draft in Mi traducción). Never ask "How did you translate X?" — when probing their wording, ask what the word they chose means in their language. Never instruct them to type a keyword (like "next" or "skip").`,
				`If the user asks what you do, explain you consult translators through any Bible passage — pointing them to resources and helping them examine their own choices, not writing the translation for them.`,
				`When the user names a Bible book or passage, ask which one (if unclear) and say you will load context into the resources panel — do NOT invent or dump book background (author, outline, themes) from memory.`
			]
				.filter(Boolean)
				.join(' ');

			const chunks: string[] = [];
			if (activeLlm.generateStream) {
				for await (const delta of activeLlm.generateStream(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 120 }
				)) {
					emit.token(delta);
					chunks.push(delta);
				}
			} else {
				const text = await activeLlm.generate(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 120 }
				);
				emit.token(text);
				chunks.push(text);
			}

			// Name persistence handled earlier by resolveContextual (no regex needed here)

			emit.done({ response: chunks.join(''), citations: [], mode: 'compose', latencyMs: 0 });
			return;
		}

		// -----------------------------------------------------------------------
		// Path Q: Interactive context quiz — one question at a time.
		// Must run before Path C / G+ so affirmatives and answers aren't stolen.
		// -----------------------------------------------------------------------
		if (
			(intentResult.intent === 'quiz_answer' || intentResult.intent === 'quiz_skip') &&
			intentResult.quizQuestions &&
			intentResult.quizQuestions.length > 0
		) {
			const questions = intentResult.quizQuestions;
			const total = intentResult.quizTotal ?? questions.length;
			const idx = intentResult.quizIndex ?? 0;

			emit.trace?.({
				type: 'route',
				path: 'Q',
				reason:
					intentResult.intent === 'quiz_skip'
						? `quiz_skip at ${idx}/${total}`
						: `quiz_answer at ${idx}/${total}`
			});
			emit.status(getStatusText(resolvedLang, 'thinking'));

			const streamText = async (text: string) => {
				// Tokenize locally — response is already composed.
				const words = text.split(/(\s+)/);
				for (const word of words) emit.token(word);
			};

			if (intentResult.intent === 'quiz_skip') {
				// Compound refuse+request ("omitir… y revisar la nota sobre fe"):
				// clear quiz session, then honor the residual intent on this turn.
				if (hasQuizFollowOnRequest(message)) {
					clearQuizOnResponse = true;
					// Classify the residual request (quiz opt-out phrasing stripped)
					// so "omitir… y muéstrame el artículo sobre siervo" → word_study.
					const residualMsg = stripQuizOptOutPhrases(message) || message;
					const residual = classifyIntent(residualMsg);
					intentResult = {
						...residual,
						// Keep high confidence when residual found a real intent;
						// otherwise stay open_ended so Path G+/harness can help.
						confidence: residual.confidence === 'low' ? 'medium' : residual.confidence
					};
					emit.trace?.({
						type: 'route',
						path: 'Q',
						reason: `quiz_skip with follow-on → ${intentResult.intent}`
					});
					// Fall through to normal routing with quiz cleared on response.
				} else {
					const skipped = await formulateQuizSkippedMessage(resolvedLang, activeLlm);
					const text = `${skipped}\n${buildQuizClearedMarker()}`;
					await streamText(skipped);
					emit.done({
						response: text,
						citations: [],
						mode: 'compose',
						intent: 'quiz_skip',
						latencyMs: 0
					});
					return;
				}
			} else {
				// Start quiz (offer accepted at idx 0) → panel when available,
				// otherwise ask question 1 in chat.
				if (idx === 0) {
					// Interactive quiz in the resources panel (scope rode along with
					// the QUIZ:0 offer via QUIZSCOPE).
					const offerScope = extractQuizScopeFromHistory(historyForClassify);
					const scopeRef = offerScope
						? offerScope.level === 'book'
							? offerScope.book
							: `${offerScope.book} ${offerScope.chapter}`
						: null;
					// quizMode "panel" = a panel quiz is already pending and the user
					// explicitly asked to do it in chat — go turn-by-turn, don't
					// re-refer them to the panel.
					const wantsChatQuiz = intentResult.quizMode === 'panel';
					const offerPanel = wantsChatQuiz
						? null
						: buildQuizPanelComponent(
								intentResult.reference ?? scopeRef ?? studyRef ?? '',
								questions,
								offerScope
							);
					if (offerPanel) {
						// Chat ONLY refers to the panel — no question text in chat; the
						// panel-mode marker carries the answer key without turning later
						// chat messages into Path Q answers.
						emit.ui(offerPanel);
						const visible = await formulateQuizPanelReferral(resolvedLang, activeLlm);
						await streamText(visible);
						const offerKind: QuizKind = intentResult.quizKind ?? 'context';
						emit.done({
							response: `${visible}\n${buildQuizPanelMarker(questions, offerKind)}${buildQuizScoreMarker(0)}`,
							citations: [],
							mode: 'compose',
							intent: 'quiz_answer',
							latencyMs: 0
						});
						return;
					}
					const first = questions[0];
					const hint = await formulateQuizProgressFooter(resolvedLang, 1, total, activeLlm);
					const offerKind: QuizKind = intentResult.quizKind ?? 'context';
					const text =
						`**1/${total}** ${first.q}` +
						(hint ? `\n\n${hint}` : '') +
						`\n${buildQuizMarker(1, questions, offerKind)}${buildQuizScoreMarker(0)}`;
					await streamText(text);
					emit.done({
						response: text,
						citations: [],
						mode: 'compose',
						intent: 'quiz_answer',
						latencyMs: 0
					});
					return;
				}

				// Grade the answer for question `idx` (1-based).
				// On the final question, fold the wrap-up into the same grade LLM call.
				const current = questions[idx - 1] ?? questions[questions.length - 1];
				const isFinal = idx >= total;
				emit.thinking?.('Grading', 'working');
				const grade = await gradeAnswer(current.q, current.a, message, resolvedLang, activeLlm, {
					isFinal
				});
				emit.thinking?.('Grading', 'done');

				// Running correct-answer count (majority correct ⇒ readiness on completion).
				const quizScore =
					extractQuizScoreFromHistory(historyForClassify) + (grade.verdict === 'correct' ? 1 : 0);

				if (isFinal) {
					// Quiz complete — majority correct marks book/chapter readiness for
					// the scope recorded when the quiz started (gate accept or offer).
					// On-demand passage/practice kinds never emit READY.
					// Wrap-up is already inside grade.feedback (folded); only append
					// the fallback complete message if the grade path omitted a closer.
					const quizKind: QuizKind = intentResult.quizKind ?? 'context';
					const quizScope = quizKindMarksReadiness(quizKind)
						? extractQuizScopeFromHistory(historyForClassify)
						: null;
					const readyMarker =
						quizScope && isQuizPass(quizScore, total) ? buildReadyMarker(quizScope) : '';
					let visible = grade.feedback;
					// Safety net only — gradeAnswer already folds wrap-up / appends sync fallback.
					if (!/[？?]\s*$/.test(visible.replace(/<!--[\s\S]*?-->/g, '').trim())) {
						visible = `${visible}\n\n${fallbackQuizCompleteMessage(resolvedLang)}`;
					}
					const text = `${visible}\n${readyMarker}${buildQuizClearedMarker()}`;
					await streamText(visible);
					emit.done({
						response: text,
						citations: [],
						mode: 'compose',
						intent: 'quiz_answer',
						latencyMs: 0
					});
					return;
				}

				const nextIdx = idx + 1;
				const next = questions[nextIdx - 1];
				const hint = await formulateQuizProgressFooter(resolvedLang, nextIdx, total, activeLlm);
				const text =
					`${grade.feedback}\n\n**${nextIdx}/${total}** ${next.q}` +
					(hint ? `\n\n${hint}` : '') +
					`\n${buildQuizMarker(nextIdx, questions)}${buildQuizScoreMarker(quizScore)}`;
				await streamText(text);
				emit.done({
					response: text,
					citations: [],
					mode: 'compose',
					intent: 'quiz_answer',
					latencyMs: 0
				});
				return;
			}
		}

		// -----------------------------------------------------------------------
		// Path C: Checklist step — "next" / "paso N" with an active checklist footer.
		// Must run before Path G+ (which would otherwise treat these as open chat).
		// -----------------------------------------------------------------------
		if (intentResult.intent === 'checklist_step' && intentResult.nextStep != null) {
			emit.trace?.({
				type: 'route',
				path: 'C',
				reason: `checklist_step ${intentResult.nextStep}/${intentResult.totalSteps}`
			});
			emit.status(getStatusText(resolvedLang, 'thinking'));
			const harness = new ContextHarness(activeLlm, callTool);
			// Prefer a message classifyIntent recognizes for the target step.
			const checklistMessage =
				/\b(?:paso|step|étape)\s*\d{1,2}\b/i.test(message.trim()) || isContinuationMessage(message)
					? message
					: `paso ${intentResult.nextStep}`;
			const result = await harness.run(checklistMessage, {
				language: resolvedLang,
				targetLanguage: targetLang,
				workflowMode: activeWorkflowMode,
				studyContext,
				conversationHistory: history as Array<{
					role: 'user' | 'assistant' | 'system';
					content: string;
				}>,
				emit: {
					status: (s) => emit.status(s),
					token: (d) => emit.token(d),
					thinking: (l, s) => emit.thinking(l, s),
					ui: (c) => emit.ui(c),
					trace: (ev) => emit.trace?.(ev)
				}
			});
			emit.done({
				response: result.response,
				citations: result.citations,
				reference: result.reference,
				mode: result.mode,
				dataWarning: result.dataWarning,
				intent: result.intent,
				toolCalls: result.toolCalls,
				latencyMs: 0
			});
			return;
		}

		// -----------------------------------------------------------------------
		// Path G+: Active session continuation — no new reference but an active
		// passage/phrase-drill session exists.
		//
		// Two sub-cases:
		//   A. SHORT AFFIRMATIVE / SOCIAL ("Sí", "yes", "claro", "ok", "gracias")
		//      → plain LLM call with history; no tool calls needed.
		//   B. QUESTION / CONCEPT INQUIRY ("¿Qué es una personificación?",
		//      "¿A qué se refiere con X?", "explícame más", etc.)
		//      → route through the harness so agenticFallback can call MCP tools
		//        (e.g. get_academy_article, get_note with phrase) and cite resources.
		// -----------------------------------------------------------------------
		if (!intentResult.reference) {
			// Use the isAffirmative / isContinuation signals already resolved by
			// resolveContextual() (LLM call, runs above for messages ≤ 120 chars).
			// If neither flag is set, treat the message as a substantive inquiry and
			// route through the harness so MCP tools can be called.
			//
			// For messages > 120 chars ctx defaults to {false, false, null} so they
			// always hit the harness — appropriate since long messages are virtually
			// always substantive questions or requests, not brief social replies.
			//
			// Knowledge-seeking intents (word_study, methodology, open_ended, checking)
			// always route through the harness regardless of affirmative/continuation
			// signals — the LLM classifier in resolveContextual can misfire for these
			// (e.g. "What does grace mean?" could be miscategorised as affirmative).
			const KNOWLEDGE_INTENTS = new Set(['word_study', 'methodology', 'open_ended', 'checking']);
			const msgTrimmed = message.trim();
			const isQuestion =
				KNOWLEDGE_INTENTS.has(intentResult.intent) ||
				msgTrimmed.includes('?') ||
				msgTrimmed.includes('¿') ||
				(!ctx.isAffirmative && !ctx.isContinuation);

			if (isQuestion) {
				emit.trace?.({
					type: 'route',
					path: 'G+',
					reason: 'active session, question/knowledge intent'
				});
				// Route through harness so MCP tools can be called.
				// agenticFallback now receives conversation history (fix applied above).
				emit.status(getStatusText(resolvedLang, 'searching'));
				const harness = new ContextHarness(activeLlm, callTool);
				// Do NOT append "Active passage…" for word_study / methodology —
				// extractReferenceInfo would steal intent into annotated_passage.
				const knowledgeNoPassageFooter = new Set(['word_study', 'methodology']);
				const harnessMessage =
					studyRef &&
					!knowledgeNoPassageFooter.has(intentResult.intent) &&
					!/\b[A-Z0-9]{2,3}\s+\d+:\d+\b/i.test(message)
						? `${message}\n\nActive passage in study session: ${studyRef}`
						: message;
				// If Path Q just cleared a quiz for a follow-on request, inject the
				// cleared marker so harness classifyIntent does not re-enter quiz_skip.
				const historyForHarness = clearQuizOnResponse
					? [
							...(history as Array<{
								role: 'user' | 'assistant' | 'system';
								content: string;
							}>),
							{ role: 'assistant' as const, content: buildQuizClearedMarker() }
						]
					: (history as Array<{
							role: 'user' | 'assistant' | 'system';
							content: string;
						}>);
				const result = await harness.run(harnessMessage, {
					language: resolvedLang,
					targetLanguage: targetLang,
					workflowMode: activeWorkflowMode,
					studyContext,
					conversationHistory: historyForHarness,
					emit: {
						status: (s) => emit.status(s),
						token: (d) => emit.token(d),
						thinking: (l, s) => emit.thinking(l, s),
						ui: (c) => emit.ui(c),
						trace: (ev) => emit.trace?.(ev)
					}
				});
				if (result.effectiveLanguage && result.effectiveLanguage !== effectiveLang) {
					emit.meta({ setSourceLanguage: result.effectiveLanguage });
				}
				emit.done({
					response: result.response,
					citations: result.citations,
					reference: result.reference,
					mode: result.mode,
					dataWarning: result.dataWarning,
					intent: result.intent,
					toolCalls: result.toolCalls,
					latencyMs: 0
				});
				return;
			}

			// Short affirmative / social continuation → plain LLM, no tools needed
			emit.trace?.({
				type: 'route',
				path: 'G+',
				reason: 'active session, short affirmative/social'
			});
			const nameCtx = profile?.name
				? `The user goes by "${profile.name}". Use that name when it feels natural.`
				: '';
			const systemMsg = [
				nameCtx,
				`You are Ezer, a Bible translation consultant (your name means "helper" in Hebrew).`,
				`You are in an active translation session. The user's message is a brief reply or continuation.`,
				`Read the conversation history to understand what was last discussed and continue naturally as a consultant.`,
				`Do NOT greet the user, do NOT start a new topic, do NOT ask what passage they want.`,
				`If the user affirmed something, continue the topic with ONE consultant question (what's hard / next decision / invite a draft in Mi traducción). Never ask "How did you translate X?" — in checking, ask what the word they chose means in their language. If they thanked you, acknowledge briefly.`,
				`Never ask for their receptor draft, rewrite it, claim it "sounds right", or praise/grade receptor wording they paste. Source-language gloss only if they explicitly ask.`,
				`Language lock: Always reply in the source/conversation language (${effectiveLang}). Target language is metadata only.`,
				pairGuidance
			]
				.filter(Boolean)
				.join(' ');

			const chunks: string[] = [];
			if (activeLlm.generateStream) {
				for await (const delta of activeLlm.generateStream(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 300 }
				)) {
					emit.token(delta);
					chunks.push(delta);
				}
			} else {
				const text = await activeLlm.generate(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 300 }
				);
				emit.token(text);
				chunks.push(text);
			}

			emit.done({ response: chunks.join(''), citations: [], mode: 'compose', latencyMs: 0 });
			return;
		}

		// -----------------------------------------------------------------------
		// Path F: Full pipeline (no gate needed or non-passage intent)
		// -----------------------------------------------------------------------
		emit.trace?.({
			type: 'route',
			path: 'F',
			reason: 'full pipeline — reference present, language known'
		});
		emit.status(getStatusText(effectiveLang, 'thinking'));
		const harness = new ContextHarness(activeLlm, callTool);
		// Relative refs like "chapter 1" / "verse 1" need an explicit Passage hint
		// so ContextHarness.classifyIntent sees a parseable reference.
		// Plain "Passage: REF" (no brackets) so extractReferenceInfo can parse the
		// USFM code — a trailing "]" on "TIT 1]" previously broke chapter loads.
		const pathFMessage = composedPassageHint
			? `${message}\n\nPassage: ${composedPassageHint}`
			: message;
		const result = await harness.run(pathFMessage, {
			language: resolvedLang,
			targetLanguage: targetLang,
			workflowMode: activeWorkflowMode,
			studyContext,
			conversationHistory: history as Array<{
				role: 'user' | 'assistant' | 'system';
				content: string;
			}>,
			emit: {
				status: (s) => emit.status(s),
				token: (d) => emit.token(d),
				thinking: (l, s) => emit.thinking(l, s),
				ui: (c) => emit.ui(c),
				trace: (ev) => emit.trace?.(ev)
			}
		});

		// Surface resource-language variant upgrade (e.g. "es" → "es-419")
		if (result.effectiveLanguage && result.effectiveLanguage !== effectiveLang) {
			emit.meta({ setSourceLanguage: result.effectiveLanguage });
		}

		emit.done({
			response: result.response,
			citations: result.citations,
			reference: result.reference,
			mode: result.mode,
			dataWarning: result.dataWarning,
			intent: result.intent,
			nextBatch: result.nextBatch,
			challenges: result.challenges,
			drillIndex: result.drillIndex,
			totalChallenges: result.totalChallenges,
			toolCalls: result.toolCalls,
			latencyMs: 0
		});
	} catch (err) {
		emit.error(err instanceof Error ? err.message : String(err));
	}
}
