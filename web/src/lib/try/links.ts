/**
 * Links inside Door43 notes and articles, and the article each one opens.
 * Plain TypeScript with relative imports: the tests import it.
 *
 * The shapes seen in live answers (2026-10-28):
 * - notes: `[[rc://*\/ta/man/translate/figs-metonymy]]`, `[[rc://*\/tw/dict/bible/kt/sin]]`,
 *   and `../01/01.md` (another note of the book: not opened);
 * - word articles: `../kt/covenant.md`, `../other/death.md`, and `rc://en/tn/help/jhn/03/16`
 *   (a verse's notes: not opened);
 * - academy articles: `../bita-part2/01.md`.
 */

/** An article the walk can open: the same kinds and keys as the map rows. */
export type LinkTarget = { kind: 'academy' | 'word'; key: string };

/**
 * The article a link sits in, as the answer names it: `get_word_article` gives
 * `bible/kt/love.md` and `get_academy_article` gives `translate/figs-metonymy/01.md`.
 */
export type LinkFrom = { kind: 'academy' | 'word'; path: string };

const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/i;
/** Academy keys are `manual/article` (translate/figs-metaphor); word keys `bible/group/term`. */
const SEGMENTS: Record<LinkTarget['kind'], number> = { academy: 2, word: 3 };

/** The key of an article file, or null when the path is not one of that kind. */
function keyOf(kind: LinkTarget['kind'], path: string): string | null {
	const bare =
		kind === 'academy'
			? path.replace(/\/\d+\.md$/, '').replace(/\.md$/, '')
			: path.replace(/\.md$/, '');
	const parts = bare.replace(/\/+$/, '').split('/');
	if (parts.length !== SEGMENTS[kind] || !parts.every((p) => SEGMENT.test(p))) return null;
	return parts.join('/');
}

/** The folder relative links of an article start from. */
function folderOf(from: LinkFrom): string[] | null {
	const key = keyOf(from.kind, from.path);
	if (!key) return null;
	const parts = key.split('/');
	// An academy article is a folder of files (01.md, title.md); a word article is one file.
	return from.kind === 'academy' ? parts : parts.slice(0, -1);
}

const RC = /^rc:\/\/[^/\s]+\/(ta\/man|tw\/dict)\/([^?#\s]+)$/i;
const RELATIVE = /^(?:\.{1,2}\/)*[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.md$/i;

/**
 * The article a link opens, or null when it opens nothing on this site:
 * - `rc://<lang>/ta/man/<manual>/<article>` → that academy article;
 * - `rc://<lang>/tw/dict/bible/<group>/<term>` → that word article;
 * - a relative `.md` path → the article it names in the same resource as `from`.
 * Every other link, and any path that does not have the right number of plain segments, is null.
 */
export function linkTarget(href: string, from?: LinkFrom | null): LinkTarget | null {
	const url = href.trim();
	const rc = RC.exec(url);
	if (rc) {
		const kind = rc[1].toLowerCase() === 'ta/man' ? 'academy' : 'word';
		const key = keyOf(kind, rc[2]);
		return key ? { kind, key } : null;
	}
	if (!from || !RELATIVE.test(url)) return null;
	const folder = folderOf(from);
	if (!folder) return null;
	const out = [...folder];
	for (const part of url.split('/')) {
		if (part === '.') continue;
		if (part === '..') {
			if (!out.length) return null;
			out.pop();
		} else out.push(part);
	}
	const key = keyOf(from.kind, out.join('/'));
	return key ? { kind: from.kind, key } : null;
}

/** The article an answer is, for resolving its relative links. Null for other answers. */
export function linkFromAnswer(
	tool: string,
	structured: Record<string, unknown> | null | undefined
): LinkFrom | null {
	const path = typeof structured?.path === 'string' ? structured.path.trim() : '';
	if (!path) return null;
	if (tool === 'get_word_article') return { kind: 'word', path };
	if (tool === 'get_academy_article') return { kind: 'academy', path };
	return null;
}
