/**
 * `/api/v1/search` from format 3 article catalogs. Answers only what is proven equal to the route's live answer
 * (`handleSearch`), `undefined` (the API Worker answers) for everything else:
 *
 * - Any query, when every resource the types set reads has a search catalog proof for its release (verified.ts
 *   `SEARCH_CATALOG_KIND`): the catalog the ranking reads was equal to the route's. The ranking (`rankArticles`) reads
 *   only each candidate's path, title (and the comma-separated alternate names in it), category and resource type, the
 *   candidates' order (ties: score, then path) and the query; nothing from article bodies. So an equal catalog ranks
 *   every query the same. A proof `equalExcept` (ids that differ from the route's only in case) serves a query only
 *   when its ranked results hold none of the excepted ids (compared lowercased); otherwise the query proof below.
 * - Otherwise only a query the sweep proved equal for this release of every resource the types set reads (verified.ts,
 *   the exact item in `ids`: `q` for tw, `ta|q`, `ta,tw|q`) is answered. A types set not swept falls back. The two
 *   proofs are never mixed in one answer.
 * - The ranking is the route's own (`rankArticles` over candidates ordered ta then tw), then `isSafeArticlePath`.
 * - Only `types` tw, ta or ta,tw (the default), the default limit (5), the catalog's own language, and a query already in its normalized form (the
 *   route's cache is keyed by the normalized query and echoes the `q` of the first request) are answered.
 */
import { rankArticles } from "@translation-helps/door43";
import { isSafeArticlePath } from "../../core/articlePath";
import { normalizeSearchQuery } from "../../api/routes/responseCache";
import type { Packs3Env } from "../catalogs";
import type { Packs3Params } from "../answer";
import { SEARCH_CATALOG_KIND, SEARCH_KIND } from "../verified";
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

  // Any query when every catalog is proven; the key is then not the query, so `|` does not matter.
  const byCatalog = await candidatesOf(env, language, types, {
    kind: SEARCH_CATALOG_KIND,
  });
  if (byCatalog) {
    const served = answer(q, language, byCatalog.candidates);
    if (!served.results.some((r) => byCatalog.except.has(r.path.toLowerCase())))
      return served;
  }

  // `|` is the separator of the proof keys (`ta|q`, `ta,tw|q`): a query holding one could name another set's item.
  if (q.includes("|")) return undefined;
  const byQuery = await candidatesOf(env, language, types, {
    kind: SEARCH_KIND,
    item: proofItem(types, q),
  });
  return byQuery ? answer(q, language, byQuery.candidates) : undefined;
}

const answer = (q: string, language: string, candidates: Candidate[]) => ({
  q,
  language,
  requestedLanguage: language,
  results: rankCandidates(candidates, q, 5),
});

/**
 * Every resource the types set needs, each proven by `proof`; candidates ordered ta then tw. `undefined` if one is not.
 * `except`: under the search catalog kind, the ids every catalog's verdict excepts (lowercased); a catalog proof that
 * does not say them (no `except` list) is no proof.
 */
async function candidatesOf(
  env: Packs3Env,
  language: string,
  types: string,
  proof: { kind: string; item?: string },
): Promise<{ candidates: Candidate[]; except: Set<string> } | undefined> {
  const candidates: Candidate[] = [];
  const except = new Set<string>();
  for (const kind of ["ta", "tw"] as const) {
    if (!types.split(",").includes(kind)) continue;
    const cat = await articleCatalogFromPacks3(env, language, kind, proof);
    if (!cat || cat.language !== language) return undefined;
    if (proof.kind === SEARCH_CATALOG_KIND) {
      if (!Array.isArray(cat.except)) return undefined;
      for (const id of cat.except) except.add(String(id).toLowerCase());
    }
    for (const a of cat.articles)
      candidates.push({
        path: a.path,
        title: a.title,
        category: a.category,
        resourceType: kind,
      });
  }
  return { candidates, except };
}

export const searchAdapterParams = (params: Packs3Params): SearchParams => ({
  q: String(params.q ?? ""),
  language: String(params.language ?? ""),
  ...(params.limit !== undefined ? { limit: params.limit } : {}),
  ...(params.types !== undefined ? { types: String(params.types) } : {}),
});
