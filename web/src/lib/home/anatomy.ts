/**
 * The home page's "anatomy of a passage": John 3:16 and the helps the server
 * returns for it, one tool call each. Plain TypeScript with relative imports only:
 * the tests and `scripts/capture-home-snapshot.ts` import it too.
 */
import type { TryState } from '../try/hashState';
import type { ResourceId } from '../resources';

export type AnatomyPartId = 'text' | 'notes' | 'words' | 'questions' | 'academy';

export type AnatomyPart = {
	id: AnatomyPartId;
	title: string;
	/** The resources this part comes from. */
	resources: ResourceId[];
	/** One line on what the part is. */
	summary: string;
	call: { tool: string; args: Record<string, unknown> };
	/** The same view on the Try page. */
	tryState: TryState;
};

export const PASSAGE = { reference: 'John 3:16', language: 'en' } as const;

/** The note on "the world" (τὸν κόσμον), which points to the Academy lesson on metonymy. */
const NOTE_ID = 'uxc2';
const WORD_PATH = 'bible/kt/love';
const ACADEMY_PATH = 'translate/figs-metonymy';

const { reference, language } = PASSAGE;
const guided = (rest: Partial<TryState>): TryState => ({
	tab: 'guided',
	lang: language,
	ref: reference,
	...rest
});

/** In the order the server recommends: the text, then each help, then the questions. */
export const ANATOMY_PARTS: AnatomyPart[] = [
	{
		id: 'text',
		title: 'The text',
		resources: ['ult', 'ust'],
		summary: 'The verse in a literal and a simplified English Bible, beside the Greek.',
		call: { tool: 'get_passage', args: { reference, language } },
		tryState: guided({ step: 'text' })
	},
	{
		id: 'notes',
		title: 'Translation notes',
		resources: ['tn'],
		summary: 'A note on a hard phrase, tied to the Greek words it explains.',
		call: { tool: 'get_note', args: { reference, language, id: NOTE_ID } },
		tryState: guided({ step: 'deeper', open: { kind: 'note', key: NOTE_ID } })
	},
	{
		id: 'words',
		title: 'Key terms',
		resources: ['tw', 'twl'],
		summary: 'An article on a key term in the verse: what it means and how to say it.',
		call: { tool: 'get_word_article', args: { path: WORD_PATH, language } },
		tryState: guided({ step: 'deeper', open: { kind: 'word', key: WORD_PATH } })
	},
	{
		id: 'academy',
		title: 'Academy lesson',
		resources: ['ta'],
		summary: 'The lesson the note points to: here, how to translate a metonymy.',
		call: { tool: 'get_academy_article', args: { path: ACADEMY_PATH, language } },
		tryState: guided({ step: 'deeper', open: { kind: 'academy', key: ACADEMY_PATH } })
	},
	{
		id: 'questions',
		title: 'Checking questions',
		resources: ['tq'],
		summary: 'A question and its answer, to check that a draft says what the verse says.',
		call: { tool: 'get_questions', args: { reference, language } },
		tryState: guided({ step: 'check' })
	}
];

export type AlignmentRow = { original: string; aligned: string };

/** The saved answers: an excerpt per part, plus the hero's verse and aligned phrases. */
export type HomeSnapshot = Record<AnatomyPartId, string> & {
	alignment: AlignmentRow[];
	/** The verse in the original language and in the ULT, without the verse number. */
	verse: { original: string; translation: string };
	capturedAt: string;
	origin: string;
};

export const EXCERPT_MAX = 700;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): Record<string, unknown>[] =>
	Array.isArray(v) ? v.filter(isRecord) : [];

/** Verse text without its leading verse number ("16 For God…" → "For God…"). */
export function stripVerseNumber(text: string): string {
	return text.replace(/^\s*\d+[a-z]?\s+/, '').trim();
}

/** Cut markdown at a paragraph (or a word) so it fits in `max`, and mark the cut. */
export function clip(md: string, max = EXCERPT_MAX): string {
	const text = md.trim();
	if (text.length <= max) return text;
	const tail = '\n\n…';
	const room = max - tail.length;
	let cut = text.lastIndexOf('\n\n', room);
	if (cut < room * 0.4) cut = text.lastIndexOf(' ', room);
	if (cut <= 0) cut = room;
	// A heading with nothing under it reads as a mistake: end before it.
	const kept = text
		.slice(0, cut)
		.trimEnd()
		.replace(/(?:\n+#{1,6} [^\n]*)+$/, '');
	return kept.trimEnd() + tail;
}

/** Articles start with big headings; the card has its own title, so keep them small. */
function smallHeadings(md: string): string {
	return md.replace(/^#{1,2} /gm, '### ');
}

/**
 * The excerpt the home page shows for a part, from the tool's structuredContent.
 * An answer of another shape gives "" (the page then keeps the saved excerpt).
 */
export function excerptFrom(id: AnatomyPartId, structured: unknown): string {
	if (!isRecord(structured)) return '';
	switch (id) {
		case 'text': {
			const lines = list(structured.versions)
				.filter((v) => v.role === 'literal' || v.role === 'simplified')
				.map((v) => {
					const name = str(v.resourceType).toUpperCase();
					return `**${name}** · ${stripVerseNumber(str(v.text))}`;
				});
			return clip(lines.join('\n\n'));
		}
		case 'notes': {
			const n = list(structured.notes)[0];
			if (!n) return '';
			const q = isRecord(n.gatewayQuote) ? n.gatewayQuote : null;
			const aligned = str(q?.aligned);
			const original = str(q?.original) || str(n.quote);
			const head = aligned ? `**“${aligned}”** · ${original}` : `**${original}**`;
			const lesson = str(n.supportReferenceTitle);
			const body = [head, str(n.note), lesson ? `*Academy lesson: ${lesson}*` : '']
				.filter(Boolean)
				.join('\n\n');
			return str(n.note) ? clip(body) : '';
		}
		case 'words':
		case 'academy':
			return clip(smallHeadings(str(structured.article)));
		case 'questions': {
			const qs = list(structured.questions)
				.filter((q) => str(q.question))
				.map((q) => `**${str(q.question)}**\n\n${str(q.response)}`.trim());
			return clip(qs.join('\n\n'));
		}
	}
}

/**
 * Two to four phrases for the hero, from `get_passage_index` notes: the original-language
 * quote and the English words aligned to it. Phrases of several words come first.
 */
export function alignmentRows(index: unknown, max = 4): AlignmentRow[] {
	if (!isRecord(index)) return [];
	const seen = new Set<string>();
	const all: AlignmentRow[] = [];
	for (const n of list(index.notes)) {
		const q = isRecord(n.quote) ? n.quote : null;
		const original = str(q?.original);
		const aligned = str(q?.aligned);
		if (!original || !aligned || seen.has(original)) continue;
		seen.add(original);
		all.push({ original, aligned });
	}
	const phrases = all.filter((r) => r.aligned.includes(' '));
	const words = all.filter((r) => !r.aligned.includes(' '));
	return [...phrases, ...words].slice(0, max);
}

export type Piece = { text: string; mark: boolean };

const isLetter = (c: string | undefined) => !!c && /[\p{L}\p{M}]/u.test(c);

/** Where `needle` occurs in `text` from `from` on, as a whole word or phrase. */
function findWhole(text: string, needle: string, from: number): number {
	let at = text.indexOf(needle, from);
	while (at !== -1) {
		if (!isLetter(text[at - 1]) && !isLetter(text[at + needle.length])) return at;
		at = text.indexOf(needle, at + 1);
	}
	return -1;
}

/**
 * Split `text` into pieces, marking the words of `quote`. A quote that skips words
 * ("οὕτως … ἠγάπησεν") marks each of its pieces, in order. Joined, the pieces are `text`.
 */
export function highlight(text: string, quote: string): Piece[] {
	const fragments = quote
		.split(/\s*(?:…|\.\.\.)\s*/)
		.map((f) => f.trim())
		.filter(Boolean);
	const pieces: Piece[] = [];
	let cursor = 0;
	for (const f of fragments) {
		const at = findWhole(text, f, cursor);
		if (at === -1) continue;
		if (at > cursor) pieces.push({ text: text.slice(cursor, at), mark: false });
		pieces.push({ text: f, mark: true });
		cursor = at + f.length;
	}
	if (cursor < text.length) pieces.push({ text: text.slice(cursor), mark: false });
	return pieces;
}
