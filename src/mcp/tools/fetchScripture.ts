/**
 * fetch_scripture — retrieve Bible text in USFM or plain text.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  type ToolModule,
} from "./shared.js";
import { Errors } from "../../core/errors.js";
import { catalogSearch } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import { parseReferenceForTool } from "../../core/resources/referenceParser.js";
import { extractVerses } from "../../core/parsers/usfm.js";
import type { Env } from "../agent.js";

/** DCS subject values that represent Bible text resources. */
const SCRIPTURE_SUBJECTS = "Aligned Bible,Bible";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  format: z
    .enum(["usfm", "text"])
    .default("text")
    .describe('"text" = plain prose (default), "usfm" = raw USFM markup.'),
});

export type FetchScriptureParams = z.infer<typeof inputSchema>;

const outputSchema = {
  reference: z.string(),
  language: z.string(),
  book: z.string(),
  chapter: z.string(),
  verse: z.string().nullable(),
  format: z.string(),
  versions: z.array(
    z.object({
      resourceType: z.string(),
      text: z.string(),
      source: z.string(),
    }),
  ),
  requestId: z.string(),
};

export const fetchScriptureTool: ToolModule<typeof inputSchema> = {
  name: "fetch_scripture",
  description:
    "Fetch Bible text for a specific reference. " +
    "Discovers all scripture versions available for the language via the catalog (topic=tc-ready, subject=Aligned Bible/Bible) " +
    "and returns every found version — no need to specify a resource type. " +
    "Returns a `versions` array where each entry has `resourceType` (e.g. ult, ust, glt), `text`, and `source`. " +
    "Use `reference` like \"JHN 3:16\" for a verse, \"JHN 3:16-18\" for a range, or \"MAT 5\" for a whole chapter. " +
    "Limitation: fetches all available versions; if only one translation type is needed prefer get_bundle for combined context.",
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Scripture",
  },

  async handler(params: FetchScriptureParams, env: Env, requestId: string) {
    const { reference, language, format } = params;

    const parsed = parseReferenceForTool(reference);
    if (!parsed) {
      throw Errors.invalidReference(reference);
    }
    const { book, chapter, verseStart, verseEnd } = parsed;

    // Discover all scripture resources for this language from the catalog.
    // topic=tc-ready is always applied by catalogSearch; no hardcoded type list.
    const entries = await catalogSearch({
      lang: language,
      subject: SCRIPTURE_SUBJECTS,
      kv: env.TRANSLATION_HELPS_CACHE ?? null,
    });

    if (entries.length === 0) {
      throw Errors.resourceNotFound(`Scripture for language "${language}"`);
    }

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });

    // Fetch every discovered resource concurrently
    const settled = await Promise.allSettled(
      entries.map(async (entry) => {
        const zipUrl =
          entry.catalog?.prod?.zipball_url ??
          `https://git.door43.org/${entry.owner}/${entry.repo}/archive/${entry.catalog?.prod?.branch_or_tag_name ?? "master"}.zip`;

        const zipBuffer = await fetcher.getOrDownloadZip(zipUrl);

        const bookPaths = [`${book}.usfm`, `${book.toLowerCase()}.usfm`];
        for (const ingredient of entry.ingredients) {
          if (
            ingredient.identifier?.toUpperCase() === book ||
            ingredient.path?.toUpperCase().includes(book)
          ) {
            bookPaths.unshift(ingredient.path.replace(/^\.\//, ""));
          }
        }

        let usfmContent: string | null = null;
        for (const path of bookPaths) {
          usfmContent = await fetcher.extractFileFromZip(zipBuffer, path);
          if (usfmContent) break;
        }

        if (!usfmContent) return null;

        const text = extractVerses(usfmContent, chapter, verseStart, verseEnd, format);
        // Derive a friendly resource type label from the repo name (e.g. "en_ult" → "ult")
        const resourceType = entry.abbreviation ?? entry.repo.replace(/^[a-z]+_/, "");
        return { resourceType, text, source: zipUrl };
      }),
    );

    const versions = settled
      .filter(
        (r): r is PromiseFulfilledResult<{ resourceType: string; text: string; source: string }> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value);

    if (versions.length === 0) {
      throw Errors.resourceNotFound(
        `Book "${book}" in scripture resources for language "${language}"`,
      );
    }

    const verse = verseStart
      ? verseEnd
        ? `${verseStart}-${verseEnd}`
        : verseStart
      : null;

    return ok(
      { reference, language, book, chapter, verse, format, versions, requestId },
      `Scripture ${reference} (${language}) — ${versions.map((v) => v.resourceType).join(", ")}`,
    );
  },
};

