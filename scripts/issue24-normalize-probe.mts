/**
 * Issue #24 — local unit check for structural arg normalization.
 *
 * Drives the REAL UnifiedMCPHandler with a fake fetch that captures the
 * outbound URL, so we can assert the normalized query WITHOUT a deployment.
 * Covers the prod key spellings the book-only fix missed (book_id/bookId/
 * book_code), range assembly, the `id` path alias, and the `version` collision
 * guard (must NOT be eaten as a verse).
 */
import { UnifiedMCPHandler } from '../ui/src/lib/mcp/UnifiedMCPHandler.js';

let lastUrl = '';
const fakeFetch = (async (url: string) => {
	lastUrl = String(url);
	return new Response(JSON.stringify({ verseNotes: [], items: [], text: 'ok' }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}) as unknown as typeof fetch;

const handler = new UnifiedMCPHandler('https://example.test', fakeFetch);

interface Probe {
	name: string;
	tool: string;
	args: any;
	/** decoded substrings that MUST appear in the outbound query */
	want: string[];
	/** decoded substrings that must NOT appear */
	notWant?: string[];
}

const PROBES: Probe[] = [
	{ name: '{book_id} 2TH 3:13', tool: 'fetch_translation_notes', args: { book_id: '2TH', chapter: 3, verse: 13, language: 'en' }, want: ['reference=2TH 3:13'], notWant: ['book_id'] },
	{ name: '{bookId} MAT 6:5', tool: 'fetch_translation_notes', args: { bookId: 'MAT', chapter: 6, verse: 5, language: 'en' }, want: ['reference=MAT 6:5'], notWant: ['bookId'] },
	{ name: '{book_code} MAT 6:25', tool: 'fetch_translation_notes', args: { book_code: 'MAT', chapter: 6, verse: 25, language: 'en' }, want: ['reference=MAT 6:25'], notWant: ['book_code'] },
	{ name: '{book} 1CO 15:58 (still works)', tool: 'fetch_translation_notes', args: { book: '1CO', chapter: 15, verse: 58, language: 'en' }, want: ['reference=1CO 15:58'], notWant: ['book='] },
	{ name: 'chapter-only {book_id} 1TI 2', tool: 'fetch_translation_notes', args: { book_id: '1TI', chapter: 2, language: 'en' }, want: ['reference=1TI 2'] },
	{ name: 'range {book_id} GEN 1:1-3', tool: 'fetch_translation_notes', args: { book_id: 'GEN', chapter: 1, verse: 1, endVerse: 3, language: 'en' }, want: ['reference=GEN 1:1-3'] },
	{ name: 'explicit reference wins; strays stripped', tool: 'fetch_translation_notes', args: { reference: 'John 3:16', book_id: 'XXX', chapter: 9, language: 'en' }, want: ['reference=John 3:16'], notWant: ['XXX', 'chapter'] },
	{ name: 'version NOT eaten as verse', tool: 'fetch_scripture', args: { book: 'GEN', chapter: 1, verse: 1, version: 'ult', language: 'en' }, want: ['reference=GEN 1:1', 'version=ult'] },
	{ name: 'academy {id} alias→path', tool: 'fetch_translation_academy', args: { id: 'figs-synecdoche', language: 'en' }, want: ['path=figs-synecdoche'], notWant: ['id='] },
	{ name: 'word {id} alias→path', tool: 'fetch_translation_word', args: { id: 'grace', language: 'en' }, want: ['path=grace'] },
];

let fail = 0;
for (const p of PROBES) {
	lastUrl = '';
	try {
		await handler.handleToolCall(p.tool, p.args);
	} catch (e) {
		console.log(`FAIL  ${p.name} — threw: ${(e as Error).message}`);
		fail++;
		continue;
	}
	const decoded = decodeURIComponent(lastUrl).replace(/\+/g, ' ');
	const missing = p.want.filter((w) => !decoded.includes(w));
	const leaked = (p.notWant ?? []).filter((w) => decoded.includes(w));
	const ok = missing.length === 0 && leaked.length === 0;
	if (!ok) fail++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${p.name}`);
	if (!ok) {
		if (missing.length) console.log(`   MISSING: ${missing.join(' | ')}`);
		if (leaked.length) console.log(`   LEAKED:  ${leaked.join(' | ')}`);
		console.log(`   url: ${decoded}`);
	}
}
console.log('\n' + (fail ? `${fail} FAILURES` : 'ALL NORMALIZE PROBES PASS'));
process.exit(fail ? 1 : 0);
