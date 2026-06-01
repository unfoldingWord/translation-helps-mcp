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
import { getResourceZipUrl } from "../../core/resources/dcsClient.js";
import { ZipResourceFetcher2 } from "../../core/resources/ZipResourceFetcher2.js";
import type { Env } from "../agent.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  organization: z
    .string()
    .default("unfoldingWord")
    .describe("Content organization on Door43 (default: unfoldingWord)."),
  resourceType: z
    .enum(["ult", "ust", "glt", "gst"])
    .default("ult")
    .describe(
      'Translation type: "ult" = Literal (word-for-word), "ust" = Simplified (meaning-based), ' +
        '"glt"/"gst" = Gateway Literal/Simplified used for non-English gateway languages.',
    ),
  format: z
    .enum(["usfm", "text"])
    .default("text")
    .describe('"text" = plain prose, "usfm" = raw USFM markup.'),
});

export type FetchScriptureParams = z.infer<typeof inputSchema>;

export const fetchScriptureTool: ToolModule<typeof inputSchema> = {
  name: "fetch_scripture",
  description:
    "Fetch Bible text (ULT or UST) for a specific reference. Use this to get the actual scriptural content at a passage. Always call this before providing translation assistance for a verse.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Scripture",
  },

  async handler(params: FetchScriptureParams, env: Env, requestId: string) {
    const { reference, language, organization, resourceType, format } = params;

    // Parse reference — minimal parse: book + chapter[:verse]
    const refMatch = reference.match(
      /^([1-3]?[A-Za-z]{2,4})\s+(\d+)(?::(\d+)(?:-(\d+))?)?/,
    );
    if (!refMatch) {
      throw Errors.invalidReference(reference);
    }
    const [, bookRaw, chapter, verseStart, verseEnd] = refMatch;
    const book = bookRaw.toUpperCase();

    // Map resource type to DCS subject
    const subjectMap: Record<string, string> = {
      ult: "Aligned Bible",
      ust: "Simplified Bible",
      glt: "Aligned Bible",
      gst: "Simplified Bible",
    };
    const subject = subjectMap[resourceType] ?? "Aligned Bible";

    const resolved = await getResourceZipUrl(language, subject, organization);
    if (!resolved) {
      throw Errors.resourceNotFound(
        `${resourceType.toUpperCase()} for language "${language}" by "${organization}"`,
      );
    }

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });

    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    // Find the USFM file for the requested book in the zip
    // Standard path pattern: <book_code>.usfm or <book_number>-<BOOK>.usfm
    const bookPaths = [`${book}.usfm`, `${book.toLowerCase()}.usfm`];

    // Try ingredient paths from the catalog entry
    for (const ingredient of resolved.entry.ingredients) {
      if (
        ingredient.identifier?.toUpperCase() === book ||
        ingredient.path?.includes(book)
      ) {
        bookPaths.unshift(ingredient.path.replace(/^\.\//, ""));
      }
    }

    let usfmContent: string | null = null;
    for (const path of bookPaths) {
      usfmContent = await fetcher.extractFileFromZip(zipBuffer, path);
      if (usfmContent) break;
    }

    if (!usfmContent) {
      throw Errors.resourceNotFound(
        `Book "${book}" in ${resourceType.toUpperCase()} for ${language}`,
      );
    }

    // Extract the requested verses if a range is specified
    const result = extractVerses(
      usfmContent,
      chapter,
      verseStart,
      verseEnd,
      format,
    );

    return ok(
      {
        reference,
        language,
        resourceType,
        book,
        chapter,
        verse: verseStart
          ? verseEnd
            ? `${verseStart}-${verseEnd}`
            : verseStart
          : null,
        text: result,
        source: resolved.zipUrl,
        requestId,
      },
      `${resourceType.toUpperCase()} ${reference} (${language})`,
    );
  },
};

/** Extract a verse range from a USFM string. Very lightweight — no dependency on usfm parser. */
function extractVerses(
  usfm: string,
  chapter: string,
  verseStart?: string,
  verseEnd?: string,
  format: "usfm" | "text" = "text",
): string {
  // Find chapter
  const chapterRe = new RegExp(`\\\\c\\s+${chapter}\\b`);
  const chapterIdx = usfm.search(chapterRe);
  if (chapterIdx < 0) return usfm; // fall back to full book

  const nextChapterRe = /\\c\s+\d+/g;
  nextChapterRe.lastIndex = chapterIdx + 1;
  const nextChapter = nextChapterRe.exec(usfm);
  const chapterText = nextChapter
    ? usfm.slice(chapterIdx, nextChapter.index)
    : usfm.slice(chapterIdx);

  if (!verseStart) {
    // Whole chapter
    return format === "usfm" ? chapterText : stripUsfm(chapterText);
  }

  const start = parseInt(verseStart, 10);
  const end = verseEnd ? parseInt(verseEnd, 10) : start;

  // Collect lines between \v start and \v end+1
  const lines = chapterText.split("\n");
  const out: string[] = [];
  let inRange = false;

  for (const line of lines) {
    const vMatch = line.match(/^\\v\s+(\d+)/);
    if (vMatch) {
      const vNum = parseInt(vMatch[1], 10);
      if (vNum >= start && vNum <= end) {
        inRange = true;
      } else if (vNum > end) {
        break;
      } else {
        inRange = false;
      }
    }
    if (inRange) out.push(line);
  }

  const extracted = out.join("\n").trim() || chapterText;
  return format === "usfm" ? extracted : stripUsfm(extracted);
}

/** Remove USFM markers to get plain prose. */
function stripUsfm(usfm: string): string {
  return usfm
    .replace(/\\[a-z]+\d*\*?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
