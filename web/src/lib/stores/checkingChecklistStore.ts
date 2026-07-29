/**
 * Browser store for the read-only checking checklist (`th_checklist`).
 */

import { writable, get, derived } from 'svelte/store';
import {
	CHECKLIST_STORAGE_KEY,
	emptyChecklistStore,
	parseChecklistStore,
	upsertChecklistItems,
	applyCheckMarkers,
	getPassageChecklist,
	listChecklistItems,
	checklistProgress,
	formatChecklistStudyContext,
	seedsFromResourcePayloads,
	type ChecklistStoreData,
	type UpsertSeed
} from '$core/checklist/checkingChecklist.js';

export {
	CHECKLIST_STORAGE_KEY,
	normalizePassageKey,
	parseCheckMarkers,
	formatChecklistStudyContext,
	seedsFromResourcePayloads,
	listChecklistItems,
	checklistProgress,
	groupChecklistItems
} from '$core/checklist/checkingChecklist.js';

export type {
	ChecklistItem,
	ChecklistKind,
	PassageChecklist,
	ChecklistStoreData,
	UpsertSeed
} from '$core/checklist/checkingChecklist.js';

function loadFromStorage(): ChecklistStoreData {
	if (typeof localStorage === 'undefined') return emptyChecklistStore();
	try {
		const raw = localStorage.getItem(CHECKLIST_STORAGE_KEY);
		if (!raw) return emptyChecklistStore();
		const parsed = parseChecklistStore(JSON.parse(raw));
		return parsed ?? emptyChecklistStore();
	} catch {
		return emptyChecklistStore();
	}
}

function persist(data: ChecklistStoreData): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

export const checkingChecklist = writable<ChecklistStoreData>(emptyChecklistStore());

/** Hydrate from localStorage (call once on client mount). */
export function hydrateChecklist(): void {
	checkingChecklist.set(loadFromStorage());
}

function commit(next: ChecklistStoreData): void {
	const prev = get(checkingChecklist);
	if (next === prev) return;
	checkingChecklist.set(next);
	persist(next);
}

export function upsertPassageItems(reference: string, seeds: UpsertSeed[]): void {
	if (!reference.trim() || seeds.length === 0) return;
	const next = upsertChecklistItems(get(checkingChecklist), reference, seeds);
	commit(next);
}

/** Upsert from panel TN / TW / TQ component payloads. */
export function upsertFromPanelResources(
	reference: string,
	resources: {
		notes?: Array<{
			id: string;
			quote?: string;
			gatewayQuote?: { original?: string; aligned?: string };
			noteText: string;
			verse?: string;
		}>;
		words?: Array<{
			id: string;
			term: string;
			wordPath?: string;
			verse?: string;
			definition?: string;
		}>;
		questions?: Array<{
			id: string;
			question: string;
			response?: string;
			verse?: string;
		}>;
	}
): void {
	const seeds = seedsFromResourcePayloads(resources);
	upsertPassageItems(reference, seeds);
}

/** Apply coach CHECK markers from assistant text for the active passage. */
export function applyMarkersFromText(reference: string, text: string): void {
	if (!reference.trim() || !text) return;
	const next = applyCheckMarkers(get(checkingChecklist), reference, text);
	commit(next);
}

/** Compact STUDY CONTEXT lines for the active passage checklist. */
export function checklistContextFor(reference: string | null | undefined): string {
	if (!reference?.trim()) return '';
	const passage = getPassageChecklist(get(checkingChecklist), reference);
	return formatChecklistStudyContext(passage);
}

/** Reactive view of items + progress for a reference string. */
export function checklistForReference(reference: string | null | undefined) {
	return derived(checkingChecklist, ($store) => {
		if (!reference?.trim()) {
			return { items: [], progress: { completed: 0, total: 0 }, passage: null };
		}
		const passage = getPassageChecklist($store, reference);
		return {
			passage,
			items: listChecklistItems(passage),
			progress: checklistProgress(passage)
		};
	});
}
