/**
 * v3 th_get_article — one tool for Translation Words and Translation Academy.
 *
 * The path decides the catalog. A bare term tries both catalogs.
 * One resolved article is returned even when the other catalog is only
 * ambiguous; those titles go in otherCandidates. Two resolved articles
 * stay as candidates. Resolution stays on the words and academy routes
 * (T-050): this tool does not keep a second copy of it. detail "summary"
 * shortens the body.
 */

import { z } from "zod";
import { ApiClient, ApiClientError } from "../../apiClient.js";
import type { Env } from "../../agent.js";
import {
  prepareArticlePath,
  RESOLVED_FROM,
} from "../../../core/articleResolve.js";
import {
  ok,
  withNotAvailableOutput,
  type ToolResult,
} from "../../tools/shared.js";
import {
  presentArticle,
  type ArticlePayload,
} from "../../tools/articlePresent.js";
import { summarizeArticle } from "../articleSummary.js";
import { v3LanguageParam } from "../params.js";

const RC_TW = /^rc:\/\/[^/]+\/tw\//i;
const RC_TA = /^rc:\/\/[^/]+\/ta\//i;
const TA_ROOT = /^(translate|checking|intro|process)\//i;

const ARTICLE_MISS_HINT =
  "No Translation Words or Translation Academy article was found. The term may be explained in translation notes. For a known verse, use th_get_passage_index or th_get_notes.";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "A catalog path (bible/kt/covenant, translate/figs-metaphor), an rc:// link, or a term such as covenant or metaphor.",
    ),
  language: v3LanguageParam,
  detail: z
    .enum(["full", "summary"])
    .default("full")
    .describe(
      '"full" (default) is the whole article. "summary" keeps the title with the definition and translation suggestions, or the title with the academy question and its first section.',
    ),
});

export const GET_ARTICLE_DESCRIPTION =
  "Returns a Translation Words article (the meaning of a biblical key term and how to translate it, e.g. covenant, grace, Sheol) or a Translation Academy article (a translation principle or figure of speech, e.g. metaphor, metonymy). Pass a path from another tool (bible/kt/covenant, translate/figs-metaphor), an rc:// link from a note, or just the term. The server finds the article and returns the path it used; when it matched only part of a title it adds resolvedFrom and a note, so tell the reader. If several articles match, it returns candidates and no article: call again with one path, or use the verse's index to choose. If one catalog resolves the term and the other only has similar titles, the article is returned and those titles are otherCandidates. detail \"summary\" keeps the title with the definition and translation suggestions (Words) or the title with the question and description (Academy), for short answers. If those sections are missing, the opening of the article comes back with a note. related lists linked articles, each with its path, title and next. If the language has no article for the term, it says so; the term may be covered in a verse's notes instead.";

const nextSchema = z.object({
  tool: z.literal("th_get_article"),
  args: z.object({
    path: z.string(),
    language: z.string().optional(),
  }),
});

const candidateSchema = z.object({
  path: z.string(),
  title: z.string(),
  type: z.enum(["tw", "ta"]),
  next: nextSchema,
});

const outputSchema = withNotAvailableOutput({
  path: z.string().optional(),
  type: z.enum(["tw", "ta"]).optional(),
  title: z.string().optional(),
  article: z.string().optional(),
  language: z.string().optional(),
  requestedPath: z.string().optional(),
  resolvedFrom: z.enum(RESOLVED_FROM).optional(),
  note: z.string().optional(),
  related: z
    .array(
      z.object({
        path: z.string(),
        title: z.string(),
        next: nextSchema,
      }),
    )
    .optional(),
  candidates: z.array(candidateSchema).optional(),
  otherCandidates: z.array(candidateSchema).optional(),
});

type ArticleType = "tw" | "ta";
type Detail = "full" | "summary";

interface NextCall {
  tool: "th_get_article";
  args: { path: string; language?: string };
}

interface Candidate {
  path: string;
  title: string;
  type: ArticleType;
  next: NextCall;
}

type Side =
  | { status: "hit"; type: ArticleType; data: ArticlePayload }
  | {
      status: "ambiguous";
      type: ArticleType;
      candidates: Array<{ path: string; title: string }>;
    }
  | { status: "miss"; type: ArticleType };

function articleSide(raw: string, prepared: string): ArticleType | "either" {
  const trimmed = raw.trim();
  if (RC_TW.test(trimmed) || /^bible\//i.test(prepared)) return "tw";
  if (RC_TA.test(trimmed) || TA_ROOT.test(prepared)) return "ta";
  return "either";
}

function nextArticle(path: string, language: string): NextCall {
  return {
    tool: "th_get_article",
    args: {
      path,
      ...(language === "en" ? {} : { language }),
    },
  };
}

function joinNote(left?: string, right?: string): string | undefined {
  if (left && right) return `${left} ${right}`;
  return left || right;
}

function languageOf(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function asRelated(value: unknown): Array<{ path: string; title: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is { path: string; title: string } =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { path?: unknown }).path === "string" &&
      typeof (item as { title?: unknown }).title === "string",
  );
}

function presentHit(
  data: ArticlePayload,
  type: ArticleType,
  requestedPath: string,
  detail: Detail,
  requestLanguage: string,
): Record<string, unknown> {
  const presented = presentArticle(data, type, requestedPath);
  const language = languageOf(presented.language, requestLanguage);
  let article = String(presented.article ?? "");
  let note = typeof presented.note === "string" ? presented.note : undefined;
  if (detail === "summary") {
    const summary = summarizeArticle(
      type,
      String(presented.title ?? ""),
      article,
      data.subtitle,
    );
    article = summary.article;
    note = joinNote(note, summary.note);
  }
  return {
    ...(typeof presented.language === "string"
      ? { language: presented.language }
      : {}),
    path: presented.path,
    type,
    title: presented.title ?? "",
    article,
    requestedPath: presented.requestedPath ?? requestedPath,
    ...(typeof presented.resolvedFrom === "string"
      ? { resolvedFrom: presented.resolvedFrom }
      : {}),
    ...(note ? { note } : {}),
    related: asRelated(presented.related).map((item) => ({
      path: item.path,
      title: item.title,
      next: nextArticle(item.path, language),
    })),
  };
}

function candidateFromHit(
  data: ArticlePayload,
  type: ArticleType,
  requestLanguage: string,
): Candidate {
  const path = data.path ?? "";
  const language = languageOf(data.language, requestLanguage);
  return {
    path,
    title: data.title ?? "",
    type,
    next: nextArticle(path, language),
  };
}

function notAvailableResult(
  message: string,
  requestedPath: string,
  candidates: Candidate[],
  hint?: string,
): ToolResult {
  const data = {
    available: false,
    code: "RESOURCE_NOT_AVAILABLE",
    message,
    requestedPath,
    candidates,
    ...(hint ? { hints: [hint] } : {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
}

async function fetchSide(
  client: ApiClient,
  type: ArticleType,
  prepared: string,
  requestedPath: string,
  language: string,
): Promise<Side> {
  const root = type === "tw" ? "words" : "academy";
  const encoded = prepared.split("/").map(encodeURIComponent).join("/");
  try {
    const data = await client.get<ArticlePayload>(
      `/api/v1/${root}/${encoded}`,
      { language, requestedPath, prepared: "1" },
    );
    if (data.available === false) {
      return {
        status: "ambiguous",
        type,
        candidates: data.candidates ?? [],
      };
    }
    return { status: "hit", type, data };
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return { status: "miss", type };
    }
    throw error;
  }
}

function candidatesOf(
  side: Extract<Side, { status: "ambiguous" }>,
  requestLanguage: string,
): Candidate[] {
  return side.candidates.map((item) => ({
    path: item.path,
    title: item.title,
    type: side.type,
    next: nextArticle(item.path, requestLanguage),
  }));
}

function choose(
  sides: Side[],
  requestedPath: string,
  requestLanguage: string,
  detail: Detail,
) {
  const hits = sides.filter(
    (side): side is Extract<Side, { status: "hit" }> => side.status === "hit",
  );
  const ambiguous = sides.filter(
    (side): side is Extract<Side, { status: "ambiguous" }> =>
      side.status === "ambiguous",
  );
  // One real article wins. Titles from the other catalog stay visible,
  // but they are not a second hit and the tool does not ask the caller to pick.
  if (hits.length === 1) {
    const hit = hits[0]!;
    const body = presentHit(
      hit.data,
      hit.type,
      requestedPath,
      detail,
      requestLanguage,
    );
    const otherCandidates = ambiguous.flatMap((side) =>
      candidatesOf(side, requestLanguage),
    );
    if (otherCandidates.length > 0) {
      body.otherCandidates = otherCandidates;
    }
    const title = String(body.title ?? requestedPath);
    return ok(
      body,
      `${hit.type === "tw" ? "Word" : "Academy"} article: ${title}`,
    );
  }

  const candidates: Candidate[] = [];
  for (const side of sides) {
    if (side.status === "hit") {
      candidates.push(candidateFromHit(side.data, side.type, requestLanguage));
    } else if (side.status === "ambiguous") {
      candidates.push(...candidatesOf(side, requestLanguage));
    }
  }
  if (candidates.length === 0) {
    return notAvailableResult(
      `No Translation Words or Translation Academy article was found for "${requestedPath}".`,
      requestedPath,
      [],
      ARTICLE_MISS_HINT,
    );
  }
  return notAvailableResult(
    `Several articles match "${requestedPath}". Call th_get_article again with one of these paths.`,
    requestedPath,
    candidates,
  );
}

export const getArticleV3Tool = {
  name: "th_get_article",
  description: GET_ARTICLE_DESCRIPTION,
  inputSchema,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    title: "Get Article",
  },

  async handler(
    params: z.input<typeof inputSchema>,
    env: Env,
    _requestId: string,
  ): Promise<ToolResult> {
    const requestedPath = params.path;
    const language = params.language || "en";
    const detail = params.detail ?? "full";
    const prepared = prepareArticlePath(requestedPath);
    const side = articleSide(requestedPath, prepared);
    const client = new ApiClient(env);
    const jobs: Array<Promise<Side>> = [];
    if (side !== "ta") {
      jobs.push(fetchSide(client, "tw", prepared, requestedPath, language));
    }
    if (side !== "tw") {
      jobs.push(fetchSide(client, "ta", prepared, requestedPath, language));
    }
    return choose(await Promise.all(jobs), requestedPath, language, detail);
  },
};
