import type { CallResult } from '../mcp/client';

export type RenderedView =
	| { kind: 'markdown'; text: string }
	| { kind: 'json'; summary: string; json: string }
	| { kind: 'text'; text: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** The words a note covers: the aligned wording if there is one, else the original. */
function quoteOf(note: Record<string, unknown>): string {
	const gateway = note.gatewayQuote;
	if (isRecord(gateway)) {
		for (const k of ['aligned', 'original']) {
			const v = gateway[k];
			if (typeof v === 'string' && v.trim()) return v.trim();
		}
	}
	return typeof note.quote === 'string' ? note.quote.trim() : '';
}

/** get_note: each note's words as a heading, then its text. Null when these are not notes with text. */
function notesAsMarkdown(notes: unknown): string | null {
	if (!Array.isArray(notes)) return null;
	const rows = notes.filter(isRecord).filter((n) => typeof n.note === 'string');
	// The passage index also lists notes, but without their text.
	if (!rows.length) return null;
	return rows
		.map((n) => {
			const quote = quoteOf(n);
			const topic =
				typeof n.supportReferenceTitle === 'string' ? n.supportReferenceTitle.trim() : '';
			const head = [quote && `“${quote}”`, topic].filter(Boolean).join(' · ');
			return `${head ? `### ${head}\n\n` : ''}${n.note}`;
		})
		.join('\n\n---\n\n');
}

/** get_passage: one heading per version, then its text. Null when there are no versions with text. */
function versionsAsMarkdown(versions: unknown): string | null {
	if (!Array.isArray(versions)) return null;
	const rows = versions.filter(isRecord).filter((v) => typeof v.text === 'string');
	if (!rows.length) return null;
	return rows
		.map((v) => {
			const name = typeof v.resourceType === 'string' ? v.resourceType.toUpperCase() : 'Text';
			const role = typeof v.role === 'string' && v.role ? ` (${v.role})` : '';
			return `### ${name}${role}\n\n${v.text}`;
		})
		.join('\n\n');
}

/** What the Rendered tab shows for a tool answer. */
export function renderedView(result: CallResult): RenderedView {
	const s = result.structured;
	if (s) {
		// Articles carry their body as markdown in `article`; some answers use `content`.
		for (const key of ['article', 'content']) {
			if (typeof s[key] === 'string') return { kind: 'markdown', text: s[key] as string };
		}
		const notes = notesAsMarkdown(s.notes);
		if (notes !== null) return { kind: 'markdown', text: notes };
		const versions = versionsAsMarkdown(s.versions);
		if (versions !== null) return { kind: 'markdown', text: versions };
		// Text content is a one-line summary followed by the same data as JSON.
		const first = result.text.split('\n\n')[0]?.trim() ?? '';
		const summary = /^\s*[[{]/.test(first) ? '' : first;
		return { kind: 'json', summary, json: JSON.stringify(s, null, 2) };
	}
	return { kind: 'text', text: result.text };
}
