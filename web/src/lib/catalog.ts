/**
 * The tool reference for /tools, built from the server's own manifest so it cannot drift.
 * Plain TypeScript with relative imports only: the tests and the root tsc read it.
 * The /tools route builds the manifest (`buildMcpManifest`) when it prerenders and passes it in.
 */
import { PRESETS } from './try/presets';

export type JsonSchema = Record<string, unknown> & { type?: string };

/** The part of the server's manifest this page reads. `McpManifest` fits it. */
export type ManifestLike = {
	tools: {
		name: string;
		description: string;
		summary: string;
		example?: Record<string, unknown>;
		inputSchema: unknown;
	}[];
};

export type ToolGroup = 'discovery' | 'passage' | 'articles' | 'obs';

export const TOOL_GROUPS: { id: ToolGroup; heading: string; line: string; tools: string[] }[] = [
	{
		id: 'discovery',
		heading: 'Find what exists',
		line: 'Which languages and resources there are, and a search across Translation Academy and Translation Words.',
		tools: ['list_languages', 'list_resources', 'search_articles']
	},
	{
		id: 'passage',
		heading: 'Work through a passage',
		line: 'The text, its background, a map of the helps, and the questions that check a draft.',
		tools: ['get_passage', 'get_passage_context', 'get_passage_index', 'get_questions']
	},
	{
		id: 'articles',
		heading: 'Open one help',
		line: 'The full note or article, once the map has shown which ones matter.',
		tools: ['get_note', 'get_academy_article', 'get_word_article']
	},
	{
		id: 'obs',
		heading: 'Open Bible Stories',
		line: 'A story, its notes and its questions.',
		tools: ['get_obs_story', 'get_obs_notes', 'get_obs_questions']
	}
];

export type ToolParam = {
	name: string;
	/** `string`, `integer`, `boolean`, … or `enum`. */
	type: string;
	required: boolean;
	description: string;
	default?: unknown;
	options?: string[];
};

export type ToolDoc = {
	name: string;
	title: string;
	/** One line. */
	summary: string;
	/** The full description the server sends to the assistant. */
	description: string;
	group: ToolGroup;
	inputSchema: JsonSchema;
	params: ToolParam[];
	/** A call that runs: from the Try page's examples when it has one for this tool. */
	example: { label: string; args: Record<string, unknown> };
};

type Prop = {
	type?: string | string[];
	enum?: unknown[];
	default?: unknown;
	description?: string;
	anyOf?: Prop[];
};

function typeOf(p: Prop): string {
	if (Array.isArray(p.enum)) return 'enum';
	if (Array.isArray(p.type)) return p.type.filter((t) => t !== 'null').join(' | ') || 'any';
	if (p.type) return p.type;
	if (p.anyOf) {
		const types = p.anyOf.map(typeOf).filter((t) => t !== 'any');
		return types.length ? [...new Set(types)].join(' | ') : 'any';
	}
	return 'any';
}

function paramsOf(schema: JsonSchema): ToolParam[] {
	const props = (schema.properties ?? {}) as Record<string, Prop>;
	const required = new Set((schema.required as string[] | undefined) ?? []);
	return Object.entries(props).map(([name, p]) => ({
		name,
		type: typeOf(p),
		required: required.has(name),
		description: p.description ?? '',
		default: p.default,
		options: Array.isArray(p.enum) ? p.enum.map(String) : undefined
	}));
}

/** "get_passage_index" → "Get passage index". */
function titleOf(name: string): string {
	const words = name.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function exampleOf(
	name: string,
	fromManifest: Record<string, unknown> | undefined
): ToolDoc['example'] {
	const preset = PRESETS.find((p) => p.tool === name && !p.needs?.length);
	if (preset) return { label: preset.label, args: preset.args };
	return { label: 'Example', args: fromManifest ?? {} };
}

/**
 * Every tool in the manifest, grouped and in the order of TOOL_GROUPS.
 * A tool that no group names goes last in its own "More tools" group, so a new server tool still shows up.
 */
export function buildToolCatalog(manifest: ManifestLike): ToolDoc[] {
	const groupOf = (name: string): ToolGroup =>
		TOOL_GROUPS.find((g) => g.tools.includes(name))?.id ?? ('more' as ToolGroup);
	const docs = manifest.tools.map((t): ToolDoc => {
		const schema = { ...(t.inputSchema as JsonSchema) };
		delete schema.$schema;
		return {
			name: t.name,
			title: titleOf(t.name),
			summary: t.summary,
			description: t.description,
			group: groupOf(t.name),
			inputSchema: schema,
			params: paramsOf(schema),
			example: exampleOf(t.name, t.example)
		};
	});
	const position = (d: ToolDoc) => {
		const g = TOOL_GROUPS.find((x) => x.id === d.group);
		return g ? TOOL_GROUPS.indexOf(g) * 100 + g.tools.indexOf(d.name) : 9999;
	};
	return docs.sort((a, b) => position(a) - position(b));
}
