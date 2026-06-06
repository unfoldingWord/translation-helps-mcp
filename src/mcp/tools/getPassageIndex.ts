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
 *
 * After this → drill with get_note / get_academy_article / get_word_article → get_questions (check).
 */

import { z } from "zod";
import { referenceParam, languageParam, ok, type ToolModule } from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { resolveTitleFromPath } from "../../core/resources/articleTitles.js";
import { formatQuoteDisplay } from "../../api/routes/alignmentHelper.js";
import type { NoteIndexEntry, WordIndexEntry, RollupEntry, PassageIndex } from "../../core/contracts/index.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
});

export type GetPassageIndexParams = z.infer<typeof inputSchema>;

export const getPassageIndexTool: ToolModule<typeof inputSchema> = {
  name: "get_passage_index",
  description:
    "STEP 2 (survey): Get a compact index of translation notes and key terms flagged for a passage — NO article bodies, just ids/paths and what each item is about. " +
    "Each note row includes `quote.aligned` (the strategic-language wording for the original quote) and `taArticle.{path,title}` naming the translation issue. " +
    "Each word row includes `quote.aligned` and `twArticle.{path,title}` naming the key term. " +
    "`issues[]` and `keyTerms[]` give deduplicated rollups with counts for at-a-glance understanding. " +
    "BEFORE this: call `get_passage_context`. " +
    "AFTER this: drill with `get_note(id)`, `get_academy_article(taArticle.path)`, or `get_word_article(twArticle.path)`. " +
    "Use `search_articles` for concepts not linked to this passage. " +
    "Empty arrays mean no resources are available for the passage — not an error.",
  inputSchema,
  annotations: { readOnlyHint: true, title: "Get Passage Index" },

  async handler(params: GetPassageIndexParams, env: Env, _requestId: string) {
    const client = new ApiClient(env);
    const { reference, language } = params;

    const [notesRes, wordLinksRes] = await Promise.allSettled([
      client.get<{ notes: Array<Record<string, unknown>> }>("/api/v1/notes", { reference, language }),
      client.get<{ wordLinks: Array<Record<string, unknown>> }>("/api/v1/word-links", { reference, language }),
    ]);

    const rawNotes: Array<Record<string, unknown>> =
      notesRes.status === "fulfilled" ? notesRes.value.notes : [];

    const rawWords: Array<Record<string, unknown>> =
      wordLinksRes.status === "fulfilled" ? wordLinksRes.value.wordLinks : [];

    // --- Shape notes (verse-level only, drop intro notes) ---
    const notes: NoteIndexEntry[] = rawNotes
      .filter((n) => n["verse"] !== "intro" && n["verse"] !== "front")
      .map((n) => {
        const sr = String(n["supportReference"] ?? "");
        const title = String(n["supportReferenceTitle"] ?? resolveTitleFromPath(sr) ?? "");
        const gq = n["gatewayQuote"] as { original?: string; aligned?: string } | undefined;

        const rawQuote = String(n["quote"] ?? "");
        return {
          reference: `${n["book"]} ${n["chapter"]}:${n["verse"]}`,
          id: String(n["id"] ?? ""),
          quote: {
            original: gq?.original ?? formatQuoteDisplay(rawQuote),
            aligned: gq?.aligned ?? "",
          },
          occurrence: String(n["occurrence"] ?? "1"),
          tags: sr,
          taArticle: sr
            ? { path: slugFromRc(sr), title }
            : null,
        } satisfies NoteIndexEntry;
      });

    // --- Shape word links ---
    const words: WordIndexEntry[] = rawWords.map((w) => {
      const twLink = String(w["wordPath"] ?? w["twLink"] ?? "");
      const title = String(w["twTitle"] ?? resolveTitleFromPath(twLink) ?? "");
      const gq = w["gatewayQuote"] as { original?: string; aligned?: string } | undefined;
      const category = String(w["category"] ?? "other");

      const rawOrigWords = String(w["origWords"] ?? "");
      return {
        reference: `${w["book"]} ${w["chapter"]}:${w["verse"]}`,
        quote: {
          original: gq?.original ?? formatQuoteDisplay(rawOrigWords),
          aligned: gq?.aligned ?? "",
        },
        occurrence: String(w["occurrence"] ?? "1"),
        twArticle: twLink
          ? { path: twLink, category, title }
          : null,
      } satisfies WordIndexEntry;
    });

    // --- Dedup rollups ---
    const issues = buildRollup(notes.map((n) => n.taArticle).filter(Boolean) as { path: string; title: string }[]);
    const keyTerms = buildRollup(
      words.map((w) => w.twArticle ? { path: w.twArticle.path, title: w.twArticle.title } : null)
        .filter(Boolean) as { path: string; title: string }[],
    );

    const index: PassageIndex = { reference, language, notes, words, issues, keyTerms };

    return ok(
      index,
      `${notes.length} note(s), ${words.length} word link(s), ${issues.length} issue type(s), ${keyTerms.length} key term(s)`,
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
