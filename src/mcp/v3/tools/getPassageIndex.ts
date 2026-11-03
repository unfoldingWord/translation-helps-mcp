/**
 * v3 th_get_passage_index — one index for Bible and OBS, without bodies.
 *
 * Bible calls GET /api/v1/notes and /api/v1/word-links. A whole book is one
 * call per TSV (the route reads the book file once), not a call per chapter.
 * OBS calls GET /api/v1/obs-notes and /api/v1/obs-word-links.
 */

import { z } from "zod";
import {
  formatObsReferenceLabel,
  rcToTaPath,
  rcToTwPath,
  resolveTitleFromPath,
} from "@translation-helps/door43";
import { ErrorCode, TranslationHelpsError } from "../../../core/errors.js";
import {
  passageRowReference,
  twCategoryFromPath,
} from "../../../core/passageReference.js";
import { ApiClient, ApiClientError } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  languageParam,
  mapApiCacheStatus,
  notAvailable,
  okCached,
  withNotAvailableOutput,
} from "../../tools/shared.js";
import {
  introductionNotesMessage,
  V3_LIST_RESOURCES_HINT,
} from "../instructions.js";
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
      'A Bible passage, chapter or book ("GEN 9:9", "JON 1", "Jonah") or an OBS reference ("OBS 1:3", "OBS 1", "OBS 3:1-3").',
    ),
  language: languageParam,
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "How many notes and how many words to return. Default 200. issues, keyTerms and introductions are not paged.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "How many notes and words to skip. Default 0. The same offset applies to both lists.",
    ),
});

/**
 * Proposal description, plus paging and where availability lives.
 * Paging is required so a whole book stays one call and still says how to
 * continue. Availability is th_list_resources, so this tool does not repeat it.
 */
export const GET_PASSAGE_INDEX_DESCRIPTION =
  "What a passage, chapter or whole book has, without bodies: notes, key terms, translation issues, introductions. Each row names the call that fetches it. " +
  "A whole book pages notes and words (limit defaults to 200, with offset, total and has_more); issues, key terms and introductions stay complete. " +
  "Which resources exist is th_list_resources(language, book), not this tool.";

const outputSchema = withNotAvailableOutput({
  kind: z.enum(["bible", "obs"]).optional(),
  reference: z.string().optional(),
  language: z.string().optional(),
  notes: z.array(z.record(z.string(), z.unknown())).optional(),
  words: z.array(z.record(z.string(), z.unknown())).optional(),
  issues: z.array(z.record(z.string(), z.unknown())).optional(),
  keyTerms: z.array(z.record(z.string(), z.unknown())).optional(),
  introductions: z.array(z.record(z.string(), z.unknown())).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  total: z.object({ notes: z.number(), words: z.number() }).optional(),
  has_more: z.object({ notes: z.boolean(), words: z.boolean() }).optional(),
  notesError: z.string().optional(),
  wordLinksError: z.string().optional(),
  message: z.string().optional(),
});

type Row = Record<string, unknown>;

interface Article {
  path: string;
  title: string;
  category?: string;
}

interface NextCall {
  tool: string;
  args: Record<string, unknown>;
}

export const getPassageIndexV3Tool = {
  name: "th_get_passage_index",
  description: GET_PASSAGE_INDEX_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Get Passage Index",
  },

  async handler(
    params: z.input<typeof inputSchema>,
    env: Env,
    _requestId: string,
  ) {
    const value = requireRead(params);
    const language = params.language || "en";
    if (value.kind === "bible" && isBibleIntro(value)) {
      throw invalid(introductionNotesMessage(value.reference));
    }

    const limit = pageLimit(params.limit);
    const offset = pageOffset(params.offset);
    const client = new ApiClient(env);
    const apiReference = value.reference;
    const notesPath =
      value.kind === "obs" ? "/api/v1/obs-notes" : "/api/v1/notes";
    const wordsPath =
      value.kind === "obs" ? "/api/v1/obs-word-links" : "/api/v1/word-links";

    const [notesSide, wordsSide] = await Promise.all([
      fetchSide(client, notesPath, { reference: apiReference, language }),
      fetchSide(client, wordsPath, { reference: apiReference, language }),
    ]);

    if (notesSide.kind === "failed" && wordsSide.kind === "failed") {
      throw bothFailed(notesSide.reason, wordsSide.reason);
    }
    if (notesSide.kind === "missing" && wordsSide.kind === "missing") {
      const detail = [notesSide, wordsSide]
        .map((side) => text(side.value.message))
        .filter(Boolean)
        .join(" ");
      return notAvailable(
        value.kind === "obs"
          ? `OBS notes or key terms for language "${language}"`
          : `translation notes or word links for language "${language}"`,
        detail,
        V3_LIST_RESOURCES_HINT,
      );
    }

    const noteRows = await rowsWithObsFrontMatter(
      client,
      value,
      language,
      notesSide,
    );
    const wordRows =
      wordsSide.kind === "ok"
        ? asRows(
            value.kind === "obs"
              ? wordsSide.value.words
              : wordsSide.value.wordLinks,
          )
        : [];
    const book =
      value.kind === "obs"
        ? ""
        : value.book ||
          text(notesSide.kind === "ok" ? notesSide.value.book : "");

    const introductions =
      value.kind === "obs"
        ? obsIntroductions(noteRows, language)
        : bibleIntroductions(noteRows, book, value, language);
    const introIds = new Set(
      introductions.flatMap((row) => {
        const id = row.id;
        return typeof id === "string" && id ? [id] : [];
      }),
    );

    const notes = noteRows
      .filter((row) => !isIndexIntro(value.kind, row, introIds))
      .map((row) =>
        value.kind === "obs"
          ? obsNote(row, language)
          : bibleNote(row, params.reference ?? value.reference, book, language),
      );
    const words = wordRows.map((row) =>
      value.kind === "obs"
        ? obsWord(row, language)
        : bibleWord(row, params.reference ?? value.reference, book, language),
    );

    const issues = rollup(
      notes.flatMap((note) => {
        const article = note.taArticle as Article | null | undefined;
        return article?.path ? [article] : [];
      }),
      language,
    );
    const keyTerms = rollup(
      words.flatMap((word) => {
        const article = word.twArticle as Article | null | undefined;
        return article?.path ? [article] : [];
      }),
      language,
      true,
    );

    const notesPage = page(notes, limit, offset);
    const wordsPage = page(words, limit, offset);
    const notesError =
      notesSide.kind === "failed" ? failureText(notesSide.reason) : undefined;
    const wordLinksError =
      wordsSide.kind === "failed" ? failureText(wordsSide.reason) : undefined;
    const messages = gapMessages(language, notesSide, wordsSide);

    const cache = cacheOf(
      notesSide.kind === "ok" ? notesSide.value : undefined,
      wordsSide.kind === "ok" ? wordsSide.value : undefined,
    );

    return okCached(
      {
        kind: value.kind === "obs" ? "obs" : "bible",
        reference: value.reference,
        language,
        notes: notesPage.rows,
        words: wordsPage.rows,
        issues,
        keyTerms,
        introductions: introductions.map((row) => {
          const { id, ...rest } = row;
          void id;
          return rest;
        }),
        limit,
        offset,
        total: { notes: notesPage.total, words: wordsPage.total },
        has_more: { notes: notesPage.hasMore, words: wordsPage.hasMore },
        ...(notesError ? { notesError } : {}),
        ...(wordLinksError ? { wordLinksError } : {}),
        ...(messages.length ? { message: messages.join(" ") } : {}),
      },
      mapApiCacheStatus(cache),
      `${notesPage.total} note(s), ${wordsPage.total} word(s), ${issues.length} issue(s), ${keyTerms.length} key term(s) for ${value.reference}`,
    );
  },
};

function bibleNote(
  row: Row,
  inputReference: string,
  book: string,
  language: string,
): Row {
  const article = taArticle(row);
  const reference = passageRowReference(
    inputReference,
    book,
    row.chapter,
    row.verse,
  );
  return {
    reference,
    id: text(row.id),
    quote: displayQuote(row, "quote"),
    taArticle: article,
    next: nextNotes(reference, language, text(row.id)),
  };
}

function obsNote(row: Row, language: string): Row {
  const article = taArticle(row);
  const reference = formatObsReferenceLabel(text(row.reference));
  return {
    reference,
    id: text(row.id),
    quote: displayQuote(row, "quote"),
    taArticle: article,
    next: nextNotes(reference, language, text(row.id)),
  };
}

function bibleWord(
  row: Row,
  inputReference: string,
  book: string,
  language: string,
): Row {
  const article = twArticle(row);
  const reference = passageRowReference(
    inputReference,
    book,
    row.chapter,
    row.verse,
  );
  return {
    reference,
    quote: displayQuote(row, "origWords"),
    twArticle: article,
    ...(article ? { next: nextArticle(article.path, language) } : {}),
  };
}

function obsWord(row: Row, language: string): Row {
  const article = twArticle(row);
  const reference = formatObsReferenceLabel(text(row.reference));
  return {
    reference,
    quote: displayQuote(row, "origWords"),
    twArticle: article,
    ...(article ? { next: nextArticle(article.path, language) } : {}),
  };
}

function bibleIntroductions(
  rows: Row[],
  book: string,
  value: ReferenceRead,
  language: string,
): Array<Row & { id?: string }> {
  const intros = rows.filter((row) => text(row.verse) === "intro");
  const out: Array<Row & { id?: string }> = [];
  const front = intros.find((row) => text(row.chapter) === "front");
  if (front) {
    const reference = `${book} front:intro`;
    out.push({
      id: text(front.id),
      scope: "book",
      reference,
      title: headingTitle(text(front.note), "Introduction"),
      next: nextNotes(reference, language),
    });
  }
  if (value.kind !== "bible") return out;
  for (const chapter of coveredChapters(value)) {
    const row = intros.find((candidate) => text(candidate.chapter) === chapter);
    if (!row) continue;
    const reference = `${book} ${chapter}:intro`;
    out.push({
      id: text(row.id),
      scope: "chapter",
      reference,
      title: headingTitle(text(row.note), `Chapter ${chapter}`),
      next: nextNotes(reference, language),
    });
  }
  return out;
}

function obsIntroductions(
  rows: Row[],
  language: string,
): Array<Row & { id?: string }> {
  const out: Array<Row & { id?: string }> = [];
  for (const row of rows) {
    const raw = text(row.reference);
    if (!isObsIntroReference(raw)) continue;
    const reference = formatObsReferenceLabel(raw);
    out.push({
      id: text(row.id),
      scope: "story",
      reference,
      title: headingTitle(text(row.note), text(row.quote) || "Front matter"),
      next: nextNotes(reference, language),
    });
  }
  return out;
}

/**
 * A frame query does not include the story's `1:0` row. When that row is
 * missing, read the story once and keep only its front matter.
 */
async function rowsWithObsFrontMatter(
  client: ApiClient,
  value: ReferenceRead,
  language: string,
  notesSide: Side,
): Promise<Row[]> {
  const rows = notesSide.kind === "ok" ? asRows(notesSide.value.notes) : [];
  if (value.kind !== "obs" || value.story == null || value.frame == null) {
    return rows;
  }
  if (notesSide.kind !== "ok") return rows;
  if (rows.some((row) => isObsIntroReference(text(row.reference)))) return rows;
  const story = await fetchSide(client, "/api/v1/obs-notes", {
    reference: `OBS ${value.story}`,
    language,
  });
  if (story.kind !== "ok") return rows;
  const front = asRows(story.value.notes).filter((row) =>
    isObsIntroReference(text(row.reference)),
  );
  return [...rows, ...front];
}

function isObsIntroReference(reference: string): boolean {
  return (
    /^front(?::|$)/i.test(reference) ||
    /^\d+:0$/.test(reference) ||
    /^\d+:intro$/i.test(reference)
  );
}

function isIndexIntro(
  kind: ReferenceRead["kind"],
  row: Row,
  introIds: Set<string>,
): boolean {
  if (kind === "obs") return isObsIntroReference(text(row.reference));
  if (text(row.verse) === "intro" || text(row.chapter) === "front") return true;
  const id = text(row.id);
  return id !== "" && introIds.has(id);
}

function coveredChapters(value: BibleReferenceRead): string[] {
  const start = value.chapter;
  if (!start || start === "front") return [];
  if (!value.endChapter || value.endChapter === start) return [start];
  const from = Number(start);
  const to = Number(value.endChapter);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
    return [start];
  }
  const chapters: string[] = [];
  for (let n = from; n <= to; n++) chapters.push(String(n));
  return chapters;
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

function twArticle(row: Row): Article | null {
  const given = row.twArticle;
  if (given && typeof given === "object") {
    const path = text((given as Article).path);
    if (path) {
      return {
        path,
        category: twCategoryFromPath(path),
        title: text((given as Article).title),
      };
    }
  }
  const raw = text(row.wordPath) || text(row.twLink);
  if (!raw) return null;
  const path = raw.startsWith("rc://")
    ? (rcToTwPath(raw) ?? "")
    : raw.replace(/\.md$/i, "");
  if (!path) return null;
  return {
    path,
    category: twCategoryFromPath(path),
    title: text(row.twTitle) || text(resolveTitleFromPath(path)),
  };
}

function rollup(
  items: Article[],
  language: string,
  withCategory = false,
): Row[] {
  const map = new Map<string, Article & { count: number }>();
  for (const item of items) {
    const existing = map.get(item.path);
    if (existing) existing.count++;
    else map.set(item.path, { ...item, count: 1 });
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .map((item) => ({
      path: item.path,
      title: item.title,
      ...(withCategory
        ? { category: item.category ?? twCategoryFromPath(item.path) }
        : {}),
      count: item.count,
      next: nextArticle(item.path, language),
    }));
}

function nextNotes(reference: string, language: string, id?: string): NextCall {
  return {
    tool: "th_get_notes",
    args: {
      reference,
      language,
      ...(id ? { ids: [id] } : {}),
    },
  };
}

function nextArticle(path: string, language: string): NextCall {
  return { tool: "th_get_article", args: { path, language } };
}

function displayQuote(row: Row, rawKey: string): string {
  const gate = row.gatewayQuote;
  if (gate && typeof gate === "object") {
    const aligned = text((gate as { aligned?: unknown }).aligned);
    if (aligned) return aligned;
    const original = text((gate as { original?: unknown }).original);
    if (original) return original;
  }
  return text(row[rawKey]);
}

function headingTitle(note: string, fallback: string): string {
  for (const line of note.split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return fallback;
}

function page<T>(
  rows: T[],
  limit: number,
  offset: number,
): {
  rows: T[];
  total: number;
  hasMore: boolean;
} {
  const total = rows.length;
  const start = Math.min(offset, total);
  const sliced = rows.slice(start, start + limit);
  return { rows: sliced, total, hasMore: start + sliced.length < total };
}

function pageLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 200;
}

function pageOffset(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

type Side =
  | { kind: "ok"; value: Row }
  | { kind: "missing"; value: Row }
  | { kind: "failed"; reason: unknown };

async function fetchSide(
  client: ApiClient,
  path: string,
  params: { reference: string; language: string },
): Promise<Side> {
  try {
    const value = await client.get<Row>(path, params);
    if (value.available === false) return { kind: "missing", value };
    return { kind: "ok", value };
  } catch (reason) {
    if (reason instanceof ApiClientError && reason.status === 404) {
      return {
        kind: "missing",
        value: { available: false, message: reason.message },
      };
    }
    return { kind: "failed", reason };
  }
}

function gapMessages(
  language: string,
  notesSide: Side,
  wordsSide: Side,
): string[] {
  const messages: string[] = [];
  if (notesSide.kind === "missing") {
    messages.push(
      `Translation notes are not available for language "${language}".`,
    );
  }
  if (wordsSide.kind === "missing") {
    messages.push(`Word links are not available for language "${language}".`);
  }
  if (notesSide.kind === "failed") {
    messages.push(
      `Translation notes failed to load (${failureText(notesSide.reason)}).`,
    );
  }
  if (wordsSide.kind === "failed") {
    messages.push(
      `Word links failed to load (${failureText(wordsSide.reason)}).`,
    );
  }
  return messages;
}

function bothFailed(notesReason: unknown, wordsReason: unknown): Error {
  return new Error(
    `Translation notes failed (${failureText(notesReason)}). Word links failed (${failureText(wordsReason)}).`,
  );
}

function failureText(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return String(reason ?? "unknown error");
}

function cacheOf(notes?: Row, words?: Row): string | undefined {
  const sources = [cacheName(notes), cacheName(words)].filter(
    (value): value is string => Boolean(value),
  );
  if (sources.length === 0) return undefined;
  if (sources.includes("network")) return "network";
  if (sources.includes("r2")) return "r2";
  if (sources.includes("kv")) return "kv";
  return sources[0];
}

function cacheName(payload: Row | undefined): string | undefined {
  const meta = payload?.meta;
  if (!meta || typeof meta !== "object") return undefined;
  const cache = (meta as { cache?: unknown }).cache;
  return typeof cache === "string" ? cache : undefined;
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

function requireRead(params: {
  reference?: string;
  language?: string;
}): ReferenceRead {
  const read = readReference(params, params.language);
  if (!read.ok) throw invalid(read.message);
  return read.value;
}

function isBibleIntro(value: BibleReferenceRead): boolean {
  return (
    value.verse === "intro" || value.chapter === "front" || value.book === ""
  );
}

function invalid(message: string): TranslationHelpsError {
  return new TranslationHelpsError({
    code: ErrorCode.INVALID_REFERENCE,
    message,
  });
}
