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
import { ApiClient, ApiClientError } from "../apiClient.js";
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
  notesError: z
    .string()
    .optional()
    .describe(
      "Set when fetching OBS notes failed. This is an error, not a missing resource.",
    ),
  wordLinksError: z
    .string()
    .optional()
    .describe(
      "Set when fetching OBS word links failed. This is an error, not a missing resource.",
    ),
});

export const getObsIndexTool: ToolModule<typeof inputSchema> = {
  name: "get_obs_index",
  description:
    "Compact index of OBS translation notes and key terms for a story:frame — NO article bodies. " +
    "notes[] has reference, id, quote, occurrence, and taArticle.{path,title}. " +
    "words[] has each key-term row with twArticle.{path,category,title}; keyTerms[] rolls those up by path with a count and the frames. " +
    "A failed fetch sets notesError or wordLinksError; that is not a missing resource. available:false only when neither resource exists. " +
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

    const notesSide = classifySide(notesRes);
    const linksSide = classifySide(linksRes);

    if (notesSide.kind === "failed" && linksSide.kind === "failed") {
      throw bothSidesFailed(notesSide.reason, linksSide.reason);
    }

    if (notesSide.kind === "missing" && linksSide.kind === "missing") {
      const detail = [notesSide, linksSide]
        .map((side) => String(side.value.message ?? ""))
        .filter(Boolean)
        .join(" ");
      return notAvailable(
        `OBS notes or key terms for language "${language}"`,
        detail,
      );
    }

    const notes =
      notesSide.kind === "ok"
        ? ((notesSide.value.notes ?? []) as Array<Record<string, unknown>>).map(
            compactObsNote,
          )
        : [];
    const words =
      linksSide.kind === "ok"
        ? ((linksSide.value.words ?? []) as WordRow[])
        : [];
    const keyTerms = buildKeyTerms(words);

    const present =
      linksSide.kind === "ok"
        ? linksSide
        : notesSide.kind === "ok"
          ? notesSide
          : linksSide.kind === "missing"
            ? linksSide
            : notesSide.kind === "missing"
              ? notesSide
              : null;
    const referenceOut =
      present?.value.reference != null
        ? String(present.value.reference)
        : reference;
    const languageOut =
      present?.value.language != null
        ? String(present.value.language)
        : language;

    const notesError =
      notesSide.kind === "failed" ? failureText(notesSide.reason) : undefined;
    const wordLinksError =
      linksSide.kind === "failed" ? failureText(linksSide.reason) : undefined;

    const messages: string[] = [];
    if (notesSide.kind === "missing") {
      messages.push(
        `OBS Translation Notes are not available for language "${languageOut}".`,
      );
    }
    if (linksSide.kind === "missing") {
      messages.push(
        `OBS Translation Words Links are not available for language "${languageOut}".`,
      );
    }
    if (notesError) {
      messages.push(
        `OBS Translation Notes failed to load for language "${languageOut}" (${notesError}).`,
      );
    }
    if (wordLinksError) {
      messages.push(
        `OBS Translation Words Links failed to load for language "${languageOut}" (${wordLinksError}).`,
      );
    }

    const gapParts: string[] = [];
    if (notesSide.kind === "missing")
      gapParts.push("Missing: OBS Translation Notes.");
    if (linksSide.kind === "missing") {
      gapParts.push("Missing: OBS Translation Words Links.");
    }
    if (notesError) gapParts.push("OBS Translation Notes fetch failed.");
    if (wordLinksError)
      gapParts.push("OBS Translation Words Links fetch failed.");
    const gap = gapParts.length ? ` ${gapParts.join(" ")}` : "";

    const data = {
      reference: referenceOut,
      language: languageOut,
      words,
      notes,
      keyTerms,
      ...(notesError ? { notesError } : {}),
      ...(wordLinksError ? { wordLinksError } : {}),
      ...(messages.length ? { message: messages.join(" ") } : {}),
    };

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

type FetchedSide =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: unknown };

type ResourceSide =
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "missing"; value: Record<string, unknown> }
  | { kind: "failed"; reason: unknown };

function classifySide(res: FetchedSide): ResourceSide {
  if (!res.ok) return { kind: "failed", reason: res.reason };
  if (res.value.available === false)
    return { kind: "missing", value: res.value };
  return { kind: "ok", value: res.value };
}

function failureText(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return String(reason ?? "unknown error");
}

/** Both fetches failed. Keep each reason; a lone notes error used to hide the other. */
function bothSidesFailed(notesReason: unknown, linksReason: unknown): Error {
  const message =
    `OBS Translation Notes failed (${failureText(notesReason)}). ` +
    `OBS Translation Words Links failed (${failureText(linksReason)}).`;
  if (
    notesReason instanceof ApiClientError &&
    linksReason instanceof ApiClientError
  ) {
    const status =
      notesReason.status >= 500 ? notesReason.status : linksReason.status;
    return new ApiClientError(
      notesReason.code,
      message,
      status,
      notesReason.retryable || linksReason.retryable,
    );
  }
  return new Error(message);
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
  const title = String(
    note["supportReferenceTitle"] ??
      resolveTitleFromPath(supportReference) ??
      "",
  );
  return {
    reference: String(note["reference"] ?? ""),
    id: String(note["id"] ?? ""),
    quote: String(note["quote"] ?? ""),
    occurrence: String(note["occurrence"] ?? ""),
    taArticle: path ? { path, title } : null,
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
