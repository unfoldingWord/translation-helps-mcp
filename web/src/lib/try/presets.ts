import type { ToolInfo } from '../mcp/client';

/** A ready example for the Tools tab. */
export type Preset = {
	label: string;
	tool: string;
	args: Record<string, unknown>;
	/** Parameters the live schema must have, or the example is hidden (a server older than the page). */
	needs?: string[];
};

/** At least one per tool. The values are real: English, John 3:16, Titus 1:1, OBS story 1. */
export const PRESETS: Preset[] = [
	{ label: 'All languages', tool: 'list_languages', args: {} },
	{
		label: 'Spanish variants',
		tool: 'list_languages',
		args: { filter: 'es', limit: 20 },
		needs: ['filter', 'limit']
	},
	{
		label: 'What English has for Titus',
		tool: 'list_resources',
		args: { language: 'en', book: 'TIT' }
	},

	{ label: 'John 3:16', tool: 'get_passage', args: { reference: 'John 3:16', language: 'en' } },
	{
		label: 'Titus 1:1 as USFM',
		tool: 'get_passage',
		args: { reference: 'Titus 1:1', language: 'en', format: 'usfm' }
	},
	{
		label: 'Background of Titus',
		tool: 'get_passage_context',
		args: { reference: 'Titus', language: 'en' }
	},
	{
		label: 'Titus 1:1 helps map',
		tool: 'get_passage_index',
		args: { reference: 'Titus 1:1', language: 'en' }
	},
	{
		label: 'Titus 1:1 map, without notes',
		tool: 'get_passage_index',
		args: { reference: 'Titus 1:1', language: 'en', skipNotes: true },
		needs: ['skipNotes']
	},

	{
		label: 'Notes on Titus 1:1',
		tool: 'get_note',
		args: { reference: 'Titus 1:1', language: 'en' }
	},
	{
		label: 'Notes that mention “servant”',
		tool: 'get_note',
		args: { reference: 'Titus 1:1', language: 'en', phrase: 'servant' },
		needs: ['phrase']
	},
	{
		label: 'Article: metaphor',
		tool: 'get_academy_article',
		args: { path: 'translate/figs-metaphor', language: 'en' }
	},
	{
		label: 'Key term: God',
		tool: 'get_word_article',
		args: { path: 'bible/kt/god', language: 'en' }
	},
	{
		label: 'Questions on Titus 1:1',
		tool: 'get_questions',
		args: { reference: 'Titus 1:1', language: 'en' }
	},

	// Replaces the old /rag page.
	{
		label: 'Search articles: “metaphor”',
		tool: 'search_articles',
		args: { query: 'metaphor', language: 'en' }
	},
	{
		label: 'Search key terms: “covenant”',
		tool: 'search_articles',
		args: { query: 'covenant', language: 'en', types: 'tw' },
		needs: ['types']
	},

	{ label: 'OBS story 1', tool: 'get_obs_story', args: { reference: '1', language: 'en' } },
	{
		label: 'OBS story 1, frames 1–3',
		tool: 'get_obs_story',
		args: { reference: '1:1-3', language: 'en' }
	},
	{ label: 'OBS story 1 notes', tool: 'get_obs_notes', args: { reference: '1', language: 'en' } },
	{
		label: 'OBS story 1 questions',
		tool: 'get_obs_questions',
		args: { reference: '1', language: 'en' }
	},
	{
		label: 'OBS story 1 study notes',
		tool: 'get_obs_study_notes',
		args: { reference: '1', language: 'en' }
	},
	{
		label: 'OBS story 1 study questions',
		tool: 'get_obs_study_questions',
		args: { reference: '1', language: 'en' }
	}
];

/** The parameters of a tool's live schema. */
function paramsOf(tools: ToolInfo[], tool: string): Set<string> | null {
	const t = tools.find((x) => x.name === tool);
	if (!t) return null;
	return new Set(Object.keys((t.inputSchema?.properties ?? {}) as Record<string, unknown>));
}

/** The examples the live server can run: its tool exists and has every parameter the example needs. */
export function visiblePresets(tools: ToolInfo[]): Preset[] {
	return PRESETS.filter((p) => {
		const params = paramsOf(tools, p.tool);
		return params !== null && (p.needs ?? []).every((n) => params.has(n));
	});
}
