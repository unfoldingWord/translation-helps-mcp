/**
 * The home page's "anatomy of a passage": John 3:16 and the helps the server
 * returns for it, one tool call each. Plain TypeScript with relative imports only:
 * the tests and `scripts/capture-home-snapshot.ts` import it too.
 */
import type { GuidedStepId, TryState } from '../try/hashState';
import type { ResourceId } from '../resources';
import { questionsAsMarkdown } from '../helpsMarkdown';
import { mapRows } from '../try/guided';

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

/**
 * A translation note for the hero, from `get_passage_index` (its id, quote and Academy
 * topic) and `get_note` (its text).
 */
export type HeroNote = AlignmentRow & {
	id: string;
	/** The note's text as `get_note` returns it (markdown). */
	note: string;
	/** The title of the Academy article the note points to; null when it points to none. */
	academy: string | null;
};

/** What the server returns for the verse: the rows of the map, and the checking questions. */
export type HeroCounts = { notes: number; keyTerms: number; questions: number; academy: number };

/** The saved answers: an excerpt per part, plus the hero's verse, notes and counts. */
export type HomeSnapshot = Record<AnatomyPartId, string> & {
	hero: { notes: HeroNote[]; counts: HeroCounts };
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
		case 'questions':
			return clip(questionsAsMarkdown(structured.questions));
	}
}

/**
 * Two to four notes for the hero, from a `get_passage_index` answer: each one's id, its
 * original-language quote, the English words aligned to it, and its Academy topic. One note
 * per quote. Notes on phrases of several words come first, and among those and among the
 * single words, the ones with an Academy topic. `note` is filled in later, from `get_note`.
 */
export function heroNotes(index: unknown, max = 4): Omit<HeroNote, 'note'>[] {
	if (!isRecord(index)) return [];
	const seen = new Set<string>();
	const all: Omit<HeroNote, 'note'>[] = [];
	for (const n of list(index.notes)) {
		const q = isRecord(n.quote) ? n.quote : null;
		const id = str(n.id);
		const original = str(q?.original);
		const aligned = str(q?.aligned);
		if (!id || !original || !aligned || seen.has(original)) continue;
		seen.add(original);
		const ta = isRecord(n.taArticle) ? n.taArticle : null;
		all.push({ id, original, aligned, academy: str(ta?.title) || null });
	}
	const rank = (r: Omit<HeroNote, 'note'>) =>
		(r.aligned.includes(' ') ? 0 : 2) + (r.academy ? 0 : 1);
	return all.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/** The text of the first note in a `get_note` answer, or "" for another shape. */
export function noteTextFrom(structured: unknown): string {
	if (!isRecord(structured)) return '';
	return str(list(structured.notes)[0]?.note);
}

/**
 * The counts for the hero: notes, key terms and Academy topics as the Try page's map lists
 * them (`mapRows` of the `get_passage_index` answer), and the `get_questions` questions.
 */
export function heroCounts(index: unknown, questions: unknown): HeroCounts {
	const rows = mapRows(index);
	const count = (kind: string) => rows.filter((r) => r.kind === kind).length;
	return {
		notes: count('note'),
		keyTerms: count('word'),
		academy: count('academy'),
		questions: isRecord(questions) ? list(questions.questions).length : 0
	};
}

export const LEAD_MAX = 180;

/** The start of a note as plain text: markdown marks and link targets removed, cut at a sentence or a word. */
export function noteLead(md: string, max = LEAD_MAX): string {
	const text = md
		.replace(/\[\[[^\]]*\]\]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*|__|\*|`/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length <= max) return text;
	const room = max - 1;
	const sentence = text.lastIndexOf('. ', room);
	if (sentence >= room * 0.5) return text.slice(0, sentence + 1);
	const space = text.lastIndexOf(' ', room);
	return text.slice(0, space > 0 ? space : room).replace(/[,;:]$/, '') + '…';
}

/** One slide of the hero: a note's two quotes, the start of its text, and its Academy topic. */
export type HeroSlide = AlignmentRow & { id: string; lead: string; academy: string | null };

/** The slides of the hero, one per saved note that has text. */
export function heroSlides(hero: HomeSnapshot['hero']): HeroSlide[] {
	return hero.notes
		.map((n) => ({
			id: n.id,
			original: n.original,
			aligned: n.aligned,
			lead: noteLead(n.note),
			academy: n.academy
		}))
		.filter((s) => s.lead);
}

/** One count in the hero's footer, and the step of the guided walk that lists those items. */
export type HeroFact = { id: keyof HeroCounts; text: string; step: GuidedStepId };

/** "7 notes · 8 key terms · 1 question · 4 Academy topics", each with its step of the walk. */
export function heroFacts(counts: HeroCounts): HeroFact[] {
	const say = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	return [
		{ id: 'notes', text: say(counts.notes, 'note', 'notes'), step: 'map' },
		{ id: 'keyTerms', text: say(counts.keyTerms, 'key term', 'key terms'), step: 'map' },
		{ id: 'questions', text: say(counts.questions, 'question', 'questions'), step: 'check' },
		{
			id: 'academy',
			text: say(counts.academy, 'Academy topic', 'Academy topics'),
			step: 'map'
		}
	];
}

/** The guided walk on the hero's verse, at `step`. */
export function walkState(step: GuidedStepId): TryState {
	return guided({ step });
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
