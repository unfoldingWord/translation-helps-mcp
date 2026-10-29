/**
 * OBS helps follow tc-study: stage=prod, one subject, no topic=tc-ready.
 * Bible notes and Open Bible Stories still require the topic.
 *
 * Door43's catalog search does not return a topics list on each row, so a
 * fixture that must prefer tc-ready among two owners answers
 * GET /repos/{owner}/{repo}/topics instead.
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

function catalogSearch(url: URL): Record<string, unknown>[] {
  const p = url.searchParams;
  const subject = p.get("subject");
  return repos
    .filter(
      (r) => !p.get("topic") || (r.topics ?? []).includes(p.get("topic")!),
    )
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
): Promise<Record<string, unknown>> {
  const response = await handler({
    url: new URL(
      `http://internal/api/v1/obs?reference=${encodeURIComponent(reference)}&language=${encodeURIComponent(language)}`,
    ),
    env: {} as never,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

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

  it("prefers the owner that has tc-ready when two owners match without the topic filter", async () => {
    twlRepo("unfoldingWord", "xx", "from-uw", null);
    twlRepo("other_gl", "xx", "from-ready", null);
    repos[0]!.repoTopics = [];
    repos[1]!.repoTopics = ["tc-ready"];

    const body = await rest(handleObsWordLinks, "1:3", "xx");
    expect((body.words as Array<{ id: string }>).map((w) => w.id)).toEqual([
      "from-ready",
    ]);

    const obsUrls = obsSearchUrls();
    expect(obsUrls.length).toBeGreaterThan(0);
    for (const url of obsUrls) expectObsHelpsSearch(url);
  });

  it("keeps the usual owner order when neither repo has tc-ready", async () => {
    twlRepo("other_gl", "yy", "from-other", null);
    twlRepo("unfoldingWord", "yy", "from-uw", null);
    repos[0]!.repoTopics = [];
    repos[1]!.repoTopics = [];

    const body = await rest(handleObsWordLinks, "1:3", "yy");
    expect((body.words as Array<{ id: string }>).map((w) => w.id)).toEqual([
      "from-uw",
    ]);
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
