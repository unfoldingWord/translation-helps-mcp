/**
 * GET /api/v1/scripture?reference=&language=&format=text|usfm
 *
 * Returns ALL scripture versions for the language (catalog-driven, no
 * hardcoded list). Also always includes the original-language text
 * (UGNT for NT, UHB for OT) with role:"original".
 *
 * Done in scripture-include-original step; this file provides the base.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import {
  requireReferenceAndLanguage,
  makeFetcher,
  zipUrlFromEntry,
  buildBookPaths,
  resolveLanguageVariant,
} from "./helpers.js";
import { catalogSearch } from "../../core/resources/dcsClient.js";
import { extractVerses } from "../../core/parsers/usfm.js";
import type { ScriptureVersion, ScriptureVersionRole } from "../../core/contracts/index.js";
import { resolveScriptureVersionRole } from "../../core/resources/scriptureRoles.js";

const SCRIPTURE_SUBJECTS = "Aligned Bible,Bible";

export async function handleScripture(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;
  const format = (url.searchParams.get("format") ?? "text") as "text" | "usfm";

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    ref = requireReferenceAndLanguage(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, book, chapter, verseStart, verseEnd } = ref;
  const requestedLanguage = ref.language;

  // Resolve effective language: falls back to a variant (e.g. es → es-419) when
  // the exact code has no resources. Zero overhead on the happy path — the first
  // catalogSearch is already L0+L1 cached; variant discovery is memoized globally.
  const { language, entries } = await resolveLanguageVariant(
    requestedLanguage,
    SCRIPTURE_SUBJECTS,
    env.TRANSLATION_HELPS_CACHE,
  );

  // If no translation exists even after variant fallback, return 404 immediately.
  // We must NOT fall back to the original language here — returning Greek/Hebrew
  // when the user asked for (e.g.) es-419 would silently mislead callers into
  // thinking a translation is available when it is not.
  if (entries.length === 0) {
    return apiError(
      "NOT_FOUND",
      `No scripture translation available for language "${requestedLanguage}". ` +
        `Try "en" or check which languages are available for this resource.`,
      404,
    );
  }

  // Also include original-language (UGNT for NT, UHB for OT) as alignment context,
  // but only when a translation was already found above.
  const originalSubject = isNtBook(book)
    ? "Greek New Testament"
    : "Hebrew Old Testament";
  const originalLang = isNtBook(book) ? "el-x-koine" : "hbo";

  const originalEntries = await catalogSearch({
    lang: originalLang,
    subject: originalSubject,
    kv: env.TRANSLATION_HELPS_CACHE,
  });

  const allEntries = [
    ...entries.map((e) => ({ entry: e, isOriginal: false })),
    ...originalEntries.map((e) => ({ entry: e, isOriginal: true })),
  ];

  const fetcher = makeFetcher(env);

  const settled = await Promise.allSettled(
    allEntries.map(async ({ entry, isOriginal }) => {
      const zipUrl = zipUrlFromEntry(entry);
      const zip = await fetcher.getOrDownloadZip(zipUrl);
      const bookPaths = buildBookPaths(entry, book, "", ".usfm");

      let usfm: string | null = null;
      for (const p of bookPaths) {
        usfm = await fetcher.extractFileFromZip(zip, p);
        if (usfm) break;
      }
      if (!usfm) return null;

      const text = extractVerses(usfm, chapter, verseStart, verseEnd, format);
      const abbrev = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
      const role: ScriptureVersionRole = isOriginal
        ? "original"
        : resolveScriptureVersionRole(abbrev);

      return {
        resourceType: abbrev,
        role,
        text,
        source: zipUrl,
      } as ScriptureVersion;
    }),
  );

  const versions: ScriptureVersion[] = settled
    .filter(
      (r): r is PromiseFulfilledResult<ScriptureVersion> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);

  if (versions.length === 0) {
    return apiError(
      "NOT_FOUND",
      `Book "${book}" not found in any scripture resource for "${language}"`,
      404,
    );
  }

  const verseStr = verseStart
    ? verseEnd
      ? `${verseStart}-${verseEnd}`
      : verseStart
    : undefined;

  return json({ reference, language, book, chapter, verse: verseStr ?? null, format, versions });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NT_BOOKS = new Set([
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL",
  "1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN",
  "3JN","JUD","REV",
]);

function isNtBook(book: string): boolean {
  return NT_BOOKS.has(book.toUpperCase());
}
