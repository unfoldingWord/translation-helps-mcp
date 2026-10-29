/**
 * get_obs_index — compact OBS counterpart of get_passage_index.
 *
 * Notes and key terms for a story:frame, with no article bodies.
 * The article itself is fetched afterwards with get_word_article.
 */

import { z } from "zod";
import {
  languageParam,
  OBS_REFERENCE_DESCRIPTION,
  ok,
  notAvailable,
  withNotAvailableOutput,
  type ToolModule,
} from "./shared.js";
import { ApiClient } from "../apiClient.js";
import type { Env } from "../agent.js";
import { rcToTaPath, resolveTitleFromPath } from "@translation-helps/door43";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe(`An OBS story:frame reference. ${OBS_REFERENCE_DESCRIPTION}`),
  language: languageParam,
});

export type GetObsIndexParams = z.infer<typeof inputSchema>;

const twArticleSchema = z
  .object({
    path: z.string(),
    category: z.string(),
    title: z.string(),
  })
  .nullable();

const outputSchema = withNotAvailableOutput({
  reference: z.string().optional(),
  language: z.string().optional(),
  words: z
    .array(
      z.object({
        reference: z.string(),
        id: z.string(),
        tags: z.string(),
        origWords: z.string(),
        occurrence: z.string(),
        twArticle: twArticleSchema,
      }),
    )
    .optional(),
  notes: z
    .array(
      z.object({
        reference: z.string(),
        id: z.string(),
        quote: z.string(),
        occurrence: z.string(),
        taArticle: z.object({ path: z.string(), title: z.string() }).nullable(),
      }),
    )
    .optional(),
  keyTerms: z
    .array(
      z.object({
        path: z.string(),
        category: z.string(),
        title: z.string(),
        count: z.number(),
        frames: z.array(z.string()),
      }),
    )
    .optional(),
});

export const getObsIndexTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_index",
  description:
    "Compact index of OBS translation notes and key terms for a story:frame — NO article bodies. " +
    "notes[] has reference, id, quote, occurrence, and taArticle.{path,title}. " +
    "words[] has each key-term row with twArticle.{path,category,title}; keyTerms[] rolls those up by path with a count and the frames. " +
    "AFTER this: `get_word_article(twArticle.path)`, `get_obs_notes` for full notes.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get OBS Index" },

  async handler(params: GetObsIndexParams, env: Env, _requestId: string) {
    const { reference, language } = params;
    const client = new ApiClient(env);

    const [notesRes, linksRes] = await Promise.all([
      client
        .get<Record<string, unknown>>("/api/v1/obs-notes", {
          reference,
          language,
        })
        .then((value) => ({ ok: true as const, value }))
        .catch((reason: unknown) => ({ ok: false as const, reason })),
      client
        .get<Record<string, unknown>>("/api/v1/obs-word-links", {
          reference,
          language,
        })
        .then((value) => ({ ok: true as const, value }))
        .catch((reason: unknown) => ({ ok: false as const, reason })),
    ]);

    const notesMissing = !notesRes.ok || notesRes.value.available === false;
    const linksMissing = !linksRes.ok || linksRes.value.available === false;

    if (notesMissing && linksMissing) {
      if (!notesRes.ok && !linksRes.ok) throw notesRes.reason;
      const detail = [notesRes, linksRes]
        .map((side) =>
          side.ok && side.value.available === false
            ? String(side.value.message ?? "")
            : "",
        )
        .filter(Boolean)
        .join(" ");
      return notAvailable(
        `OBS notes or key terms for language "${language}"`,
        detail,
      );
    }

    const notes = notesMissing
      ? []
      : (
          (notesRes.ok ? notesRes.value.notes : []) as Array<
            Record<string, unknown>
          >
        ).map(compactObsNote);
    const words = linksMissing
      ? []
      : ((linksRes.ok ? linksRes.value.words : []) as WordRow[]);
    const keyTerms = buildKeyTerms(words);

    const present = linksMissing ? notesRes : linksRes;
    const referenceOut =
      present.ok && present.value.reference != null
        ? String(present.value.reference)
        : reference;
    const languageOut =
      present.ok && present.value.language != null
        ? String(present.value.language)
        : language;

    const missingLabel = notesMissing
      ? "OBS Translation Notes"
      : linksMissing
        ? "OBS Translation Words Links"
        : "";

    const data = {
      reference: referenceOut,
      language: languageOut,
      words,
      notes,
      keyTerms,
      ...(missingLabel
        ? {
            message: `${missingLabel} are not available for language "${languageOut}".`,
          }
        : {}),
    };

    const gap = missingLabel ? ` Missing: ${missingLabel}.` : "";
    return ok(
      data,
      `${notes.length} OBS note(s), ${words.length} key term row(s), ${keyTerms.length} key term(s) for ${referenceOut} (${languageOut}).${gap}`,
    );
  },
};

interface WordRow {
  reference: string;
  id: string;
  tags: string;
  origWords: string;
  occurrence: string;
  twArticle: { path: string; category: string; title: string } | null;
}

function compactObsNote(note: Record<string, unknown>): {
  reference: string;
  id: string;
  quote: string;
  occurrence: string;
  taArticle: { path: string; title: string } | null;
} {
  const supportReference = String(note["supportReference"] ?? "");
  const path = supportReference ? rcToTaPath(supportReference) : null;
  return {
    reference: String(note["reference"] ?? ""),
    id: String(note["id"] ?? ""),
    quote: String(note["quote"] ?? ""),
    occurrence: String(note["occurrence"] ?? ""),
    taArticle: path
      ? { path, title: resolveTitleFromPath(supportReference) ?? "" }
      : null,
  };
}

function buildKeyTerms(words: WordRow[]): Array<{
  path: string;
  category: string;
  title: string;
  count: number;
  frames: string[];
}> {
  const map = new Map<
    string,
    { category: string; title: string; count: number; frames: string[] }
  >();
  for (const word of words) {
    const article = word.twArticle;
    if (!article?.path) continue;
    const existing = map.get(article.path);
    if (existing) {
      existing.count++;
      if (!existing.frames.includes(word.reference)) {
        existing.frames.push(word.reference);
      }
    } else {
      map.set(article.path, {
        category: article.category,
        title: article.title,
        count: 1,
        frames: [word.reference],
      });
    }
  }
  return Array.from(map.entries())
    .map(([path, entry]) => ({ path, ...entry }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}
