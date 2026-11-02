/**
 * get_passage_index — Step 2 (survey) of the passage-understanding workflow.
 *
 * Returns a compact, self-describing map of translation helps for the passage
 * with NO article bodies. Every row already tells the LLM what it is about:
 *   - A TN row's `taArticle.title` + `quote.aligned` names the issue + the words it covers.
 *   - A TWL row's `twArticle.title` + `quote.aligned` names the key term + the words.
 *
 * Shape:
 *   notes[]     TN rows: { reference, id, quote:{original,aligned}, occurrence, tags, taArticle:{path,title} }
 *   words[]     TWL rows: { reference, quote:{original,aligned}, occurrence, twArticle:{path,category,title} }
 *   issues[]    Deduped TA article topics (count of how many notes link to it)
 *   keyTerms[]  Deduped TW terms (count of occurrences)
 *
 * Handoff: pass `taArticle.path` to `get_academy_article`, `twArticle.path` to `get_word_article`,
 *          `id` to `get_note` for the full note body.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  okCached,
  mapApiCacheStatus,
  metaOutputSchema,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { resolveTitleFromPath, rcToTwPath } from "@translation-helps/door43";
import { formatQuoteDisplay } from "@translation-helps/door43";
import {
  passageRowReference,
  twCategoryFromPath,
} from "../../core/passageReference.js";
import type {
  NoteIndexEntry,
  WordIndexEntry,
  RollupEntry,
  PassageIndex,
} from "@translation-helps/door43";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  skipNotes: z
    .boolean()
    .optional()
    .describe(
      "When true, skip the /notes fetch and return empty notes[]/issues[]. " +
        "Use when get_note is already called in the same turn — only word-links are needed.",
    ),
});

export type GetPassageIndexParams = z.infer<typeof inputSchema>;

const quoteSchema = z.object({
  original: z.string(),
  aligned: z.string(),
});

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  notes: z
    .array(
      z.object({
        reference: z.string(),
        id: z.string(),
        quote: quoteSchema,
        occurrence: z.string(),
        tags: z.string(),
        taArticle: z.object({ path: z.string(), title: z.string() }).nullable(),
      }),
    )
    .optional(),
  words: z
    .array(
      z.object({
        reference: z.string(),
        quote: quoteSchema,
        occurrence: z.string(),
        twArticle: z
          .object({
            path: z.string(),
            category: z.string(),
            title: z.string(),
          })
          .nullable(),
      }),
    )
    .optional(),
  issues: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        count: z.number(),
      }),
    )
    .optional(),
  keyTerms: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        category: z.string(),
        count: z.number(),
      }),
    )
    .optional(),
  meta: metaOutputSchema,
});

export const getPassageIndexTool: ToolModule<typeof inputSchema> = {
  name: "get_passage_index",
  description:
    "Survey a passage: a compact index of translation notes and key terms, with no article bodies. " +
    "Each note row has quote.aligned and taArticle.{path,title}. Each word row has quote.aligned and twArticle.{path,category,title}. " +
    "keyTerms[].category is the path's own category (kt, names, or other). " +
    "issues[] and keyTerms[] are the deduplicated rollups. " +
    "When studying a passage step by step, call this after get_passage_context, then drill with get_note(id), get_academy_article(taArticle.path), or get_word_article(twArticle.path). " +
    "A direct question about a term, a concept, the notes, or the questions does not need this index first. " +
    "Use search_articles for a concept that is not linked to this passage. " +
    "Empty arrays mean nothing is available for the passage — not an error (isError remains false).",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage Index" },

  async handler(params: GetPassageIndexParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language, skipNotes } = params;

    const notesPromise = skipNotes
      ? Promise.resolve({
          status: "fulfilled" as const,
          value: {
            notes: [] as Array<Record<string, unknown>>,
            book: "",
            meta: undefined as { cache?: string } | undefined,
          },
        })
      : client
          .get<{
            notes: Array<Record<string, unknown>>;
            book?: string;
            meta?: { cache?: string };
          }>("/api/v1/notes", { reference, language })
          .then((value) => ({ status: "fulfilled" as const, value }))
          .catch((reason) => ({ status: "rejected" as const, reason }));

    const [notesRes, wordLinksRes] = await Promise.all([
      notesPromise,
      client
        .get<{
          wordLinks: Array<Record<string, unknown>>;
          book?: string;
          meta?: { cache?: string };
        }>("/api/v1/word-links", { reference, language })
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason })),
    ]);

    const notesPayload =
      notesRes.status === "fulfilled" ? notesRes.value : undefined;
    const wordPayload =
      wordLinksRes.status === "fulfilled" ? wordLinksRes.value : undefined;
    const rawNotes = notesPayload?.notes ?? [];
    const rawWords = wordPayload?.wordLinks ?? [];
    const notesBook = String(notesPayload?.book ?? "");
    const wordsBook = String(wordPayload?.book ?? notesBook);

    const cacheSources = [
      notesRes.status === "fulfilled" ? notesRes.value.meta?.cache : undefined,
      wordLinksRes.status === "fulfilled"
        ? wordLinksRes.value.meta?.cache
        : undefined,
    ].filter(Boolean) as string[];
    const cache =
      cacheSources.length === 0
        ? undefined
        : cacheSources.includes("network")
          ? "network"
          : cacheSources.includes("r2")
            ? "r2"
            : cacheSources.includes("kv")
              ? "kv"
              : cacheSources[0];

    // --- Shape notes (verse-level only, drop intro notes) ---
    const notes: NoteIndexEntry[] = rawNotes
      .filter((n) => n["verse"] !== "intro" && n["verse"] !== "front")
      .map((n) => {
        const sr = String(n["supportReference"] ?? "");
        const title = String(
          n["supportReferenceTitle"] ?? resolveTitleFromPath(sr) ?? "",
        );
        const gq = n["gatewayQuote"] as
          | { original?: string; aligned?: string }
          | undefined;

        const rawQuote = String(n["quote"] ?? "");
        return {
          reference: passageRowReference(
            reference,
            notesBook || String(n["book"] ?? ""),
            n["chapter"],
            n["verse"],
          ),
          id: String(n["id"] ?? ""),
          quote: {
            original: gq?.original ?? formatQuoteDisplay(rawQuote),
            aligned: gq?.aligned ?? "",
          },
          occurrence: String(n["occurrence"] ?? "1"),
          tags: sr,
          taArticle: sr ? { path: slugFromRc(sr), title } : null,
        } satisfies NoteIndexEntry;
      });

    // --- Shape word links ---
    const words: WordIndexEntry[] = rawWords.map((w) => {
      const rawPath = String(w["wordPath"] ?? w["twLink"] ?? "").trim();
      const path = rawPath.startsWith("rc://")
        ? (rcToTwPath(rawPath) ?? "")
        : rawPath.replace(/\.md$/i, "");
      const title = String(
        w["twTitle"] ?? resolveTitleFromPath(path || rawPath) ?? "",
      );
      const gq = w["gatewayQuote"] as
        | { original?: string; aligned?: string }
        | undefined;
      const category = path ? twCategoryFromPath(path) : "other";

      const rawOrigWords = String(w["origWords"] ?? "");
      return {
        reference: passageRowReference(
          reference,
          wordsBook || String(w["book"] ?? ""),
          w["chapter"],
          w["verse"],
        ),
        quote: {
          original: gq?.original ?? formatQuoteDisplay(rawOrigWords),
          aligned: gq?.aligned ?? "",
        },
        occurrence: String(w["occurrence"] ?? "1"),
        twArticle: path ? { path, category, title } : null,
      } satisfies WordIndexEntry;
    });

    // --- Dedup rollups ---
    const issues = buildRollup(
      notes.map((n) => n.taArticle).filter(Boolean) as {
        path: string;
        title: string;
      }[],
    );
    const keyTerms = buildKeyTerms(words);

    const index: PassageIndex = {
      reference,
      language,
      notes,
      words,
      issues,
      keyTerms,
    };

    return okCached(
      { ...index, ...(cache ? { meta: { cache } } : {}) },
      mapApiCacheStatus(cache),
      `${notes.length} note(s), ${words.length} word link(s), ${issues.length} issue type(s), ${keyTerms.length} key term(s)${cache ? ` [${cache}]` : ""}`,
    );
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an rc:// URI or slug to a clean path. */
function slugFromRc(rc: string): string {
  // e.g. "rc://*/ta/man/translate/figs-metaphor" → "translate/figs-metaphor"
  const m = rc.match(/rc:\/\/\*\/(?:ta|tw)\/(?:man\/)?(.+)/);
  return m ? m[1] : rc;
}

/** Deduplicate key terms and keep each path's own category. */
function buildKeyTerms(words: WordIndexEntry[]): Array<{
  path: string;
  title: string;
  category: string;
  count: number;
}> {
  const map = new Map<
    string,
    { title: string; category: string; count: number }
  >();
  for (const word of words) {
    const article = word.twArticle;
    if (!article?.path) continue;
    const existing = map.get(article.path);
    if (existing) {
      existing.count++;
    } else {
      map.set(article.path, {
        title: article.title,
        category: article.category,
        count: 1,
      });
    }
  }
  return Array.from(map.entries())
    .map(([path, { title, category, count }]) => ({
      path,
      title,
      category,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

/** Deduplicate { path, title } items, count occurrences, sort by count desc. */
function buildRollup(items: { path: string; title: string }[]): RollupEntry[] {
  const map = new Map<string, { title: string; count: number }>();
  for (const item of items) {
    const existing = map.get(item.path);
    if (existing) {
      existing.count++;
    } else {
      map.set(item.path, { title: item.title, count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([path, { title, count }]) => ({ path, title, count }))
    .sort((a, b) => b.count - a.count);
}
