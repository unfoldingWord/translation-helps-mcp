/**
 * GET /api/v1/questions?reference=&language=
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
import { parseTranslationQuestionsTsv } from "@translation-helps/door43";
import {
  coalesceInFlight,
  getCachedJson,
  putCachedJson,
  responseCacheKey,
} from "./responseCache.js";

export async function handleQuestions(ctx: RouteContext): Promise<Response> {
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
    "questions",
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
      "TSV Translation Questions",
      env.TRANSLATION_HELPS_CACHE,
    );
    if (entries.length === 0) {
      return {
        payload: { reference, language, book, chapter, questions: [] },
        cache: "network" as const,
      };
    }

    const entry =
      entries.find((e) => e.owner === "unfoldingWord") ?? entries[0];
    const zipUrl = zipUrlFromEntry(entry);

    const fetcher = makeFetcher(env, execCtx);
    const paths = buildBookPaths(entry, book, "tq_", ".tsv");

    let tsv: string | null = null;
    for (const p of paths) {
      tsv = await fetcher.getFileText(zipUrl, p);
      if (tsv) break;
    }
    const zipSource = fetcher.lastCacheSource ?? "network";
    if (!tsv) {
      return {
        payload: { reference, language, book, chapter, questions: [] },
        cache: zipSource,
      };
    }

    const questions = parseTranslationQuestionsTsv(tsv, chapter, verseStart);
    const payload = {
      reference,
      language,
      book,
      chapter,
      verse: verseStart ?? null,
      questions,
    };
    putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
    return { payload, cache: zipSource };
  });

  return json({ ...body.payload, meta: { cache: body.cache } });
}
