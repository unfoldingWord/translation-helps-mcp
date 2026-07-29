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
import { extractVerses } from "@translation-helps/door43";
import type {
  ScriptureVersion,
  ScriptureVersionRole,
} from "@translation-helps/door43";
import { resolveScriptureVersionRole } from "@translation-helps/door43";
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

    // Cap fan-out: one literal + one simplified (prefer unfoldingWord), unless ?all=1
    const cappedEntries = includeAll
      ? entries
      : pickPrimaryScriptureEntries(entries);

    const allEntries = [
      ...cappedEntries.map((e) => ({ entry: e, isOriginal: false })),
      ...originalEntries.map((e) => ({ entry: e, isOriginal: true })),
    ];

    const fetcher = makeFetcher(env, execCtx);
    const zipSources: ZipCacheSource[] = [];

    const tZip = Date.now();
    const settled = await Promise.allSettled(
      allEntries.map(async ({ entry, isOriginal }) => {
        const zipUrl = zipUrlFromEntry(entry);
        const bookPaths = buildBookPaths(entry, book, "", ".usfm");

        let usfm: string | null = null;
        for (const p of bookPaths) {
          usfm = await fetcher.getFileText(zipUrl, p);
          if (usfm) break;
        }
        if (fetcher.lastCacheSource) zipSources.push(fetcher.lastCacheSource);
        if (!usfm) return null;

        const text = extractVerses(usfm, chapter, verseStart, verseEnd, format);
        if (text === null) return null;
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
        message: `Book "${book}" not found in any scripture resource for "${language}"`,
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

/**
 * Prefer one literal (ULT/GLT) + one simplified (UST/GST), unfoldingWord first.
 * Falls back to first remaining "other" Bible if a role is missing.
 */
function pickPrimaryScriptureEntries(entries: CatalogEntry[]): CatalogEntry[] {
  const scored = entries.map((entry) => {
    const abbrev = (
      entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "")
    ).toLowerCase();
    const role = resolveScriptureVersionRole(abbrev);
    const uwBonus = entry.owner === "unfoldingWord" ? 0 : 1;
    return { entry, abbrev, role, uwBonus };
  });

  const pickRole = (role: ScriptureVersionRole): CatalogEntry | undefined => {
    const matches = scored
      .filter((s) => s.role === role)
      .sort((a, b) => a.uwBonus - b.uwBonus);
    return matches[0]?.entry;
  };

  const picked: CatalogEntry[] = [];
  const literal = pickRole("literal");
  const simplified = pickRole("simplified");
  if (literal) picked.push(literal);
  if (simplified) picked.push(simplified);

  // If either role is missing, include the best remaining entry so the caller
  // still gets at least one gateway translation.
  if (picked.length === 0 && scored.length > 0) {
    const best = [...scored].sort((a, b) => a.uwBonus - b.uwBonus)[0];
    picked.push(best.entry);
  } else if (picked.length === 1 && scored.length > 1) {
    const used = new Set(picked);
    const fallback = scored.find((s) => !used.has(s.entry));
    if (fallback) picked.push(fallback.entry);
  }

  return picked;
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
