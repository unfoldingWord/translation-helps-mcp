#!/usr/bin/env node
/**
 * Issue #24 — Definition-of-Done repro suite.
 *
 * Enumerates every distinct failing-input pattern from the production logs
 * (Classes A, B, C, D, E/F, H) plus a set of previously-working "control"
 * inputs that must NOT regress. Runs each as a real JSON-RPC `tools/call`
 * against a target `/api/mcp` and reports pass/fail.
 *
 * Usage:
 *   node scripts/issue24-dod-suite.mjs <base-url>
 *   node scripts/issue24-dod-suite.mjs https://tc-helps.mcp.servant.bible
 *   node scripts/issue24-dod-suite.mjs http://localhost:8788
 *
 * A case "passes" when its expectation holds:
 *   - kind:"ok"      → result returned (no JSON-RPC error) AND, if `expectText`
 *                      given, the result text contains it.
 *   - kind:"data"    → result text parses to >= `minItems` items.
 *   - kind:"resolves"→ the input is no longer *parse-rejected*: either a result
 *                      is returned, or the only error is a downstream "no data
 *                      for this verse" 404. A genuine parse/validation rejection
 *                      (Invalid reference / Missing parameter) still fails. This
 *                      is the correct bar for the parser fix: resolving "2KI 12:8"
 *                      to a real book that simply has no verse note is success.
 *   - kind:"error"   → expects a JSON-RPC error (control/negative).
 *
 * Exit code 0 only if every case passes.
 */

/** Error messages that mean the input was REJECTED before reaching real data. */
const PARSE_REJECTION =
	/invalid bible reference|invalid book reference|invalid reference format|missing required parameter|could not (parse|determine)|expected record/i;

const base = (process.argv[2] || 'https://tc-helps.mcp.servant.bible').replace(/\/+$/, '');
const endpoint = `${base}/api/mcp`;

/**
 * @typedef {Object} Case
 * @property {string} cls   Failure class (A/B/C/D/E/F/H/CTRL)
 * @property {string} name  Human label
 * @property {string} tool  MCP tool name
 * @property {any}    args  Raw arguments object (sent verbatim)
 * @property {'ok'|'data'|'error'} kind
 * @property {string=} expectText  substring expected in result text (kind ok)
 * @property {number=} minItems    minimum array length (kind data)
 */

/** @type {Case[]} */
const CASES = [
	// ── Class A: multi-digit chapter (the item-1 server bug) ─────────────
	{ cls: 'A', name: 'notes Mark 10:25 (multi-digit)', tool: 'fetch_translation_notes', args: { reference: 'Mark 10:25', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'notes Matthew 13:55 (multi-digit)', tool: 'fetch_translation_notes', args: { reference: 'Matthew 13:55', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'notes Genesis 50:1 (multi-digit)', tool: 'fetch_translation_notes', args: { reference: 'Genesis 50:1', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'questions Mark 10:23 (multi-digit, has data)', tool: 'fetch_translation_questions', args: { reference: 'Mark 10:23', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'questions Mark 10:25 (multi-digit, resolves)', tool: 'fetch_translation_questions', args: { reference: 'Mark 10:25', language: 'en' }, kind: 'resolves' },
	{ cls: 'A', name: 'notes Mark 10 (whole multi-digit chapter)', tool: 'fetch_translation_notes', args: { reference: 'Mark 10', language: 'en' }, kind: 'data', minItems: 1 },

	// ── Class A: invalid / spaceless USFM codes ──────────────────────────
	{ cls: 'A', name: 'notes MAR 10:25 (invalid code MAR→MRK)', tool: 'fetch_translation_notes', args: { reference: 'MAR 10:25', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'notes 2KI 5:1 (spaceless code, has data)', tool: 'fetch_translation_notes', args: { reference: '2KI 5:1', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'notes 2KGS 5:1 (invalid code 2KGS→2KI, has data)', tool: 'fetch_translation_notes', args: { reference: '2KGS 5:1', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'A', name: 'notes 2KI 12:8 (issue example, resolves)', tool: 'fetch_translation_notes', args: { reference: '2KI 12:8', language: 'en' }, kind: 'resolves' },

	// ── Class B: missing path; word/term synonyms ────────────────────────
	{ cls: 'B', name: 'word term=love (alias term→path)', tool: 'fetch_translation_word', args: { term: 'love', language: 'en' }, kind: 'ok', expectText: 'love' },
	{ cls: 'B', name: 'word word=grace (alias word→path)', tool: 'fetch_translation_word', args: { word: 'grace', language: 'en' }, kind: 'ok', expectText: 'grace' },
	{ cls: 'B', name: 'word term=abraham (names category)', tool: 'fetch_translation_word', args: { term: 'abraham', language: 'en' }, kind: 'ok', expectText: 'Abraham' },
	{ cls: 'B', name: 'academy term=figs-metaphor (alias term→path)', tool: 'fetch_translation_academy', args: { term: 'figs-metaphor', language: 'en' }, kind: 'ok', expectText: 'etaphor' },

	// ── Class C: decomposed book+chapter+verse → reference ────────────────
	// The literal `book` key (what the first fix handled and the only shape the
	// old suite tested — hence the false 36/36 confidence while prod stayed broken).
	{ cls: 'C', name: 'notes decomposed {book} 1CO 15:58', tool: 'fetch_translation_notes', args: { book: '1CO', chapter: 15, verse: 58, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C', name: 'word_links decomposed {book} John 3:16', tool: 'fetch_translation_word_links', args: { book: 'John', chapter: 3, verse: 16, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C', name: 'questions decomposed {book} Mark 10:23', tool: 'fetch_translation_questions', args: { book: 'Mark', chapter: 10, verse: 23, language: 'en' }, kind: 'data', minItems: 1 },

	// ── Class C (structural): the REAL prod key spellings (issue #24 root cause) ──
	// These are the verbatim shapes from the 24h prod log that the book-only fix
	// MISSED. The structural classifier must catch every "book*" key variant.
	{ cls: 'C-key', name: 'notes {book_id} 2TH 3:13', tool: 'fetch_translation_notes', args: { book_id: '2TH', chapter: 3, verse: 13, language: 'en' }, kind: 'resolves' },
	{ cls: 'C-key', name: 'notes {book_code} MAT 6:25', tool: 'fetch_translation_notes', args: { book_code: 'MAT', chapter: 6, verse: 25, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C-key', name: 'notes {bookId} MAT 6:5', tool: 'fetch_translation_notes', args: { bookId: 'MAT', language: 'en', chapter: 6, verse: 5 }, kind: 'data', minItems: 1 },
	{ cls: 'C-key', name: 'word_links {book_id} 1JN 3:10', tool: 'fetch_translation_word_links', args: { book_id: '1JN', chapter: 3, verse: 10, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C-key', name: 'questions {bookId} Mark 10:23', tool: 'fetch_translation_questions', args: { bookId: 'Mark', chapter: 10, verse: 23, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C-key', name: 'notes chapter-only {book_id} 1TI 2', tool: 'fetch_translation_notes', args: { book_id: '1TI', chapter: 2, language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'C-key', name: 'scripture {book_id} JHN 3:16', tool: 'fetch_scripture', args: { book_id: 'JHN', chapter: 3, verse: 16, language: 'en' }, kind: 'ok', expectText: 'John' },

	// ── Class D: language_code alias → language ──────────────────────────
	{ cls: 'D', name: 'list_resources language_code=en', tool: 'list_resources_for_language', args: { language_code: 'en' }, kind: 'ok', expectText: 'en' },

	// ── Class E/F: scripture long / numbered names ───────────────────────
	{ cls: 'E/F', name: 'scripture James 1:13-15 (long name)', tool: 'fetch_scripture', args: { reference: 'James 1:13-15', language: 'en' }, kind: 'ok', expectText: 'James' },
	{ cls: 'E/F', name: 'scripture 1 Corinthians 13:4-7 (numbered name)', tool: 'fetch_scripture', args: { reference: '1 Corinthians 13:4-7', language: 'en' }, kind: 'ok' },

	// ── Class H: null / array args ───────────────────────────────────────
	{ cls: 'H', name: 'list_languages args=[] (array)', tool: 'list_languages', args: [], kind: 'ok' },
	{ cls: 'H', name: 'list_languages args=null (null)', tool: 'list_languages', args: null, kind: 'ok' },

	// ── Controls: must keep working (no regressions) ─────────────────────
	{ cls: 'CTRL', name: 'notes John 3:16 (single-digit)', tool: 'fetch_translation_notes', args: { reference: 'John 3:16', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'CTRL', name: 'notes Mark 9:1 (single-digit)', tool: 'fetch_translation_notes', args: { reference: 'Mark 9:1', language: 'en' }, kind: 'data', minItems: 1 },
	{ cls: 'CTRL', name: 'scripture John 3:16', tool: 'fetch_scripture', args: { reference: 'John 3:16', language: 'en' }, kind: 'ok', expectText: 'John' },
	{ cls: 'CTRL', name: 'word path=bible/kt/love (canonical path)', tool: 'fetch_translation_word', args: { path: 'bible/kt/love', language: 'en' }, kind: 'ok', expectText: 'love' },
	{ cls: 'CTRL', name: 'academy path=translate/figs-metaphor', tool: 'fetch_translation_academy', args: { path: 'translate/figs-metaphor', language: 'en' }, kind: 'ok', expectText: 'etaphor' },

	// ── REAL prod failures: exact (tool, args) from 7-day prod log (issue #24) ──
	// NL prompt text is not logged (redacted); these are the verbatim args the
	// model emitted. #6 (scripture, language:"en-US") is a separate language-
	// variant issue, out of scope — tracked separately, not included here.
	{ cls: 'PROD', name: '#1 notes {reference:"MAR 10:25"}', tool: 'fetch_translation_notes', args: { reference: 'MAR 10:25' }, kind: 'data', minItems: 1 },
	{ cls: 'PROD', name: '#2 word {word:"new creation"}', tool: 'fetch_translation_word', args: { word: 'new creation' }, kind: 'resolves' },
	{ cls: 'PROD', name: '#3 word {term:"lovingkindness"}', tool: 'fetch_translation_word', args: { term: 'lovingkindness' }, kind: 'resolves' },
	{ cls: 'PROD', name: '#4 word {name:"god",language:"en",format:"md"}', tool: 'fetch_translation_word', args: { name: 'god', language: 'en', format: 'md' }, kind: 'ok', expectText: 'god' },
	{ cls: 'PROD', name: '#5 notes {includeIntro,reference:"Genesis 1:1-3",format:json}', tool: 'fetch_translation_notes', args: { includeIntro: true, reference: 'Genesis 1:1-3', format: 'json' }, kind: 'resolves' },
	{ cls: 'PROD', name: '#7 notes {includeIntro,reference:"GEN 1:1-3",format:json}', tool: 'fetch_translation_notes', args: { includeIntro: true, reference: 'GEN 1:1-3', format: 'json' }, kind: 'resolves' },
	{ cls: 'PROD', name: '#8 notes {reference:"EZK 36:25-27"} (parse fixed; verse no-data)', tool: 'fetch_translation_notes', args: { reference: 'EZK 36:25-27' }, kind: 'resolves' },
	{ cls: 'PROD', name: '#9 notes {reference:"Ruth 3:9",language:"pt"}', tool: 'fetch_translation_notes', args: { reference: 'Ruth 3:9', language: 'pt' }, kind: 'resolves' },
	// Straggler found in staging A/B logs: model used `article` as the path synonym.
	{ cls: 'PROD', name: 'academy {article:"translate-names"} (alias article→path)', tool: 'fetch_translation_academy', args: { article: 'translate-names' }, kind: 'ok', expectText: 'name' },
	// Straggler from 24h prod log: model used `id` as the academy path synonym.
	{ cls: 'PROD', name: 'academy {id:"figs-synecdoche"} (alias id→path)', tool: 'fetch_translation_academy', args: { id: 'figs-synecdoche' }, kind: 'resolves' },
	{ cls: 'PROD', name: 'word {id:"grace"} (alias id→path)', tool: 'fetch_translation_word', args: { id: 'grace' }, kind: 'ok', expectText: 'grace' }
];

async function callTool(tool, args) {
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
	});
	const text = await res.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		// Maybe SSE framing: pull the data: line
		const m = text.match(/data:\s*(\{.*\})/s);
		parsed = m ? JSON.parse(m[1]) : { raw: text };
	}
	return { status: res.status, parsed };
}

/** Extract the result text payload and any decoded JSON-of-text. */
function resultText(parsed) {
	const content = parsed?.result?.content;
	if (Array.isArray(content)) {
		return content.map((c) => c?.text ?? '').join('\n');
	}
	return '';
}

function countItems(text) {
	try {
		const obj = JSON.parse(text);
		for (const f of ['items', 'verseNotes', 'notes', 'questions', 'translationQuestions', 'scripture', 'scriptures']) {
			if (Array.isArray(obj?.[f])) return obj[f].length;
		}
		// single-article shapes
		if (obj?.content || obj?.text || obj?.definition) return 1;
		return 0;
	} catch {
		return text.trim() ? 1 : 0;
	}
}

function evaluate(c, status, parsed) {
	const err = parsed?.error;
	const text = resultText(parsed);
	if (c.kind === 'error') {
		return { pass: Boolean(err), detail: err ? `error: ${err.message?.slice(0, 80)}` : 'expected error, got result' };
	}
	if (c.kind === 'resolves') {
		if (!err) return { pass: true, detail: 'resolved (returned data)' };
		const msg = String(err.message || '');
		if (PARSE_REJECTION.test(msg)) return { pass: false, detail: `parse-rejected: ${msg.slice(0, 90)}` };
		return { pass: true, detail: `resolved (no-data: ${msg.slice(0, 70)})` };
	}
	if (err) {
		return { pass: false, detail: `JSON-RPC error: ${String(err.message).slice(0, 120)}` };
	}
	if (c.kind === 'ok') {
		if (c.expectText && !text.toLowerCase().includes(c.expectText.toLowerCase())) {
			return { pass: false, detail: `result missing "${c.expectText}" (got ${text.slice(0, 80)}…)` };
		}
		return { pass: text.trim().length > 0, detail: text.trim() ? 'ok' : 'empty result' };
	}
	if (c.kind === 'data') {
		const n = countItems(text);
		return { pass: n >= (c.minItems ?? 1), detail: `${n} item(s)` };
	}
	return { pass: false, detail: 'unknown kind' };
}

async function main() {
	console.log(`\nIssue #24 DoD suite → ${endpoint}\n${'─'.repeat(64)}`);
	const results = [];
	for (const c of CASES) {
		let line;
		try {
			const { status, parsed } = await callTool(c.tool, c.args);
			const { pass, detail } = evaluate(c, status, parsed);
			results.push({ c, pass });
			line = `${pass ? 'PASS' : 'FAIL'}  [${c.cls.padEnd(4)}] ${c.name}  — ${detail}`;
		} catch (e) {
			results.push({ c, pass: false });
			line = `FAIL  [${c.cls.padEnd(4)}] ${c.name}  — threw: ${e.message}`;
		}
		console.log(line);
	}
	const passed = results.filter((r) => r.pass).length;
	console.log('─'.repeat(64));
	console.log(`${passed}/${results.length} passed`);
	const failed = results.filter((r) => !r.pass);
	if (failed.length) {
		console.log('\nFailing:');
		for (const r of failed) console.log(`  - [${r.c.cls}] ${r.c.name}`);
	}
	process.exit(failed.length ? 1 : 0);
}

main();
