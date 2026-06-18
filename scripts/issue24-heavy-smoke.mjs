#!/usr/bin/env node
/**
 * Issue #24 — HEAVY smoke suite (breadth beyond the DoD gate).
 *
 * Generates a wide matrix of tool calls covering every failure class with many
 * books / chapters / aliases, plus regression controls, and runs them against a
 * target /api/mcp with a small concurrency pool. Reports a per-class summary.
 *
 * Assertion semantics:
 *   - 'ok'      : JSON-RPC result returned, non-empty text.
 *   - 'resolves': input no longer parse-rejected — a result, or a downstream
 *                 "no data for this verse" 404 (a parsed ref with no verse note
 *                 is a PASS; only Invalid-reference / Missing-param fails). This
 *                 is the right bar for the parser/alias fix across many books.
 *   - 'data' : result text parses to >= minItems items (curated cases known to
 *              have data).
 *   - 'has'  : result text contains a substring (case-insensitive).
 *   - 'error': expects a JSON-RPC error (negative controls).
 *
 * Usage: node scripts/issue24-heavy-smoke.mjs <base-url> [concurrency]
 */

const base = (process.argv[2] || 'https://tc-helps.mcp.servant.bible').replace(/\/+$/, '');
const CONC = Number(process.argv[3] || 6);
const endpoint = `${base}/api/mcp`;

const cases = [];
const add = (cls, name, tool, args, kind, extra = {}) =>
	cases.push({ cls, name, tool, args, kind, ...extra });

// ── Class A: multi-digit chapters across OT + NT, notes AND questions ──────
const MULTIDIGIT = [
	'Genesis 50:20', 'Exodus 20:3', 'Leviticus 19:18', 'Numbers 22:28', 'Deuteronomy 28:1',
	'Joshua 24:15', 'Judges 16:17', '1 Samuel 17:45', '2 Kings 12:8', '2 Chronicles 20:15',
	'Nehemiah 13:1', 'Job 38:4', 'Isaiah 53:5', 'Jeremiah 29:11', 'Ezekiel 37:4',
	'Daniel 12:2', 'Matthew 13:55', 'Matthew 27:46', 'Mark 10:25', 'Mark 14:36',
	'Luke 15:11', 'Luke 24:27', 'John 11:35', 'John 21:15', 'Acts 17:11',
	'Romans 12:1', '1 Corinthians 13:4', '1 Corinthians 15:58', '2 Corinthians 12:9',
	'Galatians 11:1' /* invalid chapter — negative-ish, see below */, 'Hebrews 11:1',
	'Revelation 21:4', 'Revelation 22:13'
];
for (const r of MULTIDIGIT) {
	// Galatians has no chapter 11 — expect a clean response, not a parse 400.
	add('A', `notes ${r}`, 'fetch_translation_notes', { reference: r, language: 'en' }, 'resolves');
}
for (const r of ['Mark 10:25', 'Matthew 13:55', 'John 11:35', 'Romans 12:1', 'Revelation 21:4', 'Genesis 50:20']) {
	add('A', `questions ${r}`, 'fetch_translation_questions', { reference: r, language: 'en' }, 'resolves');
	add('A', `word_links ${r}`, 'fetch_translation_word_links', { reference: r, language: 'en' }, 'resolves');
}
// whole multi-digit chapters
for (const r of ['Mark 10', 'Matthew 13', 'Psalms 119', 'Genesis 50', 'Acts 17']) {
	add('A', `notes whole-ch ${r}`, 'fetch_translation_notes', { reference: r, language: 'en' }, 'resolves');
}

// ── Class A: invalid / spaceless / odd codes ──────────────────────────────
const ODD_CODES = [
	'MAR 10:25', 'MAR 1:1', '2KI 12:8', '2KGS 12:8', '1KGS 8:1', '2KI 2:11',
	'1Co 13:4', '1CO 15:58', '2Co 12:9', '1Jn 4:8', '3Jn 1:4', '1Th 4:16',
	'2Ti 3:16', 'Php 4:13', 'Jas 1:5', 'Rev 21:4'
];
for (const r of ODD_CODES) {
	add('A', `notes code ${r}`, 'fetch_translation_notes', { reference: r, language: 'en' }, 'resolves');
}

// ── Class B: term/word/path aliases for words; term/moduleId for academy ──
const WORDS = ['love', 'grace', 'faith', 'covenant', 'abraham', 'moses', 'jerusalem', 'sabbath', 'shepherd'];
for (const w of WORDS) {
	add('B', `word term=${w}`, 'fetch_translation_word', { term: w, language: 'en' }, 'has', { needle: w });
}
add('B', 'word word=grace', 'fetch_translation_word', { word: 'grace', language: 'en' }, 'has', { needle: 'grace' });
add('B', 'word path=love (bare)', 'fetch_translation_word', { path: 'love', language: 'en' }, 'has', { needle: 'love' });
add('B', 'word topic-as-name=faith', 'fetch_translation_word', { topic: 'faith', language: 'en' }, 'has', { needle: 'faith' });
const MODULES = ['figs-metaphor', 'figs-simile', 'figs-activepassive', 'translate-names', 'figs-hyperbole'];
for (const m of MODULES) {
	add('B', `academy term=${m}`, 'fetch_translation_academy', { term: m, language: 'en' }, 'resolves');
	add('B', `academy moduleId=${m}`, 'fetch_translation_academy', { moduleId: m, language: 'en' }, 'resolves');
}

// ── Class C: decomposed book+chapter+verse across all ref tools ───────────
const DECOMP = [
	{ tool: 'fetch_translation_notes', book: '1CO', chapter: 15, verse: 58 },
	{ tool: 'fetch_translation_notes', book: 'Mark', chapter: 10, verse: 25 },
	{ tool: 'fetch_translation_questions', book: 'Mark', chapter: 10, verse: 25 },
	{ tool: 'fetch_translation_questions', book: 'John', chapter: 3, verse: 16 },
	{ tool: 'fetch_translation_word_links', book: 'John', chapter: 3, verse: 16 },
	{ tool: 'fetch_translation_word_links', book: 'Romans', chapter: 12, verse: 1 },
	{ tool: 'fetch_scripture', book: 'John', chapter: 3, verse: 16 },
	{ tool: 'fetch_scripture', book: 'Matthew', chapter: 13, verse: 55 }
];
for (const d of DECOMP) {
	add('C', `${d.tool} {${d.book} ${d.chapter}:${d.verse}}`, d.tool, { book: d.book, chapter: d.chapter, verse: d.verse, language: 'en' }, 'resolves');
}
// decomposed with endVerse / chapter range
add('C', 'notes decomposed range 1CO 13:4-7', 'fetch_translation_notes', { book: '1CO', chapter: 13, verse: 4, endVerse: 7, language: 'en' }, 'resolves');

// ── Class D: language synonyms ───────────────────────────────────────────
add('D', 'list_resources language_code=en', 'list_resources_for_language', { language_code: 'en' }, 'has', { needle: 'en' });
add('D', 'list_resources lang=en', 'list_resources_for_language', { lang: 'en' }, 'has', { needle: 'en' });
add('D', 'notes language_code=en John 3:16', 'fetch_translation_notes', { reference: 'John 3:16', language_code: 'en' }, 'data', { minItems: 1 });

// ── Class H: weird arg containers ────────────────────────────────────────
add('H', 'list_languages args=[]', 'list_languages', [], 'ok');
add('H', 'list_languages args=null', 'list_languages', null, 'ok');
add('H', 'list_subjects args=[]', 'list_subjects', [], 'ok');

// ── Controls / regression (must keep working) ────────────────────────────
add('CTRL', 'notes John 3:16', 'fetch_translation_notes', { reference: 'John 3:16', language: 'en' }, 'data', { minItems: 1 });
add('CTRL', 'notes Mark 9:1 (single-digit)', 'fetch_translation_notes', { reference: 'Mark 9:1', language: 'en' }, 'data', { minItems: 1 });
add('CTRL', 'notes Titus 1:1', 'fetch_translation_notes', { reference: 'Titus 1:1', language: 'en' }, 'data', { minItems: 1 });
add('CTRL', 'scripture John 3:16', 'fetch_scripture', { reference: 'John 3:16', language: 'en' }, 'has', { needle: 'John' });
add('CTRL', 'scripture James 1:13-15 (long name)', 'fetch_scripture', { reference: 'James 1:13-15', language: 'en' }, 'has', { needle: 'James' });
add('CTRL', 'scripture 1 Corinthians 13:4-7', 'fetch_scripture', { reference: '1 Corinthians 13:4-7', language: 'en' }, 'ok');
add('CTRL', 'word path=bible/kt/love (canonical)', 'fetch_translation_word', { path: 'bible/kt/love', language: 'en' }, 'has', { needle: 'love' });
add('CTRL', 'academy path=translate/figs-metaphor', 'fetch_translation_academy', { path: 'translate/figs-metaphor', language: 'en' }, 'has', { needle: 'etaphor' });
add('CTRL', 'word_links John 3:16', 'fetch_translation_word_links', { reference: 'John 3:16', language: 'en' }, 'data', { minItems: 1 });
// Localized (Spanish) book name resolves through the parser. NOTE: the *accented*
// form "Génesis" is rejected by a separate pre-existing `reference` param validator
// (confirmed identical on prod) — out of scope for #24, tracked separately.
add('CTRL', 'notes Marcos 1:1 (es localized name)', 'fetch_translation_notes', { reference: 'Marcos 1:1', language: 'es' }, 'resolves');

async function callTool(tool, args) {
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
	});
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		const m = text.match(/data:\s*(\{.*\})/s);
		return m ? JSON.parse(m[1]) : { raw: text };
	}
}
function resultText(parsed) {
	const c = parsed?.result?.content;
	return Array.isArray(c) ? c.map((x) => x?.text ?? '').join('\n') : '';
}
function countItems(text) {
	try {
		const o = JSON.parse(text);
		for (const f of ['items', 'verseNotes', 'notes', 'questions', 'translationQuestions', 'scripture', 'scriptures'])
			if (Array.isArray(o?.[f])) return o[f].length;
		if (o?.content || o?.definition || o?.text) return 1;
		return 0;
	} catch {
		return text.trim() ? 1 : 0;
	}
}
const PARSE_REJECTION =
	/invalid bible reference|invalid book reference|invalid reference format|missing required parameter|could not (parse|determine)|expected record/i;

function evaluate(c, parsed) {
	const err = parsed?.error;
	const text = resultText(parsed);
	if (c.kind === 'error') return { pass: !!err, detail: err ? 'error (expected)' : 'no error' };
	if (c.kind === 'resolves') {
		if (!err) return { pass: true, detail: 'resolved' };
		const msg = String(err.message || '');
		if (PARSE_REJECTION.test(msg)) return { pass: false, detail: `parse-rejected: ${msg.slice(0, 80)}` };
		return { pass: true, detail: `resolved (no-data)` };
	}
	if (err) return { pass: false, detail: `ERR: ${String(err.message).slice(0, 90)}` };
	if (c.kind === 'has') {
		const ok = text.toLowerCase().includes(String(c.needle).toLowerCase());
		return { pass: ok, detail: ok ? `has "${c.needle}"` : `missing "${c.needle}"` };
	}
	if (c.kind === 'data') {
		const n = countItems(text);
		return { pass: n >= (c.minItems ?? 1), detail: `${n} item(s)` };
	}
	// ok
	return { pass: text.trim().length > 0, detail: text.trim() ? 'ok' : 'empty' };
}

async function run() {
	console.log(`\nHEAVY smoke → ${endpoint}  (${cases.length} cases, conc=${CONC})\n${'─'.repeat(70)}`);
	const results = new Array(cases.length);
	let idx = 0;
	async function worker() {
		while (idx < cases.length) {
			const i = idx++;
			const c = cases[i];
			try {
				const parsed = await callTool(c.tool, c.args);
				const r = evaluate(c, parsed);
				results[i] = { c, ...r };
			} catch (e) {
				results[i] = { c, pass: false, detail: `threw: ${e.message}` };
			}
			const r = results[i];
			if (!r.pass) console.log(`FAIL [${c.cls}] ${c.name} — ${r.detail}`);
		}
	}
	await Promise.all(Array.from({ length: CONC }, worker));

	const byCls = {};
	for (const r of results) {
		const k = r.c.cls;
		byCls[k] = byCls[k] || { pass: 0, total: 0 };
		byCls[k].total++;
		if (r.pass) byCls[k].pass++;
	}
	console.log('─'.repeat(70));
	console.log('Per-class:');
	for (const k of Object.keys(byCls).sort())
		console.log(`  ${k.padEnd(5)} ${byCls[k].pass}/${byCls[k].total}`);
	const passed = results.filter((r) => r.pass).length;
	console.log('─'.repeat(70));
	console.log(`TOTAL ${passed}/${results.length}`);
	process.exit(passed === results.length ? 0 : 1);
}
run();
