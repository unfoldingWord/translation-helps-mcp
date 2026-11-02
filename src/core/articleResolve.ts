/**
 * Resolve a near-miss Translation Words or Translation Academy path.
 *
 * The exact catalog path is tried first. Resolution runs only when it is
 * absent. `prepareArticlePath` runs once where raw input enters (the REST
 * route, or the MCP handler). The resolvers refuse a path that has not
 * been through it, so a caller cannot skip that edge.
 */

import { assertSafeArticlePath } from "./articlePath.js";
import { ErrorCode, TranslationHelpsError } from "./errors.js";

export const RESOLVED_FROM = [
  "category",
  "title",
  "plural",
  "manual",
  "partial",
] as const;

export type ResolvedFrom = (typeof RESOLVED_FROM)[number];

/** Shown when a single whole-word title match is not an exact title. */
export const PARTIAL_TITLE_NOTE = "Partial title match.";

export interface CatalogArticle {
  path: string;
  title: string;
}

export interface ArticleCandidate {
  path: string;
  title: string;
}

export type ArticleMatch =
  | { status: "exact"; path: string; title: string }
  | {
      status: "resolved";
      path: string;
      title: string;
      resolvedFrom: ResolvedFrom;
      note?: string;
    }
  | {
      status: "ambiguous";
      resolvedFrom: ResolvedFrom;
      candidates: ArticleCandidate[];
    }
  | { status: "miss" };

const RC_TW = /^rc:\/\/[^/]+\/tw\/dict\//i;
const RC_TA = /^rc:\/\/[^/]+\/ta\/man\//i;
const FOLDER_PREFIXES = ["tw/dict/", "ta/man/", "tw/", "ta/", "dict/"] as const;

const MAX_CANDIDATES = 5;

/** Spaces, hyphens, and straight or curly apostrophes. Comparison only. */
const TERM_NOISE = /[\s'’‘ʼ\u2010\u2011\u2012\u2013\u2014\u2015-]/g;
const BARE_TERM_GAP = /[\s'’‘ʼ]/;

/**
 * Remove only the known rc://, tw/, and ta/ prefixes. No other rewriting.
 */
export function stripKnownArticlePrefix(raw: string): string {
  const path = raw.trim();
  if (RC_TW.test(path)) return path.replace(RC_TW, "");
  if (RC_TA.test(path)) return path.replace(RC_TA, "");
  const lower = path.toLowerCase();
  for (const prefix of FOLDER_PREFIXES) {
    if (lower.startsWith(prefix)) return path.slice(prefix.length);
  }
  return path;
}

function percentDecoded(path: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(path)) return path;
  try {
    return decodeURIComponent(path).trim();
  } catch {
    return path;
  }
}

/** Trailing 's / ’s, or a possessive apostrophe with nothing after it. */
const TRAILING_POSSESSIVE = /(?:['’‘ʼ]s|['’‘ʼ])$/iu;

/**
 * `son's` and `son'` become `son` before spaces and apostrophes are removed,
 * so the key is not `sons`. Only a bare term (no slash) is rewritten.
 */
function stripTrailingPossessive(path: string): string {
  return path.replace(TRAILING_POSSESSIVE, "");
}

/**
 * A bare term (no slash left after the known prefixes) may contain spaces
 * or apostrophes. Drop a trailing possessive, then fold the rest into the
 * comparison key before the allowlist. A path that still has a slash keeps
 * the strict check.
 */
function collapseBareTerm(path: string): string {
  if (path.includes("/")) return path;
  const stripped = stripTrailingPossessive(path);
  if (stripped === path && !BARE_TERM_GAP.test(path)) return path;
  return stripped.toLowerCase().replace(TERM_NOISE, "");
}

/**
 * Strip known prefixes, fold a bare term, then the same safety check.
 * Throws TranslationHelpsError (INVALID_PARAMS) for anything unsafe.
 * Idempotent: a path it returns is unchanged by a second call.
 */
export function prepareArticlePath(raw: string): string {
  const stripped = percentDecoded(stripKnownArticlePrefix(raw).trim());
  return assertSafeArticlePath(collapseBareTerm(stripped));
}

function unpreparedArticlePath(path: string): TranslationHelpsError {
  return new TranslationHelpsError({
    code: ErrorCode.INVALID_PARAMS,
    message: "Invalid article path: path must be prepared before resolution",
    context: { path },
  });
}

/**
 * Accept only a path `prepareArticlePath` already returned. Does not rewrite
 * prefixes, spaces, or possessives. Unsafe paths still fail the allowlist.
 */
export function assertPreparedArticlePath(path: string): string {
  if (typeof path !== "string" || path !== path.trim()) {
    throw unpreparedArticlePath(String(path));
  }
  const safe = assertSafeArticlePath(path);
  if (safe !== path || stripKnownArticlePrefix(path) !== path) {
    throw unpreparedArticlePath(path);
  }
  if (
    !path.includes("/") &&
    (stripTrailingPossessive(path) !== path || BARE_TERM_GAP.test(path))
  ) {
    throw unpreparedArticlePath(path);
  }
  return path;
}

function matchKey(value: string): string {
  return value.toLowerCase().replace(TERM_NOISE, "");
}

function cleanTw(raw: string): string {
  return stripKnownArticlePrefix(raw)
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/\/01$/i, "");
}

function cleanTa(raw: string): string {
  return stripKnownArticlePrefix(raw)
    .trim()
    .replace(/\.md$/i, "")
    .replace(/\/01$/i, "");
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function titleParts(title: string): string[] {
  return title
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function asCandidate(article: CatalogArticle): ArticleCandidate {
  return { path: article.path, title: article.title };
}

function uniqueByPath(articles: CatalogArticle[]): CatalogArticle[] {
  const seen = new Set<string>();
  const out: CatalogArticle[] = [];
  for (const article of articles) {
    if (seen.has(article.path)) continue;
    seen.add(article.path);
    out.push(article);
  }
  return out;
}

function decide(
  hits: CatalogArticle[],
  resolvedFrom: ResolvedFrom,
): ArticleMatch | null {
  const unique = uniqueByPath(hits).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  if (unique.length === 1) {
    const one = unique[0]!;
    return {
      status: "resolved",
      path: one.path,
      title: one.title,
      resolvedFrom,
    };
  }
  if (unique.length > 1) {
    return {
      status: "ambiguous",
      resolvedFrom,
      candidates: unique.slice(0, MAX_CANDIDATES).map(asCandidate),
    };
  }
  return null;
}

function exactHit(
  cleaned: string,
  articles: CatalogArticle[],
): ArticleMatch | null {
  const want = cleaned.toLowerCase();
  const found = articles.find((article) => article.path.toLowerCase() === want);
  if (!found) return null;
  return { status: "exact", path: found.path, title: found.title };
}

function pluralVariants(key: string): string[] {
  const out: string[] = [];
  if (key.length > 2 && key.endsWith("es")) out.push(key.slice(0, -2));
  if (key.length > 1 && key.endsWith("s")) out.push(key.slice(0, -1));
  out.push(`${key}s`, `${key}es`);
  return [...new Set(out)].filter((variant) => variant && variant !== key);
}

function titleWordKeys(title: string): string[] {
  return title
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => matchKey(word))
    .filter((word) => word.length > 0);
}

/** The term is one word, or several title words joined, not a piece of a word. */
function appearsAsWholeWords(title: string, term: string): boolean {
  if (term.length < 3) return false;
  const words = titleWordKeys(title);
  for (let start = 0; start < words.length; start++) {
    let joined = "";
    for (let end = start; end < words.length; end++) {
      joined += words[end] ?? "";
      if (joined === term) return true;
      if (joined.length >= term.length) break;
    }
  }
  return false;
}

function candidatesOf(articles: CatalogArticle[]): ArticleCandidate[] {
  return uniqueByPath(articles)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_CANDIDATES)
    .map(asCandidate);
}

/**
 * One whole-word title match is a partial resolve. Two or more, or a match
 * that only sits inside a word, stay candidates.
 */
function partialTitleMatch(
  term: string,
  articles: CatalogArticle[],
): ArticleMatch | null {
  if (term.length >= 3) {
    const whole = articles.filter((article) =>
      appearsAsWholeWords(article.title, term),
    );
    if (whole.length === 1) {
      const one = whole[0]!;
      return {
        status: "resolved",
        path: one.path,
        title: one.title,
        resolvedFrom: "partial",
        note: PARTIAL_TITLE_NOTE,
      };
    }
    if (whole.length > 1) {
      return {
        status: "ambiguous",
        resolvedFrom: "title",
        candidates: candidatesOf(whole),
      };
    }
  }

  if (term.length >= 4) {
    const inside = articles.filter((article) =>
      matchKey(article.title).includes(term),
    );
    if (inside.length > 0) {
      return {
        status: "ambiguous",
        resolvedFrom: "title",
        candidates: candidatesOf(inside),
      };
    }
  }

  return null;
}

/**
 * Resolve a Translation Words path against one language's catalog.
 * `path` must already be the return value of `prepareArticlePath`.
 */
export function resolveTwArticle(
  path: string,
  articles: CatalogArticle[],
): ArticleMatch {
  const cleaned = cleanTw(assertPreparedArticlePath(path));
  const exact = exactHit(cleaned, articles);
  if (exact) return exact;

  const term = matchKey(lastSegment(cleaned));
  if (!term) return { status: "miss" };

  const byFile = articles.filter(
    (article) => matchKey(lastSegment(article.path)) === term,
  );
  const fileHit = decide(byFile, "category");
  if (fileHit) return fileHit;

  const byTitle = articles.filter((article) =>
    titleParts(article.title).some((part) => matchKey(part) === term),
  );
  const titleHit = decide(byTitle, "title");
  if (titleHit) return titleHit;

  const wanted = new Set(pluralVariants(term));
  const byPlural = articles.filter((article) =>
    wanted.has(matchKey(lastSegment(article.path))),
  );
  const pluralHit = decide(byPlural, "plural");
  if (pluralHit) return pluralHit;

  return partialTitleMatch(term, articles) ?? { status: "miss" };
}

/**
 * Resolve a Translation Academy path against one language's catalog.
 * `path` must already be the return value of `prepareArticlePath`.
 */
export function resolveTaArticle(
  path: string,
  articles: CatalogArticle[],
): ArticleMatch {
  const cleaned = cleanTa(assertPreparedArticlePath(path));
  const exact = exactHit(cleaned, articles);
  if (exact) return exact;

  const slug = lastSegment(cleaned).toLowerCase();
  if (!slug) return { status: "miss" };

  const bySlug = articles.filter((article) => {
    const path = article.path.toLowerCase();
    return path === slug || path.endsWith(`/${slug}`);
  });
  const slugHit = decide(bySlug, "manual");
  if (slugHit) return slugHit;

  const exactTitle = articles.filter(
    (article) => article.title.trim().toLowerCase() === slug,
  );
  const titleHit = decide(exactTitle, "title");
  if (titleHit) return titleHit;

  const partial = articles.filter((article) =>
    article.title.toLowerCase().includes(slug),
  );
  const partialHit = decide(partial, "title");
  if (partialHit) return partialHit;

  return { status: "miss" };
}
