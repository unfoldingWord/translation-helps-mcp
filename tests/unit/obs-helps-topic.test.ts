/**
 * OBS helps follow tc-study: stage=prod, one subject, no topic=tc-ready.
 * Bible notes and Open Bible Stories still require the topic.
 *
 * Door43's catalog search does not return a topics list on each row. When
 * several owners match, one extra catalog search with topic=tc-ready marks
 * the overlap. `topics: null` omits that list from the row; `repoTopics`
 * is what the tc-ready search returns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  clearCatalogProcessCache,
  getResourceZipUrl,
} from "@translation-helps/door43";
import {
  handleObsNotes,
  handleObsWordLinks,
} from "../../src/api/routes/obs.js";
import { getObsIndexTool } from "../../src/mcp/tools/getObsIndex.js";

interface FakeRepo {
  owner: string;
  name: string;
  language: string;
  subject: string;
  abbreviation: string;
  /** null: the catalog row omits topics, as Door43's search does. */
  topics: string[] | null;
  ingredients: Array<{ identifier: string; path: string }>;
  files: Record<string, string>;
  zipballUrl: string;
  repoTopics: string[];
}

const repos: FakeRepo[] = [];
const searchUrls: string[] = [];
let topicEndpointHits = 0;
let failTcReadyLookup = false;
let zipSeq = 0;

function addRepo(
  repo: Omit<FakeRepo, "zipballUrl" | "topics" | "repoTopics"> & {
    topics?: string[] | null;
    repoTopics?: string[];
  },
): FakeRepo {
  const tag = `v${++zipSeq}`;
  const topics = repo.topics === undefined ? ["tc-ready"] : repo.topics;
  const full: FakeRepo = {
    ...repo,
    topics,
    repoTopics: repo.repoTopics ?? topics ?? [],
    zipballUrl: `https://git.door43.org/${repo.owner}/${repo.name}/archive/${tag}.zip`,
  };
  repos.push(full);
  return full;
}

function catalogRow(repo: FakeRepo): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: repo.name,
    owner: repo.owner,
    language: repo.language,
    subject: repo.subject,
    abbreviation: repo.abbreviation,
    branch_or_tag_name: repo.zipballUrl.split("/").pop()!.replace(".zip", ""),
    zipball_url: repo.zipballUrl,
    ingredients: repo.ingredients,
  };
  if (repo.topics) row.topics = repo.topics;
  return row;
}

/** Topics the tc-ready catalog search should match. A null row list is omitted. */
function listedTopics(repo: FakeRepo): string[] {
  return repo.topics ?? repo.repoTopics;
}

function catalogSearch(url: URL): Record<string, unknown>[] {
  const p = url.searchParams;
  const subject = p.get("subject");
  return repos
    .filter((r) => !p.get("topic") || listedTopics(r).includes(p.get("topic")!))
    .filter((r) => !p.get("lang") || r.language === p.get("lang"))
    .filter(
      (r) => !p.get("abbreviation") || r.abbreviation === p.get("abbreviation"),
    )
    .filter((r) => !subject || r.subject === subject)
    .map(catalogRow);
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.pathname === "/api/v1/catalog/search") {
    searchUrls.push(url.href);
    if (failTcReadyLookup && url.searchParams.get("topic") === "tc-ready") {
      return new Response("down", { status: 503 });
    }
    return Response.json({ ok: true, data: catalogSearch(url) });
  }
  if (url.pathname === "/api/v1/catalog/list/languages") {
    const langs = [
      ...new Set(
        repos
          .filter((r) => (r.topics ?? []).includes("tc-ready"))
          .map((r) => r.language),
      ),
    ];
    return Response.json({ ok: true, data: langs.map((lang) => ({ lang })) });
  }
  if (url.pathname.startsWith("/api/v1/catalog/list/")) {
    return Response.json({ ok: true, data: [] });
  }
  const topicMatch = url.pathname.match(
    /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/topics$/,
  );
  if (topicMatch) {
    topicEndpointHits += 1;
    const owner = decodeURIComponent(topicMatch[1]!);
    const name = decodeURIComponent(topicMatch[2]!);
    const repo = repos.find((r) => r.owner === owner && r.name === name);
    return Response.json({ topics: repo?.repoTopics ?? [] });
  }
  const repo = repos.find((r) => r.zipballUrl === url.href);
  if (repo) {
    const entries = Object.fromEntries(
      Object.entries(repo.files).map(([path, text]) => [
        `${repo.name}/${path}`,
        strToU8(text),
      ]),
    );
    return new Response(zipSync(entries));
  }
  return new Response("not found", { status: 404 });
});

beforeEach(() => {
  repos.length = 0;
  searchUrls.length = 0;
  topicEndpointHits = 0;
  failTcReadyLookup = false;
  clearCatalogProcessCache();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function obsSearchUrls(): URL[] {
  return searchUrls
    .map((href) => new URL(href))
    .filter((url) => (url.searchParams.get("subject") ?? "").includes("OBS"));
}

function searchesFor(subject: string, topic: string | null): URL[] {
  return obsSearchUrls().filter(
    (url) =>
      url.searchParams.get("subject") === subject &&
      (topic === null
        ? !url.searchParams.has("topic")
        : url.searchParams.get("topic") === topic),
  );
}

function expectObsHelpsSearch(url: URL): void {
  const subject = url.searchParams.get("subject") ?? "";
  expect(url.searchParams.get("stage")).toBe("prod");
  expect(url.searchParams.has("topic")).toBe(false);
  expect(subject).not.toContain(",");
  expect(subject.length).toBeGreaterThan(0);
  expect(url.searchParams.getAll("subject")).toEqual([subject]);
}

const ID_TWL = [
  "Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink",
  "1:3\twfl8\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god",
].join("\n");

const UK_TN = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "1:1\tukn1\t\t\tGod\t1\tA note from uk_gt.",
].join("\n");

function twlRepo(
  owner: string,
  language: string,
  id: string,
  topics: string[] | null,
): void {
  addRepo({
    owner,
    name: `${language}_obs-twl`,
    language,
    subject: "TSV OBS Translation Words Links",
    abbreviation: "obs-twl",
    topics,
    ingredients: [{ identifier: "obs", path: "./twl_OBS.tsv" }],
    files: {
      "twl_OBS.tsv": [
        "Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink",
        `1:3\t${id}\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god`,
      ].join("\n"),
    },
  });
}

async function rest(
  handler: typeof handleObsNotes,
  reference: string,
  language: string,
  env: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await handler({
    url: new URL(
      `http://internal/api/v1/obs?reference=${encodeURIComponent(reference)}&language=${encodeURIComponent(language)}`,
    ),
    env: env as never,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

function wordIds(body: Record<string, unknown>): string[] {
  return (body.words as Array<{ id: string }>).map((word) => word.id);
}

const TWL_SUBJECT = "TSV OBS Translation Words Links";

describe("OBS helps without topic=tc-ready", () => {
  it("get_obs_index returns id 1:3 key terms from a repo with no tc-ready topic", async () => {
    addRepo({
      owner: "bahtraku",
      name: "id_obs-twl",
      language: "id",
      subject: "TSV OBS Translation Words Links",
      abbreviation: "obs-twl",
      topics: [],
      ingredients: [{ identifier: "obs", path: "./twl_OBS.tsv" }],
      files: { "twl_OBS.tsv": ID_TWL },
    });

    const api = {
      async fetch(input: RequestInfo | URL): Promise<Response> {
        const href =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const url = new URL(href);
        const handler = url.pathname.endsWith("/obs-word-links")
          ? handleObsWordLinks
          : handleObsNotes;
        return handler({ url, env: {} as never });
      },
    };
    const result = (await getObsIndexTool.handler(
      { reference: "1:3", language: "id" },
      { API: api } as never,
      "test",
    )) as { structuredContent?: Record<string, unknown> };

    const words = result.structuredContent?.words as Array<{
      id: string;
      twArticle: { path: string } | null;
    }>;
    const keyTerms = result.structuredContent?.keyTerms as Array<{
      path: string;
    }>;
    expect(words?.map((w) => w.id)).toEqual(["wfl8"]);
    expect(words?.[0]?.twArticle?.path).toBe("bible/kt/god");
    expect(keyTerms?.map((t) => t.path)).toEqual(["bible/kt/god"]);

    const obsUrls = obsSearchUrls();
    expect(obsUrls.length).toBeGreaterThan(0);
    for (const url of obsUrls) expectObsHelpsSearch(url);
    expect(
      obsUrls.some(
        (url) =>
          url.searchParams.get("subject") === "TSV OBS Translation Words Links",
      ),
    ).toBe(true);
  });

  it("GET /obs-notes finds uk_gt/uk_obs-tn with no tc-ready topic", async () => {
    addRepo({
      owner: "uk_gt",
      name: "uk_obs-tn",
      language: "uk",
      subject: "TSV OBS Translation Notes",
      abbreviation: "obs-tn",
      topics: [],
      ingredients: [{ identifier: "obs", path: "./tn_OBS.tsv" }],
      files: { "tn_OBS.tsv": UK_TN },
    });

    const body = await rest(handleObsNotes, "1:1", "uk");
    expect(body.available).not.toBe(false);
    expect((body.notes as Array<{ id: string }>).map((n) => n.id)).toEqual([
      "ukn1",
    ]);

    const obsUrls = obsSearchUrls();
    expect(obsUrls.length).toBeGreaterThan(0);
    for (const url of obsUrls) expectObsHelpsSearch(url);
  });

  it("prefers tc-ready with one catalog search, not one topics request per owner", async () => {
    twlRepo("unfoldingWord", "xx", "from-uw", null);
    twlRepo("other_gl", "xx", "from-ready", null);
    repos[0]!.repoTopics = [];
    repos[1]!.repoTopics = ["tc-ready"];

    const body = await rest(handleObsWordLinks, "1:3", "xx");
    expect(wordIds(body)).toEqual(["from-ready"]);
    expect(topicEndpointHits).toBe(0);

    const plain = searchesFor(TWL_SUBJECT, null);
    expect(plain.length).toBeGreaterThan(0);
    for (const url of plain) expectObsHelpsSearch(url);
    const ready = searchesFor(TWL_SUBJECT, "tc-ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]!.searchParams.get("stage")).toBe("prod");
    expect(ready[0]!.searchParams.getAll("subject")).toEqual([TWL_SUBJECT]);
  });

  it("uses topics already on the catalog rows and does not search again", async () => {
    twlRepo("unfoldingWord", "row", "from-uw", ["draft"]);
    twlRepo("other_gl", "row", "from-ready", ["tc-ready"]);

    const body = await rest(handleObsWordLinks, "1:3", "row");
    expect(wordIds(body)).toEqual(["from-ready"]);
    expect(topicEndpointHits).toBe(0);
    expect(searchesFor(TWL_SUBJECT, "tc-ready")).toHaveLength(0);
  });

  it("keeps the usual owner order when neither repo has tc-ready", async () => {
    twlRepo("other_gl", "yy", "from-other", null);
    twlRepo("unfoldingWord", "yy", "from-uw", null);
    repos[0]!.repoTopics = [];
    repos[1]!.repoTopics = [];

    const body = await rest(handleObsWordLinks, "1:3", "yy");
    expect(wordIds(body)).toEqual(["from-uw"]);
    expect(topicEndpointHits).toBe(0);
  });

  it("does not cache an owner choice when the tc-ready lookup fails", async () => {
    twlRepo("other_gl", "nf", "from-other", null);
    twlRepo("unfoldingWord", "nf", "from-uw", null);
    repos[0]!.repoTopics = ["tc-ready"];
    repos[1]!.repoTopics = [];
    failTcReadyLookup = true;

    const puts: string[] = [];
    const kv = {
      get: async () => null,
      put: async (key: string) => {
        puts.push(key);
      },
    };

    const first = await rest(handleObsWordLinks, "1:3", "nf", {
      TRANSLATION_HELPS_CACHE: kv,
    });
    expect(wordIds(first)).toEqual(["from-uw"]);
    expect(topicEndpointHits).toBe(0);
    const unfilteredAfterFirst = searchesFor(TWL_SUBJECT, null).length;
    expect(unfilteredAfterFirst).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cachedTwl = puts.filter((key) => {
      if (!key.startsWith("catalog:search:")) return false;
      const url = new URL(key.slice("catalog:search:".length));
      return url.searchParams.get("subject") === TWL_SUBJECT;
    });
    expect(cachedTwl).toEqual([]);

    const second = await rest(handleObsWordLinks, "1:3", "nf", {
      TRANSLATION_HELPS_CACHE: kv,
    });
    expect(wordIds(second)).toEqual(["from-uw"]);
    expect(searchesFor(TWL_SUBJECT, null).length).toBeGreaterThan(
      unfilteredAfterFirst,
    );
  });

  it("a repo that gains tc-ready wins after the catalog cache expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
    try {
      twlRepo("other_gl", "qa", "from-other", null);
      twlRepo("unfoldingWord", "qa", "from-uw", null);
      repos[0]!.repoTopics = [];
      repos[1]!.repoTopics = [];

      const first = await rest(handleObsWordLinks, "1:3", "qa");
      expect(wordIds(first)).toEqual(["from-uw"]);
      const readyAfterFirst = searchesFor(TWL_SUBJECT, "tc-ready").length;
      expect(readyAfterFirst).toBe(1);

      repos[0]!.repoTopics = ["tc-ready"];
      vi.setSystemTime(new Date("2026-10-29T12:59:00Z"));
      const cached = await rest(handleObsWordLinks, "1:3", "qa");
      expect(wordIds(cached)).toEqual(["from-uw"]);
      expect(searchesFor(TWL_SUBJECT, "tc-ready")).toHaveLength(
        readyAfterFirst,
      );

      vi.setSystemTime(new Date("2026-10-29T13:00:01Z"));
      const refreshed = await rest(handleObsWordLinks, "1:3", "qa");
      expect(wordIds(refreshed)).toEqual(["from-other"]);
      expect(searchesFor(TWL_SUBJECT, "tc-ready").length).toBeGreaterThan(
        readyAfterFirst,
      );
      expect(topicEndpointHits).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("subjects that still require tc-ready", () => {
  it("a Bible notes search still sends topic=tc-ready", async () => {
    addRepo({
      owner: "unfoldingWord",
      name: "en_tn",
      language: "en",
      subject: "TSV Translation Notes",
      abbreviation: "tn",
      ingredients: [],
      files: {},
    });
    addRepo({
      owner: "community",
      name: "bn_tn",
      language: "bn",
      subject: "TSV Translation Notes",
      abbreviation: "tn",
      topics: [],
      ingredients: [],
      files: {},
    });

    const en = await getResourceZipUrl("en", "TSV Translation Notes");
    expect(en?.entry.repo).toBe("en_tn");
    const bibleUrls = searchUrls.filter((href) => {
      const subject = new URL(href).searchParams.get("subject") ?? "";
      const abbreviation = new URL(href).searchParams.get("abbreviation") ?? "";
      return subject === "TSV Translation Notes" || abbreviation === "tn";
    });
    expect(bibleUrls.length).toBeGreaterThan(0);
    for (const href of bibleUrls) {
      const params = new URL(href).searchParams;
      expect(params.get("topic")).toBe("tc-ready");
      expect(params.get("stage")).toBe("prod");
    }

    searchUrls.length = 0;
    const bn = await getResourceZipUrl("bn", "TSV Translation Notes");
    expect(bn).toBeNull();
  });

  it("Open Bible Stories still searches with topic=tc-ready", async () => {
    addRepo({
      owner: "community",
      name: "en_obs",
      language: "en",
      subject: "Open Bible Stories",
      abbreviation: "obs",
      topics: [],
      ingredients: [],
      files: {},
    });

    const result = await getResourceZipUrl("en", "Open Bible Stories");
    expect(result).toBeNull();
    const urls = searchUrls.map((href) => new URL(href));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.searchParams.get("topic")).toBe("tc-ready");
      expect(url.searchParams.get("stage")).toBe("prod");
    }
  });
});
