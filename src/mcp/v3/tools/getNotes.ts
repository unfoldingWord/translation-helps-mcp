/**
 * v3 th_get_notes — note bodies for Bible and OBS.
 *
 * Bible translation notes: GET /api/v1/notes. Bible study notes are not a
 * resource. OBS translation notes: GET /api/v1/obs-notes. OBS study notes:
 * GET /api/v1/obs-study-notes.
 *
 * A book alone returns that book's introduction. An introduction reference
 * returns that introduction. `phrase` filters; it does not fall back to
 * every note.
 */

import { z } from "zod";
import {
  formatObsReferenceLabel,
  rcToTaPath,
  resolveTitleFromPath,
} from "@translation-helps/door43";
import { ErrorCode, TranslationHelpsError } from "../../../core/errors.js";
import { rewriteNoteVerseLinks } from "../../../core/noteText.js";
import { passageRowReference } from "../../../core/passageReference.js";
import { ApiClient } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  notAvailable,
  ok,
  readResourceSource,
  resourceSourceSchema,
  withNotAvailableOutput,
} from "../../tools/shared.js";
import { v3LanguageParam } from "../params.js";
import { V3_LIST_RESOURCES_HINT } from "../instructions.js";
import {
  readReference,
  type BibleReferenceRead,
  type ReferenceRead,
} from "../readReference.js";

const inputSchema = z.object({
  reference: z
    .string()
    .min(1)
    .describe(
      'A passage ("JHN 3:16"), an introduction ("JHN 1:intro", "JHN front:intro"), a book ("Jonah"), or an Open Bible Stories reference ("OBS 3:5", "OBS 3").',
    ),
  language: v3LanguageParam,
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Note ids from th_get_passage_index. One call returns every listed note.",
    ),
  phrase: z
    .string()
    .optional()
    .describe(
      "Keep a note when this text appears, ignoring case, in its quote, its aligned quote, or its body. No match returns notes: [].",
    ),
  kind: z
    .enum(["translation", "study"])
    .default("translation")
    .describe(
      '"translation" (default) or "study". "study" is Open Bible Stories study notes for discussion groups. The Bible has no study notes.',
    ),
});

/**
 * A book alone is that book's introduction. Bible study notes are not a
 * resource. A phrase with no match is an empty list.
 */
export const GET_NOTES_DESCRIPTION =
  'Returns translation notes in full. Each note has the original-language quote it explains, the matching words in the language\'s own text where available, the explanation, and the Translation Academy article for its translation issue. Pass ids from th_get_passage_index to get several notes in one call, or phrase to keep only notes whose quote or text contains it. With neither, every note in the reference comes back, which can be long for a whole chapter. reference may be a passage, an introduction ("JHN 1:intro", "JHN front:intro"), a book alone (its introduction) or an Open Bible Stories reference. kind "study" returns Open Bible Stories study notes, written for discussion groups; the Bible has no study notes. A phrase that matches nothing returns an empty list, not an error. available: false means this language has no notes for that book: say so and do not answer from memory.';

const outputSchema = withNotAvailableOutput({
  kind: z.enum(["bible", "obs"]).optional(),
  noteKind: z.enum(["translation", "study"]).optional(),
  reference: z.string().optional(),
  language: z.string().optional(),
  phrase: z.string().optional(),
  notes: z.array(z.record(z.string(), z.unknown())).optional(),
  source: resourceSourceSchema,
  message: z.string().optional(),
});

type Row = Record<string, unknown>;

export const getNotesV3Tool = {
  name: "th_get_notes",
  description: GET_NOTES_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Get Notes",
  },

  async handler(
    params: z.input<typeof inputSchema>,
    env: Env,
    _requestId: string,
  ) {
    const value = requireRead(params);
    const language = params.language || "en";
    const noteKind = params.kind ?? "translation";

    if (value.kind !== "obs" && noteKind === "study") {
      return notAvailable(
        'Bible study notes (kind "study"; the Bible has translation notes only)',
        undefined,
        V3_LIST_RESOURCES_HINT,
      );
    }

    const plan = fetchPlan(value);
    const client = new ApiClient(env);
    const path =
      value.kind === "obs"
        ? noteKind === "study"
          ? "/api/v1/obs-study-notes"
          : "/api/v1/obs-notes"
        : "/api/v1/notes";
    const data = await client.get<Row>(path, {
      reference: plan.reference,
      language,
    });
    const source = readResourceSource(data.source);
    if (data.available === false) {
      const book = text(data.book);
      return notAvailable(
        value.kind === "obs"
          ? `OBS ${noteKind} notes for language "${language}"`
          : book
            ? `translation notes for "${book}" in language "${language}"`
            : `translation notes for language "${language}"`,
        text(data.message),
        V3_LIST_RESOURCES_HINT,
        source,
      );
    }

    let rows = asRows(data.notes).filter(plan.keep);
    const ids = wantedIds(params);
    if (ids) {
      const wanted = new Set(ids);
      rows = rows.filter((row) => wanted.has(text(row.id)));
    }
    const phrase = text(params.phrase);
    if (phrase) {
      const needle = phrase.toLowerCase();
      rows = rows.filter((row) => phraseHits(row, needle));
    }
    if (ids) rows = inIdOrder(rows, ids);

    const notes = rows.map((row) =>
      shapeNote(row, value, params.reference ?? value.reference, language),
    );
    const message =
      phrase && notes.length === 0
        ? `No notes for ${value.reference} contain "${phrase}".`
        : ids && notes.length === 0
          ? `No notes for ${value.reference} have the requested ids.`
          : undefined;

    return ok(
      {
        kind: value.kind === "obs" ? "obs" : "bible",
        noteKind,
        reference: value.reference,
        language,
        ...(phrase ? { phrase } : {}),
        notes,
        ...(source ? { source } : {}),
        ...(message ? { message } : {}),
      },
      message ??
        `${notes.length} ${noteKind} note(s) for ${value.reference} (${language})`,
    );
  },
};

function fetchPlan(value: ReferenceRead): {
  reference: string;
  keep: (row: Row) => boolean;
} {
  if (value.kind === "obs") {
    return { reference: value.reference, keep: () => true };
  }
  if (value.kind === "book") {
    return {
      reference: `${value.book} 1`,
      keep: (row) =>
        text(row.chapter) === "front" && text(row.verse) === "intro",
    };
  }
  if (isBibleIntro(value)) {
    if (!value.book) {
      throw invalid(
        'An introduction needs a book, for example "JON front:intro" or "JON 1:intro".',
      );
    }
    if (value.chapter === "front") {
      return {
        reference: `${value.book} 1`,
        keep: (row) =>
          text(row.chapter) === "front" && text(row.verse) === "intro",
      };
    }
    return {
      reference: `${value.book} ${value.chapter}`,
      keep: (row) =>
        text(row.chapter) === value.chapter && text(row.verse) === "intro",
    };
  }
  return {
    reference: value.reference,
    keep: (row) => !isBibleIntroRow(row),
  };
}

function shapeNote(
  row: Row,
  value: ReferenceRead,
  inputReference: string,
  language: string,
): Row {
  const article = taArticle(row);
  const reference = noteReference(row, value, inputReference);
  const body = text(row.note);
  const note =
    value.kind === "obs" ? body : rewriteNoteVerseLinks(body, bibleBook(value));
  const aligned = alignedQuote(row);
  return {
    reference,
    id: text(row.id),
    quote: text(row.quote),
    ...(aligned ? { alignedQuote: aligned } : {}),
    note,
    ...(article
      ? {
          taArticle: article,
          next: {
            tool: "th_get_article",
            args: { path: article.path, language },
          },
        }
      : {}),
  };
}

function noteReference(
  row: Row,
  value: ReferenceRead,
  inputReference: string,
): string {
  if (value.kind === "obs") {
    return formatObsReferenceLabel(text(row.reference) || value.reference);
  }
  if (value.kind === "book") return `${value.book} front:intro`;
  if (isBibleIntro(value)) return value.reference;
  return passageRowReference(
    inputReference,
    bibleBook(value),
    row.chapter,
    row.verse,
  );
}

function bibleBook(value: ReferenceRead): string {
  return value.kind === "obs" ? "" : value.book;
}

function taArticle(row: Row): { path: string; title: string } | null {
  const support = text(row.supportReference);
  if (!support) return null;
  const path = support.startsWith("rc://")
    ? rcToTaPath(support)
    : support.replace(/\.md$/i, "");
  if (!path) return null;
  const title =
    text(row.supportReferenceTitle) || text(resolveTitleFromPath(support));
  return { path, title };
}

function phraseHits(row: Row, needle: string): boolean {
  const gate = row.gatewayQuote;
  const aligned =
    gate && typeof gate === "object"
      ? text((gate as { aligned?: unknown }).aligned)
      : "";
  const original =
    gate && typeof gate === "object"
      ? text((gate as { original?: unknown }).original)
      : "";
  return [text(row.quote), aligned, original, text(row.note)]
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

function alignedQuote(row: Row): string | undefined {
  const gate = row.gatewayQuote;
  if (!gate || typeof gate !== "object") return undefined;
  const aligned = text((gate as { aligned?: unknown }).aligned);
  return aligned || undefined;
}

/** Ids in the order the caller asked, with duplicates removed. */
function wantedIds(params: { ids?: string[]; id?: string }): string[] | null {
  const ids: string[] = [];
  for (const id of params.ids ?? []) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (params.id && !ids.includes(params.id)) ids.push(params.id);
  return ids.length ? ids : null;
}

function inIdOrder(rows: Row[], ids: string[]): Row[] {
  const byId = new Map<string, Row>();
  for (const row of rows) {
    const id = text(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }
  const out: Row[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) out.push(row);
  }
  return out;
}

function isBibleIntroRow(row: Row): boolean {
  return text(row.verse) === "intro" || text(row.chapter) === "front";
}

function isBibleIntro(value: BibleReferenceRead): boolean {
  return (
    value.verse === "intro" || value.chapter === "front" || value.book === ""
  );
}

function requireRead(params: {
  reference?: string;
  language?: string;
}): ReferenceRead {
  const read = readReference(params, params.language);
  if (!read.ok) throw invalid(read.message);
  return read.value;
}

function invalid(message: string): TranslationHelpsError {
  return new TranslationHelpsError({
    code: ErrorCode.INVALID_REFERENCE,
    message,
  });
}

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Row => Boolean(row) && typeof row === "object",
  );
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}
