/**
 * GET /api/v1/scripture?reference=&language=&format=text|usfm&all=1
 *
 * Returns scripture versions for the language. By default caps to one
 * literal + one simplified + original (UGNT/UHB). Pass `?all=1` to include
 * every catalog Bible (BSB, T4T, etc.).
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
import { catalogSearch } from "@translation-helps/door43";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  extractVerses,
  usfmExtent,
  declaredLanguageFromIdLine,
  sameScriptureLanguage,
} from "@translation-helps/door43";
import type {
  ScriptureVersion,
  ScriptureVersionRole,
} from "@translation-helps/door43";
import {
  ingredientCoversBook,
  resolveScriptureVersionRole,
} from "@translation-helps/door43";
import type { ZipCacheSource } from "@translation-helps/door43";
import {
  coalesceInFlight,
  getCachedJson,
  putCachedJson,
  responseCacheKey,
} from "./responseCache.js";

const SCRIPTURE_SUBJECTS = "Aligned Bible,Bible";

export async function handleScripture(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;
  const format = (url.searchParams.get("format") ?? "text") as "text" | "usfm";
  const includeAll = url.searchParams.get("all") === "1";
  const t0 = Date.now();

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    ref = requireReferenceAndLanguage(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, book, chapter, verseStart, verseEnd } = ref;
  const requestedLanguage = ref.language;

  const verseStr = verseStart
    ? verseEnd
      ? `${verseStart}-${verseEnd}`
      : verseStart
    : undefined;

  const cacheKey = responseCacheKey(
    "scripture",
    requestedLanguage,
    book,
    chapter,
    verseStr,
    format,
    includeAll ? "all" : "primary",
    // Answers cached before a book's \id language was checked.
    "id-lang",
  );

  const cached = await getCachedJson<Record<string, unknown>>(
    env.TRANSLATION_HELPS_CACHE,
    cacheKey,
  );
  if (cached) {
    return json({
      ...cached.value,
      meta: {
        cache: "kv",
        timings: {
          totalMs: Date.now() - t0,
          catalogMs: 0,
          zipMs: 0,
          parseMs: 0,
        },
      },
    });
  }

  type Built =
    | {
        ok: true;
        payload: Record<string, unknown>;
        cache: "memory" | "r2" | "network" | "kv" | "mixed";
        timings: { catalogMs: number; zipMs: number; parseMs: number };
      }
    | { ok: false; message: string };

  const body = await coalesceInFlight(cacheKey, async (): Promise<Built> => {
    const again = await getCachedJson<Record<string, unknown>>(
      env.TRANSLATION_HELPS_CACHE,
      cacheKey,
    );
    if (again) {
      return {
        ok: true,
        payload: again.value,
        cache: "kv",
        timings: { catalogMs: 0, zipMs: 0, parseMs: 0 },
      };
    }

    const tCatalog = Date.now();

    // Original-language catalog does not depend on gateway resolution — run in parallel.
    const originalSubject = isNtBook(book)
      ? "Greek New Testament"
      : "Hebrew Old Testament";
    const originalLang = isNtBook(book) ? "el-x-koine" : "hbo";

    const [variantResult, originalEntries] = await Promise.all([
      resolveLanguageVariant(
        requestedLanguage,
        SCRIPTURE_SUBJECTS,
        env.TRANSLATION_HELPS_CACHE,
      ),
      catalogSearch({
        lang: originalLang,
        subject: originalSubject,
        kv: env.TRANSLATION_HELPS_CACHE,
      }),
    ]);

    const catalogMs = Date.now() - tCatalog;
    const { language, entries } = variantResult;

    // If no translation exists even after variant fallback, return 404 immediately.
    // We must NOT fall back to the original language here — returning Greek/Hebrew
    // when the user asked for (e.g.) es-419 would silently mislead callers into
    // thinking a translation is available when it is not.
    if (entries.length === 0) {
      return {
        ok: false,
        message:
          `No scripture translation available for language "${requestedLanguage}". ` +
          `Try "en" or check which languages are available for this resource.`,
      };
    }

    // Cap fan-out: one literal + one simplified (prefer unfoldingWord), unless
    // ?all=1. A version whose catalog entry says it lacks the book is not
    // fetched. A book whose \id line declares another language is treated
    // the same way, and the next version of that role is tried.
    const fetcher = makeFetcher(env, execCtx);
    const zipSources: ZipCacheSource[] = [];
    // How far the book goes in each version that has it but not the passage.
    const extents: BookExtent[] = [];
    const knownUsfm = new Map<CatalogEntry, string | null>();

    const readBook = async (entry: CatalogEntry): Promise<string | null> => {
      const cached = knownUsfm.get(entry);
      if (cached !== undefined) return cached;
      let usfm: string | null = null;
      try {
        const zipUrl = zipUrlFromEntry(entry);
        const bookPaths = buildBookPaths(entry, book, "", ".usfm");
        for (const p of bookPaths) {
          usfm = await fetcher.getFileText(zipUrl, p);
          if (usfm) break;
        }
        if (fetcher.lastCacheSource) zipSources.push(fetcher.lastCacheSource);
      } catch {
        usfm = null;
      }
      knownUsfm.set(entry, usfm);
      return usfm;
    };

    const usfmOf = (entry: CatalogEntry) =>
      knownUsfm.has(entry) ? (knownUsfm.get(entry) ?? null) : undefined;

    const tZip = Date.now();
    const originalReads = Promise.all(
      originalEntries.map(async (entry) => ({
        entry,
        usfm: await readBook(entry),
      })),
    );

    let decision = scriptureVersionsForBook(entries, book, language, usfmOf, {
      includeAll,
    });
    for (let round = 0; round <= entries.length; round++) {
      const pending = decision.picked.filter((entry) => !knownUsfm.has(entry));
      if (pending.length === 0) break;
      await Promise.all(pending.map((entry) => readBook(entry)));
      decision = scriptureVersionsForBook(entries, book, language, usfmOf, {
        includeAll,
      });
    }

    const cappedEntries = decision.picked;
    const versionsNote = decision.versionsNote;
    const originals = await originalReads;

    const settled = await Promise.allSettled(
      [
        ...cappedEntries.map((entry) => ({
          entry,
          isOriginal: false,
          usfm: knownUsfm.get(entry) ?? null,
        })),
        ...originals.map(({ entry, usfm }) => ({
          entry,
          isOriginal: true,
          usfm,
        })),
      ].map(async ({ entry, isOriginal, usfm }) => {
        if (!usfm) return null;
        // After the USFM is in hand, before the verses are taken out of it.
        if (!isOriginal) {
          const declared = declaredLanguageFromIdLine(usfm);
          if (declared && !sameScriptureLanguage(language, declared)) {
            return null;
          }
        }

        const text = extractVerses(usfm, chapter, verseStart, verseEnd, format);
        if (text === null) {
          extents.push(usfmExtent(usfm, chapter));
          return null;
        }
        const abbrev = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
        const role: ScriptureVersionRole = isOriginal
          ? "original"
          : resolveScriptureVersionRole(abbrev);

        return {
          resourceType: abbrev,
          role,
          text,
          source: zipUrlFromEntry(entry),
        } as ScriptureVersion;
      }),
    );
    const zipMs = Date.now() - tZip;
    const parseMs = 0;

    const versions: ScriptureVersion[] = settled
      .filter(
        (r): r is PromiseFulfilledResult<ScriptureVersion> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value);

    if (versions.length === 0) {
      return {
        ok: false,
        message: missingPassageMessage({
          reference,
          book,
          chapter,
          verseStart,
          language,
          extents,
        }),
      };
    }

    const payload = {
      reference,
      language,
      book,
      chapter,
      verse: verseStr ?? null,
      format,
      versions,
      ...(versionsNote ? { versionsNote } : {}),
    };
    putCachedJson(env.TRANSLATION_HELPS_CACHE, cacheKey, payload, execCtx);
    return {
      ok: true,
      payload,
      cache: aggregateZipSources(zipSources),
      timings: { catalogMs, zipMs, parseMs },
    };
  });

  if (!body.ok) {
    return apiError("NOT_FOUND", body.message, 404);
  }

  return json({
    ...body.payload,
    meta: {
      cache: body.cache,
      timings: { ...body.timings, totalMs: Date.now() - t0 },
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BookExtent = ReturnType<typeof usfmExtent>;

/**
 * Why no version had the passage, in words the caller can act on. `extents`
 * holds how far the book goes in each version that has the book: when it is
 * empty the book itself is missing; otherwise the chapter or the verse is past
 * the end, and saying which keeps a model from concluding the book is absent.
 */
export function missingPassageMessage(args: {
  reference: string;
  book: string;
  chapter: string;
  verseStart?: string;
  language: string;
  extents: BookExtent[];
}): string {
  const { reference, book, chapter, verseStart, language, extents } = args;
  if (extents.length === 0) {
    return `Book "${book}" not found in any scripture resource for "${language}"`;
  }

  const chapters = Math.max(...extents.map((e) => e.chapters));
  const lastVerse = Math.max(...extents.map((e) => e.lastVerse ?? 0));
  if (lastVerse === 0) {
    return (
      `"${reference}" does not exist: ${book} has ${chapters} ` +
      `chapter${chapters === 1 ? "" : "s"}, so there is no chapter ${chapter}.`
    );
  }
  if (verseStart && parseInt(verseStart, 10) > lastVerse) {
    return (
      `"${reference}" does not exist: ${book} ${chapter} has ${lastVerse} ` +
      `verses, so there is no verse ${verseStart}.`
    );
  }
  return `"${reference}" has no text in any scripture resource for "${language}", though ${book} ${chapter} exists there.`;
}

/** How many gateway-language versions a request gets unless it asks for all. */
const PRIMARY_VERSIONS = 2;

function abbrevOf(entry: CatalogEntry): string {
  return (
    entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "")
  ).toLowerCase();
}

/**
 * Whether a version can have the book. One whose catalog entry lists its
 * books and leaves this one out cannot (the published ULT has no Isaiah yet);
 * one that lists no books is given the benefit of the doubt.
 */
function hasBook(entry: CatalogEntry, book: string): boolean {
  return ingredientCoversBook(entry.ingredients, book) !== false;
}

/**
 * One literal (ULT/GLT) and one simplified (UST/GST), unfoldingWord first.
 * With `book`, only versions that have the book are considered, and a place
 * left empty goes to another version that has it, so a book the literal or
 * the simplified version lacks still comes back in the reader's language.
 */
export function pickPrimaryScriptureEntries(
  entries: CatalogEntry[],
  book?: string,
): CatalogEntry[] {
  const scored = entries
    .filter((entry) => book === undefined || hasBook(entry, book))
    .map((entry) => ({
      entry,
      role: resolveScriptureVersionRole(abbrevOf(entry)),
      uwBonus: entry.owner === "unfoldingWord" ? 0 : 1,
    }))
    // Stable: unfoldingWord's first, the catalog's order within each group.
    .sort((a, b) => a.uwBonus - b.uwBonus);

  const picked: CatalogEntry[] = [];
  for (const role of ["literal", "simplified"] as const) {
    const match = scored.find((s) => s.role === role);
    if (match) picked.push(match.entry);
  }
  for (const { entry } of scored) {
    if (picked.length >= PRIMARY_VERSIONS) break;
    if (!picked.includes(entry)) picked.push(entry);
  }
  return picked;
}

/**
 * Says so when the versions a caller would expect do not have the book:
 * which ones, and what was given in their place, if anything. Null when the
 * usual literal and simplified versions were used.
 */
export function describeStandIns(
  entries: CatalogEntry[],
  picked: CatalogEntry[],
  book: string,
  language: string,
): string | null {
  const label = (entry: CatalogEntry) => {
    const abbrev = abbrevOf(entry);
    const role = resolveScriptureVersionRole(abbrev);
    return role === "other"
      ? abbrev.toUpperCase()
      : `${abbrev.toUpperCase()} (${role})`;
  };
  const list = (group: CatalogEntry[]) => group.map(label).join(" and ");

  // What the caller would get if every version had every book.
  const usual = pickPrimaryScriptureEntries(entries);
  const lacking = usual.filter((entry) => !picked.includes(entry));
  if (lacking.length === 0) return null;

  const verb = lacking.length === 1 ? "does" : "do";
  const standIns = picked.filter((entry) => !usual.includes(entry));
  return standIns.length > 0
    ? `The ${list(lacking)} ${verb} not include ${book} yet; the ${list(standIns)} ${standIns.length === 1 ? "is" : "are"} given in ${lacking.length === 1 ? "its" : "their"} place.`
    : `The ${list(lacking)} ${verb} not include ${book} yet, and no other "${language}" version has it.`;
}

/**
 * One literal and one simplified version of `book`, skipping a book whose
 * `\id` line declares another language and taking the next version of
 * that role. `usfmOf` returns the book text, null when the file is missing,
 * or undefined when it has not been read yet (still eligible, so the caller
 * can fetch it). With `includeAll`, every book that passes is returned.
 */
export function scriptureVersionsForBook(
  entries: CatalogEntry[],
  book: string,
  language: string,
  usfmOf: (entry: CatalogEntry) => string | null | undefined,
  options?: { includeAll?: boolean },
): { picked: CatalogEntry[]; versionsNote: string | null } {
  const includeAll = options?.includeAll === true;
  const discarded: { entry: CatalogEntry; declared: string }[] = [];
  const eligible = entries.filter((entry) => {
    if (!hasBook(entry, book)) return false;
    const usfm = usfmOf(entry);
    if (typeof usfm !== "string") return true;
    const declared = declaredLanguageFromIdLine(usfm);
    if (!declared || sameScriptureLanguage(language, declared)) return true;
    discarded.push({ entry, declared });
    return false;
  });
  const picked = includeAll
    ? eligible
    : pickPrimaryScriptureEntries(eligible, book);

  if (discarded.length === 0) {
    return {
      picked,
      versionsNote: includeAll
        ? null
        : describeStandIns(entries, picked, book, language),
    };
  }

  const why = discarded
    .map(
      (item) =>
        `${abbrevOf(item.entry).toUpperCase()}: the book is in ${item.declared}`,
    )
    .join(". ");
  const usual = pickPrimaryScriptureEntries(entries);
  const standIns = picked.filter((entry) => !usual.includes(entry));
  const catalogNote = includeAll
    ? null
    : describeStandIns(
        entries.filter(
          (entry) => !discarded.some((item) => item.entry === entry),
        ),
        picked,
        book,
        language,
      );

  let languageNote = `${why}.`;
  if (!includeAll && standIns.length > 0 && !catalogNote) {
    const list = standIns.map(versionLabel).join(" and ");
    const verb = standIns.length === 1 ? "is" : "are";
    const whose = discarded.length === 1 ? "its" : "their";
    languageNote = `${why}; the ${list} ${verb} given in ${whose} place.`;
  }

  return {
    picked,
    versionsNote: catalogNote ? `${languageNote} ${catalogNote}` : languageNote,
  };
}

function versionLabel(entry: CatalogEntry): string {
  const abbrev = abbrevOf(entry);
  const role = resolveScriptureVersionRole(abbrev);
  return role === "other"
    ? abbrev.toUpperCase()
    : `${abbrev.toUpperCase()} (${role})`;
}

function aggregateZipSources(
  sources: ZipCacheSource[],
): "memory" | "r2" | "network" | "kv" | "mixed" {
  if (sources.length === 0) return "network";
  const uniq = new Set(sources);
  if (uniq.size === 1) return sources[0];
  // Prefer reporting the "worst" (network) if any download happened
  if (uniq.has("network")) return "network";
  if (uniq.has("r2")) return "r2";
  if (uniq.has("kv")) return "kv";
  return "mixed";
}

const NT_BOOKS = new Set([
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
]);

function isNtBook(book: string): boolean {
  return NT_BOOKS.has(book.toUpperCase());
}
