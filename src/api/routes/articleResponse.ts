/**
 * Shared JSON for /words/{path} and /academy/{path}.
 *
 * The article body stays the zip markdown. Link rewriting happens in the
 * MCP tools, which need paths the model can pass back. `related` is included
 * here because the titles live in the catalog this route already loaded.
 */

import { json, apiError } from "../worker.js";
import { extractTitleFromMarkdown } from "@translation-helps/door43";
import type { ArticleMatch } from "../../core/articleResolve.js";
import { rewriteHelpsLinks } from "../../core/articleLinks.js";

export function jsonArticleMatch(options: {
  kind: "tw" | "ta";
  language: string;
  requestedLanguage: string;
  requestedPath: string;
  match: ArticleMatch;
  article: string | null;
  titleOf: (path: string) => string | undefined;
}): Response {
  const {
    kind,
    language,
    requestedLanguage,
    requestedPath,
    match,
    article,
    titleOf,
  } = options;
  const tool = kind === "tw" ? "get_word_article" : "get_academy_article";
  const label = kind === "tw" ? "Translation Words" : "Translation Academy";

  if (match.status === "ambiguous") {
    return json({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `Several ${label} articles match "${requestedPath}". Call ${tool} again with one of these paths.`,
      requestedPath,
      candidates: match.candidates,
      language,
      requestedLanguage,
    });
  }

  if (match.status === "miss" || !article) {
    const missing =
      kind === "tw" ? "Translation Word" : "Translation Academy article";
    return apiError(
      "NOT_FOUND",
      `${missing} not found at path: "${requestedPath}"`,
      404,
    );
  }

  const title = match.title || extractTitleFromMarkdown(article);
  const related = rewriteHelpsLinks(
    article,
    { kind, path: match.path },
    titleOf,
  ).related;

  return json({
    language,
    requestedLanguage,
    path: match.path,
    requestedPath,
    ...(match.status === "resolved"
      ? {
          resolvedFrom: match.resolvedFrom,
          ...(match.note ? { note: match.note } : {}),
        }
      : {}),
    title,
    article,
    related,
  });
}
