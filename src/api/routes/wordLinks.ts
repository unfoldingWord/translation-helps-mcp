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
  resolveLanguageVariant,
  zipUrlFromEntry,
  buildBookPaths,
} from "./helpers.js";
import { parseTranslationWordLinksTsv } from "@translation-helps/door43";
import { resolveTitleFromPath } from "@translation-helps/door43";
import {
  getArticleTitleMap,
  resolveTitleFromToc,
} from "@translation-helps/door43";
import {
  batchGatewayQuotes,
  alignmentKey,
  formatQuoteDisplay,
} from "./alignmentHelper.js";
import {
  coalesceInFlight,
  getCachedJson,
  putCachedJson,
  responseCacheKey,
} from "./responseCache.js";

export async function handleWordLinks(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    ref = requireReferenceAndLanguage(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const {
    reference,
    language: requestedLanguage,
    book,
    chapter,
    verseStart,
  } = ref;

  const cacheKey = responseCacheKey(
    "word-links",
    requestedLanguage,
    book,
    chapter,
    verseStart,
  );

  const cached = await getCachedJson<Record<string, unknown>>(
    env.TRANSLATION_HELPS_CACHE,
    cacheKey,
  );
  if (cached) {
    return json({ ...cached.value, meta: { cache: "kv" } });
  }

  const body = await coalesceInFlight(cacheKey, async () => {
    const again = await getCachedJson<Record<string, unknown>>(
      env.TRANSLATION_HELPS_CACHE,
      cacheKey,
    );
    if (again) return { payload: again.value, cache: "kv" as const };

    const { language, entries } = await resolveLanguageVariant(
      requestedLanguage,
      "TSV Translation Words Links",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (entries.length === 0) {
      return {
        payload: { reference, language, book, chapter, wordLinks: [] },
        cache: "network" as const,
      };
    }

    const entry =
      entries.find((e) => e.owner === "unfoldingWord") ?? entries[0];
    const zipUrl = zipUrlFromEntry(entry);

    const fetcher = makeFetcher(env, execCtx);
    const paths = buildBookPaths(entry, book, "twl_", ".tsv");

    let tsv: string | null = null;
    for (const p of paths) {
      tsv = await fetcher.getFileText(zipUrl, p);
      if (tsv) break;
    }
    const zipSource = fetcher.lastCacheSource ?? "network";
    if (!tsv) {
      return {
        payload: { reference, language, book, chapter, wordLinks: [] },
        cache: zipSource,
      };
    }

    const rows = parseTranslationWordLinksTsv(tsv, chapter, verseStart);

    const alignmentRows = rows.map((r) => ({
      chapter: r.chapter,
      verse: r.verse,
      quote: r.origWords,
      occurrence: r.occurrence,
    }));
    const [gatewayMap, twMap] = await Promise.all([
      batchGatewayQuotes(alignmentRows, book, language, env, execCtx),
      getArticleTitleMap("tw", language, env),
    ]);

    const enriched = rows.map((row) => ({
      ...row,
      twTitle: row.wordPath
        ? (resolveTitleFromToc(twMap, row.wordPath, "tw") ??
          resolveTitleFromPath(row.wordPath))
        : null,
      gatewayQuote: {
        original: row.origWords
          ? formatQuoteDisplay(row.origWords)
          : row.origWords,
        aligned:
          gatewayMap.get(
            alignmentKey({
              chapter: row.chapter,
              verse: row.verse,
              quote: row.origWords,
              occurrence: row.occurrence,
            }),
          ) ?? "",
      },
    }));

    const payload = {
      reference,
      language,
      book,
      chapter,
      verse: verseStart ?? null,
      wordLinks: enriched,
    };
    putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
    return { payload, cache: zipSource };
  });

  return json({ ...body.payload, meta: { cache: body.cache } });
}
