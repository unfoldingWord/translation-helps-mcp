/**
 * GET /api/v1/questions?reference=&language=
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  requireReferenceAndLanguage,
  makeFetcher,
  getResourceZipUrl,
  buildBookPaths,
} from "./helpers.js";
import { parseTranslationQuestionsTsv } from "../../core/parsers/tsv.js";

export async function handleQuestions(ctx: RouteContext): Promise<Response> {
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
    "TSV Translation Questions",
    "unfoldingWord",
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({ reference, language, book, chapter, questions: [] });
  }

  const fetcher = makeFetcher(env);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
  const paths = buildBookPaths(resolved.entry, book, "tq_", ".tsv");

  let tsv: string | null = null;
  for (const p of paths) {
    tsv = await fetcher.extractFileFromZip(zip, p);
    if (tsv) break;
  }
  if (!tsv) {
    return json({ reference, language, book, chapter, questions: [] });
  }

  const questions = parseTranslationQuestionsTsv(tsv, chapter, verseStart);
  return json({ reference, language, book, chapter, verse: verseStart ?? null, questions });
}
