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
  resolveLanguageVariant,
  zipUrlFromEntry,
  buildBookPaths,
} from "./helpers.js";
import { parseTranslationNotesTsv } from "@translation-helps/door43";
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

export async function handleNotes(ctx: RouteContext): Promise<Response> {
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
    "notes",
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
    // Normalize in case an older cache entry still has literal `\n` escapes.
    return json({
      ...normalizeNotesPayload(cached.value),
      meta: { cache: "kv" },
    });
  }

  const body = await coalesceInFlight(cacheKey, async () => {
    // Re-check KV inside the coalesced builder (another isolate may have written).
    const again = await getCachedJson<Record<string, unknown>>(
      env.TRANSLATION_HELPS_CACHE,
      cacheKey,
    );
    if (again) return { payload: again.value, cache: "kv" as const };

    const { language, entries } = await resolveLanguageVariant(
      requestedLanguage,
      "TSV Translation Notes",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (entries.length === 0) {
      return {
        payload: { reference, language, book, chapter, notes: [] },
        cache: "network" as const,
      };
    }

    const entry =
      entries.find((e) => e.owner === "unfoldingWord") ?? entries[0];
    const zipUrl = zipUrlFromEntry(entry);

    const fetcher = makeFetcher(env, execCtx);
    const paths = buildBookPaths(entry, book, "tn_", ".tsv");

    let tsv: string | null = null;
    for (const p of paths) {
      tsv = await fetcher.getFileText(zipUrl, p);
      if (tsv) break;
    }
    const zipSource = fetcher.lastCacheSource ?? "network";

    if (!tsv) {
      return {
        payload: { reference, language, book, chapter, notes: [] },
        cache: zipSource,
      };
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
      batchGatewayQuotes(alignmentRows, book, language, env, execCtx),
      getArticleTitleMap("ta", language, env),
    ]);

    // Enrich with article titles + gateway quotes
    const enriched = rows.map((row) => ({
      ...row,
      supportReferenceTitle: row.supportReference
        ? (resolveTitleFromToc(taMap, row.supportReference, "ta") ??
          resolveTitleFromPath(row.supportReference))
        : null,
      gatewayQuote: {
        original: row.quote ? formatQuoteDisplay(row.quote) : row.quote,
        aligned:
          gatewayMap.get(
            alignmentKey({
              chapter: row.chapter,
              verse: row.verse,
              quote: row.quote,
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
      notes: enriched,
    };
    putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
    return { payload, cache: zipSource };
  });

  return json({
    ...normalizeNotesPayload(body.payload),
    meta: { cache: body.cache },
  });
}

/** Ensure note bodies have real newlines (older KV entries may still have `\n` escapes). */
function normalizeNotesPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const notes = payload.notes;
  if (!Array.isArray(notes)) return payload;
  return {
    ...payload,
    notes: notes.map((n) => {
      if (!n || typeof n !== "object") return n;
      const row = n as Record<string, unknown>;
      if (typeof row.note !== "string") return row;
      return {
        ...row,
        note: row.note.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n"),
      };
    }),
  };
}
