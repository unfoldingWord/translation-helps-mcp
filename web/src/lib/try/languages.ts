import { run, type RunResult } from '../mcp/session';

export type Language = { code: string; name: string };

/** The part of `run` that `loadLanguages` needs; tests pass a fake. */
type Runner = (endpoint: string, tool: string, args: Record<string, unknown>) => Promise<RunResult>;

/**
 * The languages the server knows (`list_languages`), each with a name for people and a code.
 * Anything that is not a list gives just English, so the pickers always have something to show.
 */
export async function loadLanguages(endpoint: string, call: Runner = run): Promise<Language[]> {
	const { result } = await call(endpoint, 'list_languages', { limit: 9999 });
	const found = Array.isArray(result?.structured?.languages)
		? (result.structured.languages as { code?: unknown; name?: unknown; englishName?: unknown }[])
		: [];
	const list: Language[] = found
		.filter((l) => typeof l.code === 'string' && l.code)
		.map((l) => ({
			code: l.code as string,
			name:
				(typeof l.englishName === 'string' && l.englishName) ||
				(typeof l.name === 'string' && l.name) ||
				(l.code as string)
		}));
	if (!list.some((l) => l.code === 'en')) list.unshift({ code: 'en', name: 'English' });
	return list;
}

/** The options of a language picker. The language in use is always there, even if the server does not list it. */
export function languageOptions(
	languages: Language[],
	current: string
): { code: string; label: string }[] {
	const options = languages.map((l) => ({ code: l.code, label: `${l.name} (${l.code})` }));
	if (!options.some((o) => o.code === current)) options.unshift({ code: current, label: current });
	return options;
}
