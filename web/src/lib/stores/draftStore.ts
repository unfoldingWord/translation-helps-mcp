/**
 * Browser draft workspace store — persists translator drafts under `th_drafts`.
 * Independent from chat session (`th_session`).
 */

import { writable, get, derived } from 'svelte/store';
import {
	DRAFTS_STORAGE_KEY,
	DRAFTS_VERSION,
	emptyDraftStore,
	parseDraftStore,
	segmentFromReference,
	assembleDrafts,
	formatAssembledDrafts,
	outlineSegments,
	listSegments,
	scopeFromReferenceLoose,
	detectDraftRecallIntent,
	resolveDraftBinding,
	isDraftableMeta,
	isDraftableRef,
	assertDraftableSegment,
	metaFromSegmentKey,
	DRAFT_RECALL_INTENT,
	isDraftRecallMessage,
	redactDraftRecallForOutbound,
	type DraftSegment,
	type DraftStoreData,
	type DraftRecallScope
} from '$core/drafts/draftModel.js';
import { detectDraftSubmitIntent, formatDraftSubmitMessage } from '$core/harness/coachPedagogy.js';

export {
	DRAFTS_STORAGE_KEY,
	segmentFromReference,
	assembleDrafts,
	formatAssembledDrafts,
	outlineSegments,
	listSegments,
	scopeFromReferenceLoose,
	detectDraftRecallIntent,
	formatDraftSubmitMessage,
	isDraftableMeta,
	isDraftableRef,
	assertDraftableSegment,
	DRAFT_RECALL_INTENT,
	isDraftRecallMessage,
	redactDraftRecallForOutbound
};

export type { DraftSegment, DraftStoreData, DraftRecallScope };

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved';

interface DraftWorkspaceState {
	data: DraftStoreData;
	/** Segment key currently bound to the editor. */
	activeKey: string | null;
	activeReference: string | null;
	/** In-memory buffer for the active segment (may be dirty). */
	editorText: string;
	saveStatus: SaveStatus;
	/** UI: expand the docked workspace. */
	open: boolean;
	/** UI: show outline list. */
	outlineOpen: boolean;
}

const INITIAL: DraftWorkspaceState = {
	data: emptyDraftStore(),
	activeKey: null,
	activeReference: null,
	editorText: '',
	saveStatus: 'idle',
	open: true,
	outlineOpen: false
};

function loadFromStorage(): DraftStoreData {
	if (typeof localStorage === 'undefined') return emptyDraftStore();
	try {
		const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
		if (!raw) return emptyDraftStore();
		const parsed = parseDraftStore(JSON.parse(raw));
		return parsed ?? emptyDraftStore();
	} catch {
		return emptyDraftStore();
	}
}

function persist(data: DraftStoreData): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

export const draftWorkspace = writable<DraftWorkspaceState>({
	...INITIAL,
	data: emptyDraftStore()
});

/** Hydrate from localStorage (call once on client mount). */
export function hydrateDrafts(): void {
	const data = loadFromStorage();
	draftWorkspace.update((s) => ({ ...s, data }));
}

export function setDraftOpen(open: boolean): void {
	draftWorkspace.update((s) => ({ ...s, open }));
}

export function toggleDraftOpen(): void {
	draftWorkspace.update((s) => ({ ...s, open: !s.open }));
}

export function setOutlineOpen(open: boolean): void {
	draftWorkspace.update((s) => ({ ...s, outlineOpen: open }));
}

export function requestOpenDraft(): void {
	draftWorkspace.update((s) => ({ ...s, open: true }));
}

/**
 * Bind the editor to a study reference. Switches segment key and restores saved text.
 * Does not wipe other segments.
 *
 * Verse drills inside the active segment's range (e.g. asking about TIT 1:1
 * while drafting TIT 1:1-4) keep the current editor scope — the draft must not
 * disappear. When a real re-scope lands on an empty segment covered by a saved
 * parent-range draft, the editor binds to that parent draft instead of a blank.
 */
export function bindDraftReference(reference: string | null): void {
	if (!reference?.trim()) {
		flushActiveDraft();
		draftWorkspace.update((s) => ({
			...s,
			activeKey: null,
			activeReference: null,
			editorText: '',
			saveStatus: 'idle'
		}));
		return;
	}

	const state = get(draftWorkspace);
	const decision = resolveDraftBinding({
		reference,
		activeKey: state.activeKey,
		activeReference: state.activeReference,
		segments: state.data.segments
	});

	if (decision.action === 'none' || decision.action === 'keep') return;

	if (decision.action === 'same') {
		draftWorkspace.update((s) => ({ ...s, activeReference: reference }));
		return;
	}

	flushActiveDraft();

	if (decision.action === 'clear') {
		draftWorkspace.update((s) => ({
			...s,
			activeKey: null,
			activeReference: null,
			editorText: '',
			saveStatus: 'idle'
		}));
		return;
	}

	const existing = get(draftWorkspace).data.segments[decision.key];
	draftWorkspace.update((s) => ({
		...s,
		activeKey: decision.key,
		activeReference: decision.reference,
		editorText: existing?.text ?? '',
		saveStatus: existing?.text ? 'saved' : 'idle'
	}));
}

/** Jump editor to an existing segment key (outline click). */
export function openDraftSegment(key: string): void {
	const meta = metaFromSegmentKey(key);
	// Section drafts only — reject opening book/chapter-keyed segments.
	if (!isDraftableMeta(meta)) return;

	flushActiveDraft();
	const state = get(draftWorkspace);
	const existing = state.data.segments[key];
	if (!existing) return;
	draftWorkspace.update((s) => ({
		...s,
		activeKey: key,
		activeReference: existing.reference,
		editorText: existing.text,
		saveStatus: 'saved',
		open: true,
		outlineOpen: false
	}));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedClearTimer: ReturnType<typeof setTimeout> | null = null;

export function setEditorText(text: string): void {
	draftWorkspace.update((s) => ({
		...s,
		editorText: text,
		saveStatus: s.activeKey ? 'dirty' : s.saveStatus
	}));
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = null;
		flushActiveDraft();
	}, 450);
}

/** Persist the active editor buffer immediately. */
export function flushActiveDraft(): void {
	if (saveTimer) {
		clearTimeout(saveTimer);
		saveTimer = null;
	}
	const state = get(draftWorkspace);
	if (!state.activeKey) return;

	const key = state.activeKey;
	const fromRef = segmentFromReference(state.activeReference ?? '');
	const meta = fromRef ?? metaFromSegmentKey(key);
	const text = state.editorText;
	const now = Date.now();

	// Reject book/chapter-only keys — drop any in-memory buffer without persisting.
	if (!isDraftableMeta(meta)) {
		draftWorkspace.update((s) => {
			const segments = { ...s.data.segments };
			delete segments[key];
			const data: DraftStoreData = { v: DRAFTS_VERSION, segments };
			persist(data);
			return {
				...s,
				data,
				activeKey: null,
				activeReference: null,
				editorText: '',
				saveStatus: 'idle'
			};
		});
		return;
	}

	draftWorkspace.update((s) => {
		const segments = { ...s.data.segments };
		if (!text.trim()) {
			delete segments[key];
		} else {
			assertDraftableSegment(meta);
			segments[key] = {
				key,
				book: meta.book,
				chapter: meta.chapter,
				verseStart: meta.verseStart,
				verseEnd: meta.verseEnd,
				reference: fromRef?.reference ?? state.activeReference ?? key,
				text,
				updatedAt: now
			};
		}
		const data: DraftStoreData = { v: DRAFTS_VERSION, segments };
		persist(data);
		return {
			...s,
			data,
			saveStatus: text.trim() ? 'saved' : 'idle'
		};
	});

	if (savedClearTimer) clearTimeout(savedClearTimer);
	savedClearTimer = setTimeout(() => {
		draftWorkspace.update((s) => (s.saveStatus === 'saved' ? { ...s, saveStatus: 'idle' } : s));
	}, 1800);
}

/**
 * One STUDY CONTEXT line listing saved draft references, e.g.
 * "Saved drafts: TIT 1:1-4; TIT 2:1-5". Empty string when no drafts exist.
 * Lets the server skip the context-readiness gate when the user is resuming
 * existing work (draft text itself is never sent).
 */
export function draftContextLine(): string {
	const segs = listSegments(get(draftWorkspace).data.segments);
	if (segs.length === 0) return '';
	return `Saved drafts: ${segs.map((s) => s.reference).join('; ')}`;
}

export function getDraftTextForReference(reference: string): string {
	const seg = segmentFromReference(reference);
	if (!seg) return '';
	const state = get(draftWorkspace);
	if (state.activeKey === seg.key) return state.editorText;
	return state.data.segments[seg.key]?.text ?? '';
}

export function recallDraftsForReference(reference: string): {
	assembled: DraftSegment[];
	markdown: string;
	scopeLabel: string;
} {
	flushActiveDraft();
	const scope = scopeFromReferenceLoose(reference);
	const scopeLabel = reference.trim() || '—';
	if (!scope) {
		return {
			assembled: [],
			markdown: formatAssembledDrafts([], scopeLabel),
			scopeLabel
		};
	}
	const assembled = assembleDrafts(get(draftWorkspace).data.segments, scope);
	return {
		assembled,
		markdown: formatAssembledDrafts(assembled, scopeLabel),
		scopeLabel
	};
}

/** Pending coach handoff from Mi traducción / Check draft → main chat. */
export interface PendingDraftCoach {
	reference: string;
	draft: string;
	/** Preformatted user message for /api/chat (includes draft + reference). */
	message: string;
	source: 'workspace' | 'check_card' | 'chip';
}

export const pendingDraftCoach = writable<PendingDraftCoach | null>(null);

/**
 * Queue a draft for trainer coaching in the main chat.
 * Flushes autosave first. Returns false when draft/reference is empty.
 */
export function requestDraftCoachReview(opts: {
	reference: string;
	draft: string;
	/** Source / conversation language for the ready-for-check cue (not receptor). */
	language?: string;
	source?: PendingDraftCoach['source'];
}): boolean {
	const reference = opts.reference.trim();
	const draft = opts.draft.trim();
	// Require a local section draft — body is not sent to the coach.
	if (!reference || !draft || !isDraftableRef(reference)) return false;
	flushActiveDraft();
	pendingDraftCoach.set({
		reference,
		draft,
		message: formatDraftSubmitMessage({
			reference,
			language: opts.language
		}),
		source: opts.source ?? 'workspace'
	});
	return true;
}

export function consumePendingDraftCoach(): PendingDraftCoach | null {
	const pending = get(pendingDraftCoach);
	if (pending) pendingDraftCoach.set(null);
	return pending;
}

/**
 * Handle a chat message that may be a draft-recall request.
 * Returns markdown reply when handled; null when the message should go to the server.
 */
export function tryHandleDraftRecall(
	message: string,
	fallbackReference?: string | null
): string | null {
	// Draft-submit / check-draft must reach the coach, not local recall assemble.
	if (detectDraftSubmitIntent(message)) return null;

	const detected = detectDraftRecallIntent(message);
	if (!detected.matched) return null;

	const hint = detected.referenceHint || fallbackReference || get(draftWorkspace).activeReference;
	if (!hint) {
		return (
			'¿De qué pasaje quieres ver tu traducción? ' +
			'Ejemplo: «muéstrame mi traducción de Tito 1» o «recupera Tito 1:1–4».'
		);
	}
	return recallDraftsForReference(hint).markdown;
}

export const draftOutline = derived(draftWorkspace, ($s) => outlineSegments($s.data.segments));

export const draftSegmentCount = derived(
	draftWorkspace,
	($s) => listSegments($s.data.segments).length
);
