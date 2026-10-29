/**
 * Where an answer's content comes from, for the source line under it (CC BY-SA 4.0 asks
 * for credit and a link to the licence). Plain TypeScript with relative imports: the tests
 * import it.
 */
import { LICENCE, RESOURCES } from '../resources';

export type SourceLink = { label: string; href: string };
export type SourceLine = { sources: SourceLink[]; licence: { name: string; href: string } };

const DOOR43 = 'https://git.door43.org';
/** Several English resources at once. */
const ALL_HELPS: SourceLink = {
	label: 'unfoldingWord translation helps',
	href: `${DOOR43}/unfoldingWord`
};
/** Another language: its helps are published on Door43 by its own team, under the same licence. */
const CATALOG: SourceLink = { label: 'translation helps catalog', href: `${DOOR43}/catalog` };

/** Tools whose answer draws on several resources (the index: notes, word links, Academy topics). */
const SEVERAL = new Set(['get_passage_index', 'search_articles', 'find_translation_principle']);

/** Tools that list what exists and show no unfoldingWord content. */
const DISCOVERY = new Set(['list_languages', 'list_resources']);

/** Tools whose answer comes from one resource that `RESOURCES` does not list by its tool. */
const OTHER: Record<string, SourceLink> = {
	// The book and chapter introductions are notes.
	get_passage_context: resourceLink('tn'),
	get_obs_notes: {
		label: 'unfoldingWord® OBS Translation Notes',
		href: `${DOOR43}/unfoldingWord/en_obs-tn`
	},
	get_obs_questions: {
		label: 'unfoldingWord® OBS Translation Questions',
		href: `${DOOR43}/unfoldingWord/en_obs-tq`
	},
	get_obs_study_notes: {
		label: 'unfoldingWord® OBS Study Notes',
		href: `${DOOR43}/unfoldingWord/en_obs-sn`
	},
	get_obs_study_questions: {
		label: 'unfoldingWord® OBS Study Questions',
		href: `${DOOR43}/unfoldingWord/en_obs-sq`
	}
};

function resourceLink(id: string): SourceLink {
	const r = RESOURCES.find((x) => x.id === id)!;
	return { label: `unfoldingWord® ${r.short}`, href: r.door43 };
}

/**
 * get_passage names the archive each version came from
 * (`https://git.door43.org/unfoldingWord/en_ult/archive/v91.zip`): link its repository.
 */
function versionLinks(versions: unknown): SourceLink[] {
	if (!Array.isArray(versions)) return [];
	const out: SourceLink[] = [];
	for (const v of versions) {
		if (!v || typeof v !== 'object') continue;
		const { source, resourceType } = v as Record<string, unknown>;
		const m =
			typeof source === 'string'
				? /^https:\/\/git\.door43\.org\/([\w.-]+)\/([\w.-]+)(?:\/|$)/.exec(source)
				: null;
		if (!m) continue;
		const href = `${DOOR43}/${m[1]}/${m[2]}`;
		if (out.some((o) => o.href === href)) continue;
		const name =
			typeof resourceType === 'string' && resourceType ? resourceType.toUpperCase() : m[2];
		out.push({
			label: m[1] === 'unfoldingWord' ? `unfoldingWord® ${name}` : `${name} (${m[1]})`,
			href
		});
	}
	return out;
}

/**
 * The source line for an answer of `tool`, or null for the discovery tools.
 * - get_passage: each version's repository, from the answer;
 * - a tool that returns one English resource: that resource's Door43 repository;
 * - several resources (get_passage_index, the search tools): the unfoldingWord organisation
 *   on Door43;
 * - another language: the Door43 catalog, where each language's team publishes its helps.
 */
export function sourceLine(
	tool: string,
	structured?: Record<string, unknown> | null
): SourceLine | null {
	if (!tool || DISCOVERY.has(tool)) return null;
	const line = (sources: SourceLink[]): SourceLine => ({ sources, licence: { ...LICENCE } });
	if (tool === 'get_passage') {
		const fromAnswer = versionLinks(structured?.versions);
		if (fromAnswer.length) return line(fromAnswer);
	}
	const language = typeof structured?.language === 'string' ? structured.language : 'en';
	if (language !== 'en') return line([CATALOG]);
	if (SEVERAL.has(tool)) return line([ALL_HELPS]);
	const own = RESOURCES.filter((r) => r.tool === tool);
	if (tool === 'get_passage' || own.length === 1) return line(own.map((r) => resourceLink(r.id)));
	if (OTHER[tool]) return line([OTHER[tool]]);
	return line([ALL_HELPS]);
}
