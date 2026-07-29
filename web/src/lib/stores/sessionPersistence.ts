/**
 * Browser session persistence for "continue where you left off".
 *
 * Stores a capped, sanitized chat transcript + study-session subset in
 * localStorage under `th_session`. Trace/debug data is never persisted.
 */

import type {
	ChatScope,
	StudyEvent,
	StudySession,
	ThreadMessage
} from '$lib/stores/studySession.js';

export const SESSION_KEY = 'th_session';

/** Soft cap — leave headroom under typical ~5 MB localStorage quotas. */
const MAX_BYTES = 1_500_000;
const MAX_MESSAGES = 40;
/** Keep uiComponents on the most recent N assistant turns when shrinking. */
const KEEP_UI_ASSISTANT = 6;

export interface PersistedMessage {
	role: 'user' | 'assistant';
	content: string;
	citations?: { path: string; title?: string }[];
	reference?: string;
	mode?: string;
	dataWarning?: string;
	latencyMs?: number;
	model?: string;
	intent?: string;
	nextBatch?: string;
	challenges?: unknown[];
	drillIndex?: number;
	totalChallenges?: number;
	toolCalls?: unknown[];
	uiComponents?: unknown[];
	agent?: 'guide' | 'scholar' | 'checker';
	actionChip?: boolean;
}

export interface PersistedStudy {
	reference: string | null;
	language: string;
	sourceLanguage?: string;
	targetLanguage?: string;
	explored: number[];
	recentEvents: StudyEvent[];
	scope: ChatScope;
	resourceThreads: Record<string, ThreadMessage[]>;
	/** Study | Translate | Check */
	workflowMode?: string;
}

export interface PersistedSession {
	v: 1;
	savedAt: number;
	messages: PersistedMessage[];
	study: PersistedStudy;
}

function byteLength(json: string): number {
	return new TextEncoder().encode(json).length;
}

function studyFromSession(study: StudySession): PersistedStudy {
	return {
		reference: study.reference,
		language: study.language,
		sourceLanguage: study.sourceLanguage,
		targetLanguage: study.targetLanguage,
		explored: [...study.explored],
		recentEvents: study.recentEvents.slice(-20),
		scope: study.scope,
		resourceThreads: study.resourceThreads ?? {},
		workflowMode: study.workflowMode
	};
}

function sanitizeMessage(msg: Record<string, unknown>): PersistedMessage | null {
	const role = msg.role;
	if (role !== 'user' && role !== 'assistant') return null;
	const content = typeof msg.content === 'string' ? msg.content : '';
	const out: PersistedMessage = { role, content };

	if (Array.isArray(msg.citations)) {
		out.citations = msg.citations as PersistedMessage['citations'];
	}
	if (typeof msg.reference === 'string') out.reference = msg.reference;
	if (typeof msg.mode === 'string') out.mode = msg.mode;
	if (typeof msg.dataWarning === 'string') out.dataWarning = msg.dataWarning;
	if (typeof msg.latencyMs === 'number') out.latencyMs = msg.latencyMs;
	if (typeof msg.model === 'string') out.model = msg.model;
	if (typeof msg.intent === 'string') out.intent = msg.intent;
	if (typeof msg.nextBatch === 'string') out.nextBatch = msg.nextBatch;
	if (Array.isArray(msg.challenges)) out.challenges = msg.challenges;
	if (typeof msg.drillIndex === 'number') out.drillIndex = msg.drillIndex;
	if (typeof msg.totalChallenges === 'number') out.totalChallenges = msg.totalChallenges;
	if (Array.isArray(msg.toolCalls)) out.toolCalls = msg.toolCalls;
	if (Array.isArray(msg.uiComponents)) out.uiComponents = msg.uiComponents;
	if (msg.agent === 'guide' || msg.agent === 'scholar' || msg.agent === 'checker') {
		out.agent = msg.agent;
	}
	if (msg.actionChip === true) out.actionChip = true;

	// Intentionally omit traceEvents (debug-only, large).
	return out;
}

function stripUiFromOlderAssistants(
	messages: PersistedMessage[],
	keepLast: number
): PersistedMessage[] {
	let remaining = keepLast;
	const result = [...messages];
	for (let i = result.length - 1; i >= 0; i--) {
		const m = result[i];
		if (m.role !== 'assistant' || !m.uiComponents?.length) continue;
		if (remaining > 0) {
			remaining--;
			continue;
		}
		const { uiComponents: _drop, ...rest } = m;
		result[i] = rest;
	}
	return result;
}

function buildPayload(messages: PersistedMessage[], study: PersistedStudy): string {
	const session: PersistedSession = {
		v: 1,
		savedAt: Date.now(),
		messages,
		study
	};
	return JSON.stringify(session);
}

/**
 * Persist a capped, sanitized session snapshot.
 * Returns true when something was written (or intentionally cleared as empty).
 */
export function saveSession(
	rawMessages: Array<Record<string, unknown>>,
	study: StudySession
): boolean {
	if (typeof localStorage === 'undefined') return false;

	let messages = rawMessages
		.map((m) => sanitizeMessage(m))
		.filter((m): m is PersistedMessage => m !== null);

	if (messages.length === 0) {
		clearSession();
		return true;
	}

	if (messages.length > MAX_MESSAGES) {
		messages = messages.slice(-MAX_MESSAGES);
	}

	const studySnap = studyFromSession(study);
	let json = buildPayload(messages, studySnap);

	if (byteLength(json) > MAX_BYTES) {
		messages = stripUiFromOlderAssistants(messages, KEEP_UI_ASSISTANT);
		json = buildPayload(messages, studySnap);
	}

	while (byteLength(json) > MAX_BYTES && messages.length > 2) {
		messages = messages.slice(1);
		json = buildPayload(messages, studySnap);
	}

	try {
		localStorage.setItem(SESSION_KEY, json);
		return true;
	} catch {
		// Quota exceeded — try a minimal salvage (no uiComponents at all).
		try {
			messages = messages.map(
				({ uiComponents: _u, challenges: _c, toolCalls: _t, ...rest }) => rest
			);
			json = buildPayload(messages.slice(-10), studySnap);
			localStorage.setItem(SESSION_KEY, json);
			return true;
		} catch {
			return false;
		}
	}
}

export function loadSession(): PersistedSession | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<PersistedSession>;
		if (parsed.v !== 1) return null;
		if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
		if (!parsed.study || typeof parsed.study !== 'object') return null;
		const study = parsed.study as PersistedStudy;
		if (typeof study.language !== 'string') return null;
		return {
			v: 1,
			savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
			messages: parsed.messages as PersistedMessage[],
			study
		};
	} catch {
		return null;
	}
}

export function clearSession(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(SESSION_KEY);
	} catch {
		/* ignore */
	}
}
