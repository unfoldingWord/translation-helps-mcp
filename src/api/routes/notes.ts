/**
 * GET /api/v1/notes?reference=&language=
 *
 * Returns all TN rows for the reference (verse-level or chapter/intro).
 * Enriched with supportReferenceTitle (from articleTitles) after
 * port-title-resolver step; gatewayQuote from port-alignment-quote step.
 *
 * A book alone is 400. `fields=index` is the compact whole-book read the
 * worker allows only for an internal caller: id, quote, support reference
 * and an intro heading, with no note body and no gateway alignment. It uses
 * the same route, so the same rate limit.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  resolveNotesQuery,
  makeFetcher,
  resolveLanguageVariant,
  zipUrlFromEntry,
  buildBookPaths,
  pickPreferredCatalogEntry,
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
  cacheVerse,
} from "./responseCache.js";
import { notesFromViews, packViewsOf } from "./packViews.js";

export async function handleNotes(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;

  let ref: ReturnType<typeof resolveNotesQuery>;
  try {
    ref = resolveNotesQuery(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const {
    reference,
    language: requestedLanguage,
    book,
    chapter,
    verseStart,
    verseEnd,
    endChapter,
    wholeBook,
    indexMode,
  } = ref;

  // The language packs' views first: the notes with their words already found, in a few KB.
  // Views are one chapter file, so a cross-chapter range stays on the TSV path.
  // Index mode must not return those bodies, so it stays on the compact TSV path.
  const views = packViewsOf(env);
  if (views && !endChapter && !wholeBook && !indexMode) {
    const fromPack = await notesFromViews(views, {
      language: requestedLanguage,
      book,
      chapter,
      verseStart,
      verseEnd,
    });
    if (fromPack) {
      return json({
        reference,
        language: fromPack.language,
        book,
        chapter,
        verse: verseStart ?? null,
        notes: fromPack.notes,
        sources: fromPack.sources,
        meta: { cache: "pack" },
      });
    }
  }

  const cacheKey = responseCacheKey(
    "notes",
    requestedLanguage,
    book,
    chapter,
    cacheVerse(chapter, verseStart, verseEnd, endChapter),
    // A cached full book must not answer fields=index: that payload has bodies.
    ...(indexMode ? ["index"] : []),
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
        payload: unavailableNotes(
          reference,
          language,
          book,
          chapter,
          `No TSV Translation Notes resource available for language "${language}".`,
        ),
        cache: "network" as const,
      };
    }

    const entry = pickPreferredCatalogEntry(entries);
    if (!entry) {
      return {
        payload: unavailableNotes(
          reference,
          language,
          book,
          chapter,
          `No TSV Translation Notes resource available for language "${language}".`,
        ),
        cache: "network" as const,
      };
    }
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
        payload: unavailableNotes(
          reference,
          language,
          book,
          chapter,
          `No TSV Translation Notes file for "${book}" in language "${language}".`,
        ),
        cache: zipSource,
      };
    }

    const rows = parseTranslationNotesTsv(
      tsv,
      chapter,
      verseStart,
      verseEnd,
      endChapter,
    );

    if (indexMode) {
      const taMap = await getArticleTitleMap("ta", language, env);
      const payload = {
        reference,
        language,
        book,
        chapter,
        verse: verseStart ?? null,
        notes: rows.map((row) => indexNote(row, taMap)),
      };
      putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
      return { payload, cache: zipSource };
    }

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

/**
 * Same envelope whether the catalog has no entry or the zip has no file.
 * Callers treat `available: false` as "not available", not as an empty chapter.
 */
function unavailableNotes(
  reference: string,
  language: string,
  book: string,
  chapter: string,
  message: string,
): Record<string, unknown> {
  return {
    reference,
    language,
    book,
    chapter,
    notes: [],
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message,
  };
}

/** Index row: what th_get_passage_index keeps. The note body stays out. */
function indexNote(
  row: {
    book: string;
    chapter: string;
    verse: string;
    id: string;
    supportReference: string;
    quote: string;
    occurrence: string;
    note: string;
  },
  taMap: Map<string, string>,
): Record<string, unknown> {
  const heading = row.verse === "intro" ? markdownHeading(row.note) : "";
  return {
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    id: row.id,
    supportReference: row.supportReference,
    supportReferenceTitle: row.supportReference
      ? (resolveTitleFromToc(taMap, row.supportReference, "ta") ??
        resolveTitleFromPath(row.supportReference))
      : null,
    quote: row.quote ? formatQuoteDisplay(row.quote) : row.quote,
    occurrence: row.occurrence,
    ...(heading ? { heading } : {}),
  };
}

function markdownHeading(note: string): string {
  for (const line of note.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return "";
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
