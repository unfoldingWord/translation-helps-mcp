/**
 * fetch_translation_word_links — get the translation words that appear at a reference.
 * Use this FIRST to discover which word paths to pass to fetch_translation_word.
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
    .describe("Organization on Door43."),
});

export type FetchTranslationWordLinksParams = z.infer<typeof inputSchema>;

export const fetchTranslationWordLinksTool: ToolModule<typeof inputSchema> = {
  name: "fetch_translation_word_links",
  description:
    "List the Translation Words (TW) that appear at a specific Bible reference. " +
    'Returns word paths like "bible/kt/grace" that you can pass to fetch_translation_word. ' +
    "Always call this before fetch_translation_word if you do not already have a path.",
  inputSchema,
  annotations: {
    readOnlyHint: true,
    title: "Fetch Translation Word Links",
  },

  async handler(
    params: FetchTranslationWordLinksParams,
    env: Env,
    requestId: string,
  ) {
    const { reference, language, organization } = params;

    const refMatch = reference.match(
      /^([1-3]?[A-Za-z]{2,4})\s+(\d+)(?::(\d+)(?:-(\d+))?)?/,
    );
    if (!refMatch) throw Errors.invalidReference(reference);
    const [, bookRaw, chapter, verseStart] = refMatch;
    const book = bookRaw.toUpperCase();

    const resolved = await getResourceZipUrl(
      language,
      "TSV Translation Words Links",
      organization,
    );
    if (!resolved)
      throw Errors.resourceNotFound(`Translation Word Links for "${language}"`);

    const fetcher = new ZipResourceFetcher2({
      KV: env.TRANSLATION_HELPS_CACHE,
      R2: env.ZIP_FILES,
    });
    const zipBuffer = await fetcher.getOrDownloadZip(resolved.zipUrl);

    const paths = [`twl_${book}.tsv`, `${book}.tsv`];
    for (const ing of resolved.entry.ingredients) {
      if (
        ing.identifier?.toUpperCase() === book ||
        ing.path?.includes(book.toLowerCase())
      ) {
        paths.unshift(ing.path.replace(/^\.\//, ""));
      }
    }

    let tsv: string | null = null;
    for (const path of paths) {
      tsv = await fetcher.extractFileFromZip(zipBuffer, path);
      if (tsv) break;
    }
    if (!tsv)
      throw Errors.resourceNotFound(`Word Links file for book "${book}"`);

    const links = parseTwl(tsv, chapter, verseStart);
    return ok(
      {
        reference,
        language,
        book,
        chapter,
        verse: verseStart,
        wordLinks: links,
        requestId,
      },
      `${links.length} word links found at ${reference}`,
    );
  },
};

interface WordLink {
  book: string;
  chapter: string;
  verse: string;
  twId: string;
  supportReference: string;
  origWords: string;
  occurrence: string;
  twLink: string;
  /** Derived path suitable for fetch_translation_word, e.g. "bible/kt/grace" */
  wordPath: string;
}

function parseTwl(tsv: string, chapter: string, verse?: string): WordLink[] {
  return tsv
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("Book"))
    .map((l) => {
      const [
        book,
        ch,
        vs,
        twId,
        supportReference,
        origWords,
        occurrence,
        twLink,
      ] = l.split("\t");
      const wordPath =
        twLink
          ?.replace(/^rc:\/\/\*\/tw\/dict\//, "")
          .replace(/^rc:\/\/[^/]+\/tw\/dict\//, "") ?? "";
      return {
        book,
        chapter: ch,
        verse: vs,
        twId,
        supportReference: supportReference?.trim(),
        origWords: origWords?.trim(),
        occurrence,
        twLink: twLink?.trim() ?? "",
        wordPath,
      };
    })
    .filter((w) => w.chapter === chapter && (!verse || w.verse === verse));
}
