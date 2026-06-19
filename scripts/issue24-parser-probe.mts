/**
 * Local probe for src/functions/reference-parser.ts (notes/questions/word-links parser).
 * Verifies issue #24 Class A: multi-digit chapters + invalid/spaceless codes,
 * with controls that must keep resolving.
 */
import { parseReference } from '../src/functions/reference-parser.js';

type Row = { input: string; wantBook: string | null; wantChapter?: number; wantVerse?: number };

const ROWS: Row[] = [
	// multi-digit (item 1)
	{ input: 'Mark 10:25', wantBook: 'MRK', wantChapter: 10, wantVerse: 25 },
	{ input: 'Matthew 13:55', wantBook: 'MAT', wantChapter: 13, wantVerse: 55 },
	{ input: 'Genesis 50:1', wantBook: 'GEN', wantChapter: 50, wantVerse: 1 },
	{ input: 'Psalms 119:1', wantBook: 'PSA', wantChapter: 119, wantVerse: 1 },
	{ input: 'Mark 10', wantBook: 'MRK', wantChapter: 10 },
	// invalid / spaceless codes
	{ input: 'MAR 10:25', wantBook: 'MRK', wantChapter: 10, wantVerse: 25 },
	{ input: '2KI 12:8', wantBook: '2KI', wantChapter: 12, wantVerse: 8 },
	{ input: '2KGS 12:8', wantBook: '2KI', wantChapter: 12, wantVerse: 8 },
	{ input: '1KGS 8:1', wantBook: '1KI', wantChapter: 8, wantVerse: 1 },
	{ input: '1Co 15:58', wantBook: '1CO', wantChapter: 15, wantVerse: 58 },
	{ input: '1CO 15:58', wantBook: '1CO', wantChapter: 15, wantVerse: 58 },
	{ input: '1 Corinthians 13:4-7', wantBook: '1CO', wantChapter: 13, wantVerse: 4 },
	// controls (single-digit + book-only + numbered with space)
	{ input: 'John 3:16', wantBook: 'JHN', wantChapter: 3, wantVerse: 16 },
	{ input: 'Mark 9:1', wantBook: 'MRK', wantChapter: 9, wantVerse: 1 },
	{ input: '2 Kings 12:8', wantBook: '2KI', wantChapter: 12, wantVerse: 8 },
	{ input: 'Philemon', wantBook: 'PHM', wantChapter: 1 },
	{ input: 'Titus 1-2', wantBook: 'TIT', wantChapter: 1 },
	{ input: 'Génesis 1:1', wantBook: 'GEN', wantChapter: 1, wantVerse: 1 },
	// negative control: should NOT resolve to a book
	{ input: 'definitely not a reference 99', wantBook: null }
];

let pass = 0;
for (const r of ROWS) {
	const parsed = parseReference(r.input, { language: r.input.startsWith('Génesis') ? 'es' : undefined });
	let ok: boolean;
	let detail: string;
	if (r.wantBook === null) {
		ok = parsed === null || parsed.book === '' || parsed.book === undefined;
		detail = parsed ? `book=${parsed.book}` : 'null';
	} else if (!parsed) {
		ok = false;
		detail = 'null';
	} else {
		ok =
			parsed.book === r.wantBook &&
			(r.wantChapter === undefined || parsed.chapter === r.wantChapter) &&
			(r.wantVerse === undefined || parsed.verse === r.wantVerse);
		detail = `${parsed.book} ${parsed.chapter ?? ''}:${parsed.verse ?? ''}`;
	}
	if (ok) pass++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.input.padEnd(30)} → ${detail}`);
}
console.log('─'.repeat(50));
console.log(`${pass}/${ROWS.length} passed`);
process.exit(pass === ROWS.length ? 0 : 1);
