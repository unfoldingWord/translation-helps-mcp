import { writable, get } from 'svelte/store';
import { resolveLanguagePair } from '$core/harness/languagePair.js';
import {
	DEFAULT_WORKFLOW_MODE,
	parseWorkflowMode,
	type WorkflowMode
} from '$core/harness/workflowMode.js';

export type { WorkflowMode };

export interface ChallengeItem {
	index: number;
	verse: string;
	phrase: string;
	noteText: string;
	rawNoteText?: string;
	rawQuote?: string;
	category: string;
	sourceType?: 'tn' | 'tw';
	supportReference?: string;
	wordPath?: string;
	at?: string;
}

export type SelectionKind = 'challenge' | 'word' | 'note' | null;

export interface StudySelection {
	kind: SelectionKind;
	challenge?: ChallengeItem;
	wordPath?: string;
	noteId?: string;
}

export interface StudyEvent {
	ts: number;
	kind: SelectionKind | ResourceKind;
	label: string;
}

export type ResourceKind = 'challenge' | 'note' | 'word' | 'verse' | 'question' | 'article';

export interface ResourcePayload {
	kind: ResourceKind;
	challenge?: ChallengeItem;
	note?: {
		id: string;
		quote?: string;
		noteText: string;
		verse?: string;
		supportReference?: string;
	};
	word?: { term: string; path?: string; definition?: string; verse?: string; origWords?: string };
	verse?: { reference: string; text: string };
	question?: { id: string; question: string; response?: string; verse?: string };
	/** Translation Academy article (rc://…/ta/man/… chip click). */
	article?: { path: string; title?: string };
}

export type ChatScope =
	| { kind: 'global' }
	| { kind: 'resource'; key: string; label: string; resource: ResourcePayload };

export interface ThreadMessage {
	role: 'user' | 'assistant';
	content: string;
	streaming?: boolean;
}

export interface StudySession {
	reference: string | null;
	/**
	 * Legacy single field — treated as target/receptor when source/target unset.
	 * Prefer `sourceLanguage` + `targetLanguage`.
	 */
	language: string;
	/** Door43 resources + coach conversation language. */
	sourceLanguage: string;
	/** Receptor label only ("translating into X"). */
	targetLanguage: string;
	selection: StudySelection | null;
	explored: number[];
	recentEvents: StudyEvent[];
	scope: ChatScope;
	resourceThreads: Record<string, ThreadMessage[]>;
	/** Study | Translate | Check — coach + panel emphasis. */
	workflowMode: WorkflowMode;
	/** When true, TurnResources should expand and scroll to the Check section. */
	openCheck?: boolean;
}

const INITIAL: StudySession = {
	reference: null,
	language: 'en',
	sourceLanguage: 'en',
	targetLanguage: 'en',
	selection: null,
	explored: [],
	recentEvents: [],
	scope: { kind: 'global' },
	resourceThreads: {},
	workflowMode: DEFAULT_WORKFLOW_MODE,
	openCheck: false
};

export const studySession = writable<StudySession>({ ...INITIAL, resourceThreads: {} });

export function resourceKey(payload: ResourcePayload): string {
	switch (payload.kind) {
		case 'challenge':
			return `challenge:${payload.challenge?.index ?? 0}`;
		case 'note':
			return `note:${payload.note?.id ?? 'unknown'}`;
		case 'word':
			return `word:${payload.word?.path || payload.word?.term || 'unknown'}`;
		case 'verse':
			return `verse:${payload.verse?.reference ?? 'unknown'}`;
		case 'question':
			return `question:${payload.question?.id ?? 'unknown'}`;
		case 'article':
			return `article:${payload.article?.path ?? 'unknown'}`;
		default:
			return 'unknown';
	}
}

export function resourceLabel(payload: ResourcePayload): string {
	switch (payload.kind) {
		case 'challenge': {
			const c = payload.challenge;
			if (!c) return 'Challenge';
			return `Challenge #${c.index} — "${c.phrase}"`;
		}
		case 'note': {
			const n = payload.note;
			if (!n) return 'Note';
			const quote = n.quote ? `"${n.quote.slice(0, 40)}${n.quote.length > 40 ? '…' : ''}"` : n.id;
			return `Note — ${quote}`;
		}
		case 'word': {
			const w = payload.word;
			return w ? `Word — ${w.term}` : 'Word';
		}
		case 'verse': {
			const v = payload.verse;
			return v ? `Verse — ${v.reference}` : 'Verse';
		}
		case 'question': {
			const q = payload.question;
			if (!q) return 'Question';
			const short = q.question.slice(0, 40) + (q.question.length > 40 ? '…' : '');
			return `Question — ${short}`;
		}
		case 'article': {
			const a = payload.article;
			if (!a) return 'Article';
			return `Article — ${a.title || a.path}`;
		}
		default:
			return 'Resource';
	}
}

export function setScope(scope: ChatScope): void {
	studySession.update((s) => ({ ...s, scope }));
}

export function clearScope(): void {
	studySession.update((s) => ({
		...s,
		scope: { kind: 'global' },
		selection: null
	}));
}

export function selectResource(payload: ResourcePayload): void {
	const key = resourceKey(payload);
	const label = resourceLabel(payload);

	studySession.update((s) => {
		let explored = s.explored;
		let selection: StudySelection | null = s.selection;

		if (payload.kind === 'challenge' && payload.challenge) {
			const c = payload.challenge;
			explored = explored.includes(c.index) ? explored : [...explored, c.index];
			selection = { kind: 'challenge', challenge: c };
		} else if (payload.kind === 'note' && payload.note) {
			selection = { kind: 'note', noteId: payload.note.id };
		} else if (payload.kind === 'word' && payload.word) {
			selection = { kind: 'word', wordPath: payload.word.path };
		} else {
			selection = null;
		}

		const ev: StudyEvent = {
			ts: Date.now(),
			kind: payload.kind,
			label
		};

		return {
			...s,
			selection,
			explored,
			scope: { kind: 'resource', key, label, resource: payload },
			recentEvents: [...s.recentEvents.slice(-9), ev]
		};
	});
}

export function appendToThread(key: string, msg: ThreadMessage): void {
	studySession.update((s) => {
		const existing = s.resourceThreads[key] ?? [];
		return {
			...s,
			resourceThreads: {
				...s.resourceThreads,
				[key]: [...existing, msg]
			}
		};
	});
}

export function updateLastThreadMessage(key: string, content: string, streaming?: boolean): void {
	studySession.update((s) => {
		const thread = s.resourceThreads[key];
		if (!thread || thread.length === 0) return s;
		const updated = [...thread];
		const last = updated[updated.length - 1];
		updated[updated.length - 1] = {
			...last,
			content,
			...(streaming !== undefined ? { streaming } : {})
		};
		return {
			...s,
			resourceThreads: {
				...s.resourceThreads,
				[key]: updated
			}
		};
	});
}

export function getThread(key: string): ThreadMessage[] {
	return get(studySession).resourceThreads[key] ?? [];
}

export function threadMessageCount(key: string): number {
	return getThread(key).length;
}

export function resetSession(): void {
	studySession.set({ ...INITIAL, resourceThreads: {} });
}

/** Serializable subset used by browser session persistence. */
export type PersistedStudySubset = Pick<
	StudySession,
	| 'reference'
	| 'language'
	| 'sourceLanguage'
	| 'targetLanguage'
	| 'explored'
	| 'recentEvents'
	| 'scope'
	| 'resourceThreads'
	| 'workflowMode'
>;

/**
 * Restore study state from a persisted snapshot (e.g. after page reload).
 * Leaves openCheck false; validates scope/resourceThreads loosely.
 */
export function hydrateSession(partial: Partial<PersistedStudySubset>): void {
	const scope: ChatScope =
		partial.scope?.kind === 'resource' &&
		typeof partial.scope.key === 'string' &&
		typeof partial.scope.label === 'string' &&
		partial.scope.resource
			? partial.scope
			: { kind: 'global' };

	const resourceThreads =
		partial.resourceThreads && typeof partial.resourceThreads === 'object'
			? partial.resourceThreads
			: {};

	const legacyLang =
		typeof partial.language === 'string' && partial.language ? partial.language : 'en';
	const pair = resolveLanguagePair({
		language: legacyLang,
		sourceLanguage: typeof partial.sourceLanguage === 'string' ? partial.sourceLanguage : undefined,
		targetLanguage: typeof partial.targetLanguage === 'string' ? partial.targetLanguage : undefined
	});

	studySession.set({
		reference: typeof partial.reference === 'string' ? partial.reference : null,
		language: pair.targetLanguage,
		sourceLanguage: pair.sourceLanguage,
		targetLanguage: pair.targetLanguage,
		selection: null,
		explored: Array.isArray(partial.explored)
			? partial.explored.filter((n): n is number => typeof n === 'number')
			: [],
		recentEvents: Array.isArray(partial.recentEvents) ? partial.recentEvents : [],
		scope,
		resourceThreads,
		workflowMode: parseWorkflowMode(partial.workflowMode),
		openCheck: false
	});
}

/** Set Study | Translate | Check without touching passage state. */
export function setWorkflowMode(mode: WorkflowMode): void {
	studySession.update((s) => ({
		...s,
		workflowMode: parseWorkflowMode(mode)
	}));
}

export function requestOpenCheck(): void {
	studySession.update((s) => ({ ...s, openCheck: true }));
}

export function clearOpenCheck(): void {
	studySession.update((s) => ({ ...s, openCheck: false }));
}

export function selectChallenge(challenge: ChallengeItem) {
	selectResource({ kind: 'challenge', challenge });
}

export function clearSelection() {
	clearScope();
}

export function setPassage(
	reference: string,
	languageOrPair: string | { sourceLanguage?: string; targetLanguage?: string; language?: string }
) {
	studySession.update((s) => {
		const samePassage = s.reference === reference;
		const pair =
			typeof languageOrPair === 'string'
				? resolveLanguagePair({
						sourceLanguage: s.sourceLanguage,
						targetLanguage: languageOrPair || s.targetLanguage,
						language: languageOrPair
					})
				: resolveLanguagePair({
						sourceLanguage: languageOrPair.sourceLanguage ?? s.sourceLanguage,
						targetLanguage: languageOrPair.targetLanguage ?? s.targetLanguage,
						language: languageOrPair.language ?? s.language
					});
		return {
			...s,
			reference,
			language: pair.targetLanguage,
			sourceLanguage: pair.sourceLanguage,
			targetLanguage: pair.targetLanguage,
			selection: samePassage ? s.selection : null,
			explored: samePassage ? s.explored : [],
			recentEvents: samePassage ? s.recentEvents : [],
			scope: samePassage ? s.scope : { kind: 'global' as const },
			resourceThreads: samePassage ? s.resourceThreads : {},
			workflowMode: s.workflowMode,
			openCheck: samePassage ? s.openCheck : false
		};
	});
}

/** Apply source/target languages without changing the loaded passage. */
export function setLanguagePair(input: {
	sourceLanguage?: string;
	targetLanguage?: string;
	language?: string;
}) {
	studySession.update((s) => {
		const pair = resolveLanguagePair({
			sourceLanguage: input.sourceLanguage ?? s.sourceLanguage,
			targetLanguage: input.targetLanguage ?? s.targetLanguage,
			language: input.language ?? s.language
		});
		return {
			...s,
			language: pair.targetLanguage,
			sourceLanguage: pair.sourceLanguage,
			targetLanguage: pair.targetLanguage
		};
	});
}

export function contextSnapshot(): string {
	const s = get(studySession);
	const parts: string[] = [];
	parts.push(`Workflow mode: ${s.workflowMode}`);
	if (s.reference) {
		parts.push(
			`Loaded passage: ${s.reference} (source/conversation: ${s.sourceLanguage}; receptor target: ${s.targetLanguage})`
		);
	} else {
		parts.push(
			`Languages — source/conversation: ${s.sourceLanguage}; receptor target: ${s.targetLanguage}`
		);
	}
	if (s.scope.kind === 'resource') {
		parts.push(`Currently scoped to: ${s.scope.label}`);
	} else if (s.selection?.kind === 'challenge' && s.selection.challenge) {
		const c = s.selection.challenge;
		parts.push(`Currently viewing: challenge #${c.index} — "${c.phrase}" (${c.category})`);
	}
	if (s.explored.length > 0) parts.push(`Explored challenge indices: ${s.explored.join(', ')}`);
	if (s.recentEvents.length > 0) {
		const recent = s.recentEvents
			.slice(-3)
			.map((e) => e.label)
			.join(', ');
		parts.push(`Recent selections: ${recent}`);
	}
	return parts.join('\n');
}
