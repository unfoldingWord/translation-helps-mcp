import type { GuidedStepId } from './hashState';

/** A tool call the walk makes, the same shape the Tools tab takes. */
export type Call = { tool: string; args: Record<string, unknown> };

/** One row of the map of helps: a note, an Academy topic or a key term the person can open. */
export type MapRow = {
	kind: 'note' | 'academy' | 'word';
	key: string;
	label: string;
	quote?: { original: string; aligned: string };
};

/** The server's own passage workflow (see the tool descriptions), plus the first pick. */
export const GUIDED_STEPS: { id: GuidedStepId; title: string; tool: string | null }[] = [
	{ id: 'pick', title: 'Pick a passage', tool: null },
	{ id: 'text', title: 'Text', tool: 'get_passage' },
	{ id: 'context', title: 'Context', tool: 'get_passage_context' },
	{ id: 'map', title: 'Map of helps', tool: 'get_passage_index' },
	// The tool depends on the row the person opens: get_note, get_academy_article or get_word_article.
	{ id: 'deeper', title: 'Go deeper', tool: null },
	{ id: 'check', title: 'Check', tool: 'get_questions' }
];

export const EXAMPLES = ['John 3:16', 'Ruth 1:1-5', 'Titus 1:1'];

/** The call a step makes. Null for `pick` (no call) and `deeper` (see `deeperCall`). */
export function stepCall(step: GuidedStepId, lang: string, ref: string): Call | null {
	const tool = GUIDED_STEPS.find((s) => s.id === step)?.tool;
	if (!tool) return null;
	return { tool, args: { reference: ref, language: lang } };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): Record<string, unknown>[] =>
	Array.isArray(v) ? v.filter(isRecord) : [];

/**
 * The rows of a `get_passage_index` answer (its structuredContent): notes by `id`,
 * Academy topics from `issues[]` and key terms from `keyTerms[]`, both by `path`.
 * Anything that is not an index gives no rows.
 */
export function mapRows(index: unknown): MapRow[] {
	if (!isRecord(index)) return [];
	const rows: MapRow[] = [];
	const seen = new Set<string>();
	const add = (row: MapRow) => {
		const id = `${row.kind}:${row.key}`;
		if (seen.has(id)) return;
		seen.add(id);
		rows.push(row);
	};

	for (const n of list(index.notes)) {
		const key = text(n.id);
		if (!key) continue;
		const ta = isRecord(n.taArticle) ? n.taArticle : null;
		const row: MapRow = { kind: 'note', key, label: text(ta?.title) || 'Note' };
		if (isRecord(n.quote)) {
			const original = text(n.quote.original);
			const aligned = text(n.quote.aligned);
			if (original || aligned) row.quote = { original, aligned };
		}
		add(row);
	}
	for (const [kind, source] of [
		['academy', index.issues],
		['word', index.keyTerms]
	] as const) {
		for (const item of list(source)) {
			const key = text(item.path);
			if (!key) continue;
			const title = text(item.title) || key;
			const count = typeof item.count === 'number' ? ` (${item.count})` : '';
			add({ kind, key, label: `${title}${count}` });
		}
	}
	return rows;
}

/**
 * The call that opens a row. `get_note` also needs the passage: it looks the id up
 * among that passage's notes. The other two take the article path.
 */
export function deeperCall(
	row: { kind: MapRow['kind']; key: string },
	lang: string,
	ref: string
): Call {
	switch (row.kind) {
		case 'note':
			return { tool: 'get_note', args: { reference: ref, language: lang, id: row.key } };
		case 'academy':
			return { tool: 'get_academy_article', args: { path: row.key, language: lang } };
		case 'word':
			return { tool: 'get_word_article', args: { path: row.key, language: lang } };
	}
}

/**
 * The step after (delta 1) or before (delta -1) this one. `canGoDeeper` is false when
 * the map has nothing to open, and then the walk skips `deeper` both ways.
 */
export function nextStep(step: GuidedStepId, delta: 1 | -1, canGoDeeper: boolean): GuidedStepId {
	const ids = GUIDED_STEPS.map((s) => s.id).filter((id) => canGoDeeper || id !== 'deeper');
	const at = ids.indexOf(step);
	// On `deeper` with nothing to open, step from where it would have been.
	const from = at === -1 ? ids.indexOf('map') + (delta === 1 ? 0 : 1) : at;
	return ids[Math.min(ids.length - 1, Math.max(0, from + delta))];
}

/**
 * Number each call; only the latest one may show its answer. An answer that comes
 * back after a newer call started (a double click, a quick step change) is dropped.
 */
export function latestOnly(): { next(): number; isLatest(n: number): boolean } {
	let latest = 0;
	return {
		next: () => ++latest,
		isLatest: (n) => n === latest
	};
}
