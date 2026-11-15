/**
 * `/api/v1/search` from format 3 article catalogs. Answers only what is proven equal to the route's live answer
 * (`handleSearch`), `undefined` (the API Worker answers) for everything else:
 *
 * - Only a query the sweep proved equal for this release of every resource the types set reads (verified.ts, the exact
 *   item in `ids`: `q` for tw, `ta|q`, `ta,tw|q`) is answered. A types set not swept falls back.
 * - The ranking is the route's own (`rankArticles` over candidates ordered ta then tw), then `isSafeArticlePath`.
 * - Only `types` tw, ta or ta,tw (the default), the default limit (5), the catalog's own language, and a query already in its normalized form (the
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

/** The swept item of a types set: `tw` keeps the plain query, the others are `"<types>|<query>"` (the sweep's own form). */
const proofItem = (types: string, q: string) =>
  types === "tw" ? q : `${types}|${q}`;

export async function searchFromPacks3(
  env: Packs3Env,
  params: SearchParams,
): Promise<unknown | undefined> {
  const { q, language } = params;
  if (!q || !language) return undefined;
  const types = params.types ?? "ta,tw";
  // Only the type sets the sweep covers; any other spelling (`tw,ta`, `ta,ta`) falls back.
  if (types !== "tw" && types !== "ta" && types !== "ta,tw") return undefined;
  if (params.limit !== undefined && String(params.limit) !== "5")
    return undefined;
  if (q !== normalizeSearchQuery(q)) return undefined;

  // Every resource the answer needs must have a search proof for this type set; candidates are ordered ta then tw.
  const candidates: Candidate[] = [];
  let answered = language;
  for (const kind of ["ta", "tw"] as const) {
    if (!types.split(",").includes(kind)) continue;
    const cat = await articleCatalogFromPacks3(env, language, kind, {
      kind: SEARCH_KIND,
      item: proofItem(types, q),
    });
    if (!cat || cat.language !== language) return undefined;
    answered = cat.language;
    for (const a of cat.articles)
      candidates.push({
        path: a.path,
        title: a.title,
        category: a.category,
        resourceType: kind,
      });
  }
  const results = rankCandidates(candidates, q, 5);
  return { q, language: answered, requestedLanguage: language, results };
}

export const searchAdapterParams = (params: Packs3Params): SearchParams => ({
  q: String(params.q ?? ""),
  language: String(params.language ?? ""),
  ...(params.limit !== undefined ? { limit: params.limit } : {}),
  ...(params.types !== undefined ? { types: String(params.types) } : {}),
});
