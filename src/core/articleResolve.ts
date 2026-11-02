/**
 * Resolve a near-miss Translation Words or Translation Academy path.
 *
 * The exact catalog path is tried first. Resolution runs only when it is
 * absent. Callers must run `prepareArticlePath` (prefix strip, then
 * `assertSafeArticlePath`) before using the path to touch a zip.
 */

import { assertSafeArticlePath } from "./articlePath.js";

export type ResolvedFrom = "category" | "title" | "plural" | "manual";

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

/**
 * A bare term (no slash left after the known prefixes) may contain spaces
 * or apostrophes. Fold those into the comparison key before the allowlist.
 * A path that still has a slash keeps the strict check.
 */
function collapseBareTerm(path: string): string {
  if (path.includes("/") || !BARE_TERM_GAP.test(path)) return path;
  return path.toLowerCase().replace(TERM_NOISE, "");
}

/**
 * Strip known prefixes, fold a bare term, then the same safety check.
 * Throws TranslationHelpsError (INVALID_PARAMS) for anything unsafe.
 */
export function prepareArticlePath(raw: string): string {
  const stripped = percentDecoded(stripKnownArticlePrefix(raw).trim());
  return assertSafeArticlePath(collapseBareTerm(stripped));
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

/**
 * Resolve a Translation Words path against one language's catalog.
 * `raw` may still carry a known prefix; callers that read a zip must have
 * already passed the safety check on the stripped path.
 */
export function resolveTwArticle(
  raw: string,
  articles: CatalogArticle[],
): ArticleMatch {
  const cleaned = cleanTw(raw);
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

  if (term.length >= 4) {
    const contained = articles.filter((article) =>
      matchKey(article.title).includes(term),
    );
    const containedHit = contained.length
      ? {
          status: "ambiguous" as const,
          resolvedFrom: "title" as const,
          candidates: uniqueByPath(contained)
            .sort((a, b) => a.path.localeCompare(b.path))
            .slice(0, MAX_CANDIDATES)
            .map(asCandidate),
        }
      : null;
    if (containedHit) return containedHit;
  }

  return { status: "miss" };
}

/**
 * Resolve a Translation Academy path against one language's catalog.
 */
export function resolveTaArticle(
  raw: string,
  articles: CatalogArticle[],
): ArticleMatch {
  const cleaned = cleanTa(raw);
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
