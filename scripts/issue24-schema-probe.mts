/** Verify the advertised tools/list JSON Schema matches the tolerant behavior (issue #24 review). */
import { getMCPToolDefinitions } from '../src/mcp/tools-registry.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const tools = Object.fromEntries(getMCPToolDefinitions().map((t) => [t.name, t]));
let fail = 0;
function check(name: string, wantProps: string[]) {
	const s: any = zodToJsonSchema(tools[name].inputSchema, { $refStrategy: 'none' });
	const props = Object.keys(s.properties || {});
	const addl = s.additionalProperties;
	const required = s.required || [];
	const missing = wantProps.filter((p) => !props.includes(p));
	const additionalOk = addl !== false; // must NOT be false
	const ok = missing.length === 0 && additionalOk;
	if (!ok) fail++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
	console.log(`   additionalProperties=${addl} required=${JSON.stringify(required)}`);
	console.log(`   props=${props.join(',')}`);
	if (missing.length) console.log(`   MISSING: ${missing.join(',')}`);
}

// reference tools: reference must be optional (not in required), decomposed + language_code present
for (const t of ['fetch_scripture', 'fetch_translation_notes', 'fetch_translation_questions', 'fetch_translation_word_links']) {
	check(t, ['reference', 'book', 'chapter', 'verse', 'endVerse', 'language_code']);
	const s: any = zodToJsonSchema(tools[t].inputSchema, { $refStrategy: 'none' });
	if ((s.required || []).includes('reference')) {
		console.log(`   FAIL: reference still required`);
		fail++;
	}
}
// path tools: aliases present (incl. language aliases)
check('fetch_translation_word', ['path', 'term', 'word', 'name', 'article', 'moduleId', 'identifier', 'language_code', 'languageCode', 'lang']);
check('fetch_translation_academy', ['path', 'term', 'name', 'article', 'moduleId', 'identifier', 'language_code', 'languageCode', 'lang']);

// required-language tool: language must be optional + aliases advertised (Class D DoD shape)
check('list_resources_for_language', ['language', 'language_code', 'languageCode', 'lang']);
{
	const s: any = zodToJsonSchema(tools['list_resources_for_language'].inputSchema, { $refStrategy: 'none' });
	if ((s.required || []).includes('language')) {
		console.log('   FAIL: list_resources_for_language still requires `language`');
		fail++;
	}
}
check('list_subjects', ['language_code', 'languageCode', 'lang']);

// No tool may advertise additionalProperties:false (handler tolerates extras everywhere).
for (const name of Object.keys(tools)) {
	const s: any = zodToJsonSchema(tools[name].inputSchema, { $refStrategy: 'none' });
	if (s.additionalProperties === false) {
		console.log(`FAIL  ${name}: additionalProperties === false`);
		fail++;
	}
}

console.log('\n' + (fail ? `${fail} FAILURES` : 'ALL SCHEMA CHECKS PASS'));
process.exit(fail ? 1 : 0);
