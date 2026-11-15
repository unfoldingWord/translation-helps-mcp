/**
 * `/api/v1/search` from format 3 article catalogs. Answers only what is proven equal to the route's live answer
 * (`handleSearch`), `undefined` (the API Worker answers) for everything else:
 *
 * - Only a query the sweep proved equal for this release of the tW resource (verified.ts, the exact query in `ids`) is
 *   answered. Only tW is searched: a search over tA, including the default `types=ta,tw`, falls back.
 * - The ranking is the route's own (`rankArticles` over candidates ordered ta then tw), then `isSafeArticlePath`.
 * - Only `types=tw`, the default limit (5), the catalog's own language, and a query already in its normalized form (the
 *   route's cache is keyed by the normalized query and echoes the `q` of the first request) are answered.
 */
import { rankArticles } from "@translation-helps/door43";
import { isSafeArticlePath } from "../../core/articlePath";
import { normalizeSearchQuery } from "../../api/routes/responseCache";
import type { Packs3Env } from "../catalogs";
import type { Packs3Params } from "../answer";
import { SEARCH_KIND } from "../verified";
import { articleCatalogFromPacks3 } from "./articles";

export type SearchParams = {
  q: string;
  language: string;
  limit?: string | number;
  types?: string;
};

type Candidate = {
  path: string;
  title: string;
  category: string;
  resourceType: "ta" | "tw";
};

/** The route's ranking step over candidates, exported for the comparison tests. */
export function rankCandidates(
  candidates: Candidate[],
  q: string,
  topK: number,
) {
  return rankArticles(candidates, q, topK).filter((r) =>
    isSafeArticlePath(r.path),
  );
}

export async function searchFromPacks3(
  env: Packs3Env,
  params: SearchParams,
): Promise<unknown | undefined> {
  const { q, language } = params;
  if (!q || !language) return undefined;
  if ((params.types ?? "ta,tw") !== "tw") return undefined;
  if (params.limit !== undefined && String(params.limit) !== "5")
    return undefined;
  if (q !== normalizeSearchQuery(q)) return undefined;

  const tw = await articleCatalogFromPacks3(env, language, "tw", {
    kind: SEARCH_KIND,
    item: q,
  });
  if (!tw || tw.language !== language) return undefined;
  const candidates: Candidate[] = tw.articles.map((a) => ({
    path: a.path,
    title: a.title,
    category: a.category,
    resourceType: "tw",
  }));
  const results = rankCandidates(candidates, q, 5);
  return { q, language: tw.language, requestedLanguage: language, results };
}

export const searchAdapterParams = (params: Packs3Params): SearchParams => ({
  q: String(params.q ?? ""),
  language: String(params.language ?? ""),
  ...(params.limit !== undefined ? { limit: params.limit } : {}),
  ...(params.types !== undefined ? { types: String(params.types) } : {}),
});
