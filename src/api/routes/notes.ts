/**
 * GET /api/v1/notes?reference=&language=
 *
 * Returns all TN rows for the reference (verse-level or chapter/intro).
 * Enriched with supportReferenceTitle (from articleTitles) after
 * port-title-resolver step; gatewayQuote from port-alignment-quote step.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  requireReferenceAndLanguage,
  makeFetcher,
  getResourceZipUrl,
  buildBookPaths,
} from "./helpers.js";
import { parseTranslationNotesTsv } from "../../core/parsers/tsv.js";
import { resolveTitleFromPath } from "../../core/resources/articleTitles.js";
import { getArticleTitleMap, resolveTitleFromToc } from "../../core/resources/articleToc.js";
import { batchGatewayQuotes, alignmentKey, formatQuoteDisplay } from "./alignmentHelper.js";

export async function handleNotes(ctx: RouteContext): Promise<Response> {
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
    "TSV Translation Notes",
    "unfoldingWord",
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({ reference, language, book, chapter, notes: [] });
  }

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const paths = buildBookPaths(resolved.entry, book, "tn_", ".tsv");

  let tsv: string | null = null;
  for (const p of paths) {
    tsv = await fetcher.extractFileFromZip(zip, p);
    if (tsv) break;
  }

  if (!tsv) {
    return json({ reference, language, book, chapter, notes: [] });
  }

  const rows = parseTranslationNotesTsv(tsv, chapter, verseStart);

  // Batch compute aligned gateway quotes (best-effort; empty string on failure)
  const alignmentRows = rows.map((r) => ({
    chapter: r.chapter,
    verse: r.verse,
    quote: r.quote,
    occurrence: r.occurrence,
  }));
  const [gatewayMap, taMap] = await Promise.all([
    batchGatewayQuotes(alignmentRows, book, language, env),
    getArticleTitleMap("ta", language, env),
  ]);

  // Enrich with article titles + gateway quotes
  const enriched = rows.map((row) => ({
    ...row,
    supportReferenceTitle: row.supportReference
      ? (resolveTitleFromToc(taMap, row.supportReference, "ta") ?? resolveTitleFromPath(row.supportReference))
      : null,
    gatewayQuote: {
      original: row.quote ? formatQuoteDisplay(row.quote) : row.quote,
      aligned: gatewayMap.get(alignmentKey({ chapter: row.chapter, verse: row.verse, quote: row.quote, occurrence: row.occurrence })) ?? "",
    },
  }));

  return json({ reference, language, book, chapter, verse: verseStart ?? null, notes: enriched });
}
