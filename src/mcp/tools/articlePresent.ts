/**
 * MCP view of a TW or TA article.
 *
 * The REST route returns the zip markdown unchanged. Here, links become
 * paths the article tools accept, and `related` keeps the catalog titles.
 */

import { rewriteHelpsLinks } from "../../core/articleLinks.js";
import type { ResolvedFrom } from "../../core/articleResolve.js";

export interface ArticlePayload {
  language?: string;
  path?: string;
  title?: string;
  article?: string;
  requestedPath?: string;
  resolvedFrom?: ResolvedFrom;
  note?: string;
  related?: Array<{ path: string; title: string }>;
  available?: boolean;
  code?: string;
  message?: string;
  hints?: string[];
  candidates?: Array<{ path: string; title: string }>;
  /** Translation Academy question, from sub-title.md when the zip has one. */
  subtitle?: string;
}

export function presentArticle(
  data: ArticlePayload,
  kind: "tw" | "ta",
  fallbackPath: string,
): Record<string, unknown> {
  if (data.available === false) {
    return {
      available: false,
      code: data.code ?? "RESOURCE_NOT_AVAILABLE",
      message: data.message ?? "",
      requestedPath: data.requestedPath ?? fallbackPath,
      candidates: data.candidates ?? [],
      ...(data.hints ? { hints: data.hints } : {}),
    };
  }

  const path = data.path ?? fallbackPath;
  const titles = new Map(
    (data.related ?? []).map((item) => [item.path, item.title]),
  );
  const presented = rewriteHelpsLinks(
    data.article ?? "",
    { kind, path },
    (item) => titles.get(item),
  );

  return {
    language: data.language,
    path,
    title: data.title ?? "",
    article: presented.article,
    requestedPath: data.requestedPath ?? fallbackPath,
    ...(data.resolvedFrom ? { resolvedFrom: data.resolvedFrom } : {}),
    ...(data.note ? { note: data.note } : {}),
    related: presented.related,
  };
}
