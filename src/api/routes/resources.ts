/**
 * GET /api/v1/resources?language=
 *
 * Returns a cheap availability summary: which resource types/versions exist
 * for a given language. Uses only catalog metadata (no zip fetching).
 * Powers the context availability summary in get_passage_context.
 */
import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { catalogSearch, resolveCatalogLanguage } from "../../core/resources/dcsClient.js";
import { resolveScriptureVersionRole } from "../../core/resources/scriptureRoles.js";

const ALL_SUBJECTS = [
  { subject: "Aligned Bible,Bible", type: "scripture" as const },
  { subject: "TSV Translation Notes", type: "notes" as const },
  { subject: "TSV Translation Words Links", type: "wordLinks" as const },
  { subject: "Translation Words", type: "words" as const },
  { subject: "Translation Academy", type: "academy" as const },
  { subject: "TSV Translation Questions", type: "questions" as const },
];

const NT_BOOKS = new Set([
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL",
  "1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN",
  "3JN","JUD","REV",
]);

export async function handleResources(ctx: RouteContext): Promise<Response> {
  const { url, env } = ctx;
  const requestedLanguage = url.searchParams.get("language");
  if (!requestedLanguage) return apiError("BAD_REQUEST", "Missing required param: language", 400);

  // Resolve effective language (variant fallback, e.g. "es" → "es-419").
  // Use the primary scripture subject for the initial resolution so the check
  // is consistent with get_passage; all subjects share the same memoized result.
  const { language } = await resolveCatalogLanguage(requestedLanguage, {
    subject: "Aligned Bible,Bible",
    kv: env.TRANSLATION_HELPS_CACHE,
  });

  const results = await Promise.allSettled(
    ALL_SUBJECTS.map(async ({ subject, type }) => {
      const entries = await catalogSearch({
        lang: language,
        subject,
        kv: env.TRANSLATION_HELPS_CACHE,
      });
      return { type, entries };
    }),
  );

  const available: Array<{
    type: string;
    subject: string;
    abbreviation: string;
    role: string;
  }> = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { type, entries } = result.value;
    for (const entry of entries) {
      const abbrev = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
      const role =
        type === "scripture"
          ? resolveScriptureVersionRole(abbrev)
          : type;
      available.push({
        type,
        subject: entry.subject ?? "",
        abbreviation: abbrev,
        role,
      });
    }
  }

  // Also check if original languages exist (for alignment support)
  const hasNt = NT_BOOKS.size > 0; // always true; we check per-request in /scripture
  const originalLangs = [
    { lang: "el-x-koine", subject: "Greek New Testament", label: "ugnt" },
    { lang: "hbo", subject: "Hebrew Old Testament", label: "uhb" },
  ];

  for (const { lang, subject, label } of originalLangs) {
    const entries = await catalogSearch({
      lang,
      subject,
      kv: env.TRANSLATION_HELPS_CACHE,
    });
    if (entries.length > 0) {
      available.push({ type: "scripture", subject, abbreviation: label, role: "original" });
    }
  }

  return json({ language, requestedLanguage, available });
}
