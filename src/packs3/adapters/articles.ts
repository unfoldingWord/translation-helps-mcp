/**
 * `/api/v1/words/{path}` and `/api/v1/academy/{path}` from format 3 article groups. Like the other adapters it answers
 * only what the routes answer the same way and gives `undefined` for the rest (the API Worker then answers as today):
 *
 * - Only an article the sweep proved equal for this release of its resource (verified.ts, item = catalog path in `ids`)
 *   is answered; the requested language must be the catalog's. A bare term or title (no `/`) that is not an exact path
 *   resolves against the resource's whole catalog and is answered only as a swept term item (`terms`, `isVerifiedTerm`):
 *   equal for this release, resolving to the article recorded for it, which is itself a clean item.
 * - A path that does not resolve to one article (a miss or several candidates) gives `undefined`: format 3 does not say
 *   "not found" or "not available" on its own, the API Worker decides (its catalog may hold an article this pack lacks).
 *   The one exception is a proven miss: a bare term swept as a miss (`misses`, `isVerifiedMiss`, which needs the equal
 *   search catalog proof of the release: the route's catalog is ours) that misses here too gets the route's own 404
 *   `Response` (`jsonArticleMatch`), which answer.ts passes on as the API's error.
 * - The body is rebuilt from the sections exactly as the zip file reads. Format 3 rewrites Bible reference links as
 *   `](ref:act 4:33)` and keeps no trace of the published form; the canonical `rc://<lang>/tn/help/act/04/33` is rebuilt
 *   and the sweep proves it per article (one published otherwise is an exception). `[[ta:`, `[[tw:` gives `undefined`.
 * - The path resolution is the route's own (`resolveTwArticle` / `resolveTaArticle`, `jsonArticleMatch`); an exact path is
 *   resolved in its own group, a bare term in the whole catalog; anything else gives `undefined`.
 */
import type { AcademyArticle, WordArticle } from "@translation-helps/door43";
import type { PackReader } from "../../../vendor/language-pack-client/index.js";
import {
  assertPreparedArticlePath,
  resolveTaArticle,
  resolveTwArticle,
  type ArticleMatch,
} from "../../core/articleResolve";
import type { ArticleCatalog } from "../../api/routes/articleCatalog";
import { rewriteHelpsLinks } from "../../core/articleLinks";
import { jsonArticleMatch } from "../../api/routes/articleResponse";
import { sourceFromPackView } from "../../api/routes/packViews";
import type { Catalogs3, Packs3Env } from "../catalogs";
import { warnOnce } from "../keys";
import { withReader } from "../readers";
import type { Packs3Params } from "../answer";
import {
  isVerified,
  isVerifiedMiss,
  isVerifiedTerm,
  releaseOfCatalogs,
  SEARCH_CATALOG_KIND,
  searchCatalogExcept,
} from "../verified";

export type ArticleKind = "tw" | "ta";
export const GROUPS: Record<ArticleKind, string[]> = {
  tw: ["tw:kt", "tw:names", "tw:other"],
  ta: ["ta:translate", "ta:checking", "ta:process", "ta:intro"],
};
const SUBJECT: Record<ArticleKind, string> = {
  tw: "Translation Words",
  ta: "Translation Academy",
};

type Section = { level: number; title?: string; md: string };
type Raw = {
  id: string;
  res: string;
  title: string;
  subtitle?: string;
  sections: Section[];
};
type Rec = { path: string; title: string; res: string; group: string };
type Resource = { key: string; subject: string; release: string };

/** Catalog path of an article id: `tw:kt/grace` is `bible/kt/grace`, `ta:translate/x` is `translate/x`. */
export function pathOfId(id: string): string {
  return id.startsWith("tw:") ? `bible/${id.slice(3)}` : id.replace(/^ta:/, "");
}

/** Group records, by catalog key and group: they hold titles only. */
const groupCache = new Map<string, Rec[]>();
const MAX_CACHED_GROUPS = 24;

/** Tests only: forget the cached group records. */
export function resetArticleGroupsForTests(): void {
  groupCache.clear();
}

async function loadGroup(
  reader: PackReader,
  c: Catalogs3,
  group: string,
): Promise<Rec[] | undefined> {
  const k = `${c.key}|${group}`;
  const hit = groupCache.get(k);
  if (hit) return hit;
  if (!reader.listed(`art:${group}`)) return undefined;
  const raw = (await reader.articles(group)) as Raw[] | undefined;
  if (!Array.isArray(raw)) return undefined;
  const recs: Rec[] = [];
  for (const a of raw) {
    if (
      typeof a?.id !== "string" ||
      typeof a.title !== "string" ||
      typeof a.res !== "string" ||
      // the category comes from the group, the path from the id: the route takes the category from the path
      !a.id.startsWith(`${group}/`)
    )
      return undefined;
    recs.push({ path: pathOfId(a.id), title: a.title, res: a.res, group });
  }
  if (groupCache.size >= MAX_CACHED_GROUPS) groupCache.clear();
  groupCache.set(k, recs);
  return recs;
}

function releaseOf(c: Catalogs3, kind: ArticleKind, key: string) {
  const own = c.catalogs.find((x) => x.name !== "common");
  const resources = ((own?.catalog as { resources?: Resource[] })?.resources ??
    []) as Resource[];
  return resources.find((r) => r.key === key && r.subject === SUBJECT[kind]);
}

function asCatalogArticles(
  kind: ArticleKind,
  recs: Rec[],
): Array<WordArticle | AcademyArticle> {
  return recs.map((r) =>
    kind === "tw"
      ? ({
          path: r.path,
          title: r.title,
          category: r.group.slice(3) as "kt" | "other" | "names",
        } as WordArticle)
      : ({
          path: r.path,
          title: r.title,
          category: r.path.split("/")[0] ?? r.path,
        } as AcademyArticle),
  );
}

async function fullCatalog(
  reader: PackReader,
  c: Catalogs3,
  kind: ArticleKind,
): Promise<Rec[] | undefined> {
  const all: Rec[] = [];
  for (const g of GROUPS[kind]) {
    const recs = await loadGroup(reader, c, g);
    if (!recs) return undefined;
    all.push(...recs);
  }
  return all.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The article catalog the routes build from Door43, built from the article groups. `undefined` when `proof` is not swept.
 * Under the search catalog kind it carries `except`: the ids its verdict excepts (`searchCatalogExcept`, `[]` if equal).
 */
export async function articleCatalogFromPacks3(
  env: Packs3Env,
  lang: string,
  kind: ArticleKind,
  /** The sweep item that must be proven for the catalog's resource release (search: the query; the search catalog kind: none). */
  proof?: { kind: string; item?: string },
): Promise<
  | (ArticleCatalog<WordArticle | AcademyArticle> & { except?: string[] })
  | undefined
> {
  const out = await withReader(env, lang, async (reader, c) => {
    if (c.lang !== lang) return undefined;
    const recs = await fullCatalog(reader, c, kind);
    if (!recs || recs.length === 0) return undefined;
    const keys = new Set(recs.map((r) => r.res));
    if (keys.size !== 1) return undefined;
    const key = recs[0]!.res;
    const resource = releaseOf(c, kind, key);
    if (!resource) return undefined;
    const opts = { releaseOf: releaseOfCatalogs(c.catalogs) };
    const except =
      proof?.kind === SEARCH_CATALOG_KIND && proof.item === undefined
        ? searchCatalogExcept(c.lang, key, resource.release, opts)
        : undefined;
    if (
      !proof ||
      (proof.kind === SEARCH_CATALOG_KIND
        ? except === undefined
        : !isVerified(
            c.lang,
            key,
            resource.release,
            proof.kind,
            proof.item,
            opts,
          ))
    ) {
      warnOnce(lang, "unverified-resource");
      return undefined;
    }
    const source = sourceFromPackView(
      { articles: { key, title: "", version: resource.release } },
      "articles",
    );
    if (!source) return undefined;
    return {
      language: c.lang,
      zipUrl: "",
      articles: asCatalogArticles(kind, recs),
      source,
      ...(except !== undefined ? { except } : {}),
    } as ArticleCatalog<WordArticle | AcademyArticle> & { except?: string[] };
  });
  return out ?? undefined;
}

/** The article as the zip file reads, or `undefined` when a link cannot be put back the way it was published. */
export function bodyOf(
  kind: ArticleKind,
  art: Raw,
  lang: string,
): string | undefined {
  const blocks: string[] = [];
  if (kind === "tw") blocks.push(`# ${art.title}`);
  for (const s of art.sections) {
    if (typeof s.md !== "string") return undefined;
    if (s.title !== undefined) blocks.push(`${"#".repeat(s.level)} ${s.title}`);
    if (s.md !== "") blocks.push(s.md);
  }
  // Format 3 rewrites a Bible reference link as `](ref:act 4:33)` and keeps no trace of the published form. It is
  // rebuilt in the canonical form (`rc://<lang>/tn/help/act/04/33`, psalms 3-digit chapter); the sweep proves each
  // article, and one published otherwise (`/01/5`, `rc://*`, a verse range) differs and stays an exception.
  const pad = (n: string, w: number) => n.padStart(w, "0");
  const body = (blocks.join("\n\n") + "\n").replace(
    /\]\(ref:([a-z0-9]{3}) (\d+):(\d+)\)/g,
    (_m, bk: string, c: string, v: string) =>
      `](rc://${lang}/tn/help/${bk}/${pad(c, bk === "psa" ? 3 : 2)}/${pad(v, 2)})`,
  );
  if (/\]\(ref:|\[\[(?:ta|tw):/.test(body)) return undefined;
  return body;
}

export type ArticleParams = {
  /** The path as the route receives it (after `/words/` or `/academy/`). */
  pathParam: string;
  language: string;
  requestedPath?: string;
  prepared?: string;
};

async function articleFromPacks3(
  env: Packs3Env,
  kind: ArticleKind,
  params: ArticleParams,
): Promise<Record<string, unknown> | Response | undefined> {
  const { pathParam, language } = params;
  if (!language || !pathParam) return undefined;
  let prepared: string;
  try {
    // Only what MCP prepared already (prepared=1): the route's REST preparation is left to the route.
    if (params.prepared !== "1") return undefined;
    prepared = assertPreparedArticlePath(pathParam);
  } catch {
    return undefined;
  }
  const requestedPath = (params.requestedPath ?? pathParam).slice(0, 512);
  const resolve = kind === "tw" ? resolveTwArticle : resolveTaArticle;

  const answer = await withReader(env, language, async (reader, c) => {
    if (c.lang !== language) return undefined;
    // An exact path resolves inside its own group: try each group (an exact hit does not depend on the others).
    let match: ArticleMatch | undefined;
    let recs: Rec[] | undefined;
    for (const g of GROUPS[kind]) {
      const group = await loadGroup(reader, c, g);
      if (!group) continue;
      const m = resolve(prepared, asCatalogArticles(kind, group));
      if (m.status === "exact") {
        match = m;
        recs = group;
        break;
      }
    }
    // Not an exact path: a bare term or title resolves against the whole catalog of its resource. It is served only as a
    // swept term item (`isVerifiedTerm`): equal for this release, resolving to the article recorded for it, a clean item.
    let term: string | undefined;
    if (!match) {
      if (prepared.includes("/")) return undefined;
      const all = await fullCatalog(reader, c, kind);
      if (!all || all.length === 0) return undefined;
      if (new Set(all.map((r) => r.res)).size !== 1) return undefined;
      const m = resolve(prepared, asCatalogArticles(kind, all));
      if (m.status === "miss") {
        const res = all[0]!.res;
        const resource = releaseOf(c, kind, res);
        if (
          !resource ||
          !isVerifiedMiss(
            c.lang,
            res,
            resource.release,
            prepared.toLowerCase(),
            { releaseOf: releaseOfCatalogs(c.catalogs) },
          )
        ) {
          warnOnce(language, "unverified-resource");
          return undefined;
        }
        // The route's own miss answer (a 404 whose message echoes `requestedPath`).
        return jsonArticleMatch({
          kind,
          language: c.lang,
          requestedLanguage: language,
          requestedPath,
          match: m,
          article: null,
          titleOf: () => undefined,
        });
      }
      if (m.status !== "resolved") return undefined;
      match = m;
      recs = all;
      term = prepared.toLowerCase();
    }
    if (match.status !== "exact" && match.status !== "resolved")
      return undefined;
    const matched = match;

    const rec = (recs ?? []).find((r) => r.path === matched.path);
    if (!rec) return undefined;
    const proofOf = releaseOf(c, kind, rec.res);
    const opts = { releaseOf: releaseOfCatalogs(c.catalogs) };
    if (
      !proofOf ||
      !(term === undefined
        ? isVerified(
            c.lang,
            rec.res,
            proofOf.release,
            "articles",
            rec.path,
            opts,
          )
        : isVerifiedTerm(
            c.lang,
            rec.res,
            proofOf.release,
            term,
            rec.path,
            opts,
          ))
    ) {
      warnOnce(language, "unverified-resource");
      return undefined;
    }
    const raw = (await reader.articles(rec.group)) as Raw[] | undefined;
    const art = raw?.find((a) => pathOfId(a.id) === rec.path);
    if (!art) return undefined;
    const article = bodyOf(kind, art, c.lang);
    if (article === undefined) return undefined;
    const resource = releaseOf(c, kind, rec.res);
    if (!resource) return undefined;
    const source = sourceFromPackView(
      { articles: { key: rec.res, title: "", version: resource.release } },
      "articles",
    );
    if (!source) return undefined;

    // Titles for the links of the body: only the groups the links point to; a group that cannot load gives `undefined`.
    const titles = new Map<string, string>();
    for (const r of recs ?? []) titles.set(r.path, r.title);
    const wanted = new Set<string>();
    rewriteHelpsLinks(article, { kind, path: matched.path }, (p) => {
      wanted.add(p);
      return undefined;
    });
    for (const p of wanted) {
      const group =
        kind === "tw"
          ? `tw:${p.split("/")[1] ?? ""}`
          : `ta:${p.split("/")[0] ?? ""}`;
      if (!GROUPS[kind].includes(group)) continue;
      const more = await loadGroup(reader, c, group);
      if (!more) return undefined;
      for (const r of more) titles.set(r.path, r.title);
    }

    let subtitle: string | undefined;
    if (kind === "ta") {
      const s = art.subtitle?.replace(/^#+\s*/, "").trim();
      if (s) subtitle = s;
    }
    const res = jsonArticleMatch({
      kind,
      language: c.lang,
      requestedLanguage: language,
      requestedPath,
      match: matched,
      article,
      titleOf: (p) => titles.get(p),
      ...(subtitle ? { subtitle } : {}),
      source,
    });
    if (res.status !== 200) return undefined;
    const out = (await res.json()) as Record<string, unknown>;
    return out;
  });
  return answer ?? undefined;
}

export const wordsPathFromPacks3 = (env: Packs3Env, params: ArticleParams) =>
  articleFromPacks3(env, "tw", params);
export const academyPathFromPacks3 = (env: Packs3Env, params: ArticleParams) =>
  articleFromPacks3(env, "ta", params);

/** Registered in `ADAPTERS` for `/api/v1/words/{path}` and `/api/v1/academy/{path}`. */
export function articleAdapterParams(
  path: string,
  prefix: string,
  params: Packs3Params,
): ArticleParams {
  return {
    pathParam: path.slice(prefix.length),
    language: String(params.language ?? ""),
    ...(params.requestedPath !== undefined
      ? { requestedPath: String(params.requestedPath) }
      : {}),
    ...(params.prepared !== undefined
      ? { prepared: String(params.prepared) }
      : {}),
  };
}
