/**
 * GET /api/v1/word-links?reference=&language=
 *
 * Returns all TWL rows for the reference.
 * Enriched with twTitle (from articleTitles) after port-title-resolver step.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  requireReferenceAndLanguage,
  makeFetcher,
  getResourceZipUrl,
  buildBookPaths,
} from "./helpers.js";
import { parseTranslationWordLinksTsv } from "../../core/parsers/tsv.js";
import { resolveTitleFromPath } from "../../core/resources/articleTitles.js";
import { getArticleTitleMap, resolveTitleFromToc } from "../../core/resources/articleToc.js";
import { batchGatewayQuotes, alignmentKey, formatQuoteDisplay } from "./alignmentHelper.js";

export async function handleWordLinks(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    ref = requireReferenceAndLanguage(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, language, book, chapter, verseStart } = ref;

  const resolved = await getResourceZipUrl(
    language,
    "TSV Translation Words Links",
    "unfoldingWord",
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({ reference, language, book, chapter, wordLinks: [] });
  }

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const paths = buildBookPaths(resolved.entry, book, "twl_", ".tsv");

  let tsv: string | null = null;
  for (const p of paths) {
    tsv = await fetcher.extractFileFromZip(zip, p);
    if (tsv) break;
  }
  if (!tsv) {
    return json({ reference, language, book, chapter, wordLinks: [] });
  }

  const rows = parseTranslationWordLinksTsv(tsv, chapter, verseStart);

  // Batch compute aligned gateway quotes (best-effort; empty string on failure)
  const alignmentRows = rows.map((r) => ({
    chapter: r.chapter,
    verse: r.verse,
    quote: r.origWords,
    occurrence: r.occurrence,
  }));
  const [gatewayMap, twMap] = await Promise.all([
    batchGatewayQuotes(alignmentRows, book, language, env),
    getArticleTitleMap("tw", language, env),
  ]);

  const enriched = rows.map((row) => ({
    ...row,
    twTitle: row.wordPath
      ? (resolveTitleFromToc(twMap, row.wordPath, "tw") ?? resolveTitleFromPath(row.wordPath))
      : null,
    gatewayQuote: {
      original: row.origWords ? formatQuoteDisplay(row.origWords) : row.origWords,
      aligned: gatewayMap.get(alignmentKey({ chapter: row.chapter, verse: row.verse, quote: row.origWords, occurrence: row.occurrence })) ?? "",
    },
  }));

  return json({ reference, language, book, chapter, verse: verseStart ?? null, wordLinks: enriched });
}
