/**
 * OBS Study Notes / Study Questions through the real catalog path (#67).
 *
 * Only `fetch` is mocked: a fake Door43 catalog search (lang / subject /
 * abbreviation / topic filters) and the zip downloads. Subject constants,
 * SUBJECT_TO_SUFFIX, variant resolution, owner choice and the TSV path taken
 * from the catalog ingredients all run for real, so a language that publishes
 * SN/SQ later works with no code change.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { clearCatalogProcessCache } from "@translation-helps/door43";
import {
  handleObsStudyNotes,
  handleObsStudyQuestions,
} from "../../src/api/routes/obs.js";
import { getObsStudyNotesTool } from "../../src/mcp/tools/getObsStudyNotes.js";
import { getObsStudyQuestionsTool } from "../../src/mcp/tools/getObsStudyQuestions.js";
import { handleResources } from "../../src/api/routes/resources.js";
import {
  SAMPLE_SN_TSV,
  SAMPLE_SQ_TSV,
  SN_1_1_IDS,
  SQ_1_3_IDS,
} from "./fixtures/obs-study.js";

interface FakeRepo {
  owner: string;
  name: string;
  language: string;
  subject: string;
  abbreviation: string;
  topics: string[];
  ingredients: Array<{ identifier: string; path: string }>;
  /** Zip entries, relative to the repo folder inside the archive. */
  files: Record<string, string>;
  zipballUrl: string;
}

const repos: FakeRepo[] = [];
let zipSeq = 0;

function addRepo(
  repo: Omit<FakeRepo, "zipballUrl" | "topics"> & {
    topics?: string[];
  },
): FakeRepo {
  // A fresh tag per repo keeps the fetcher's URL-keyed process caches apart.
  const tag = `v${++zipSeq}`;
  const full: FakeRepo = {
    topics: ["tc-ready"],
    ...repo,
    zipballUrl: `https://git.door43.org/${repo.owner}/${repo.name}/archive/${tag}.zip`,
  };
  repos.push(full);
  return full;
}

function catalogRow(repo: FakeRepo): Record<string, unknown> {
  return {
    name: repo.name,
    owner: repo.owner,
    language: repo.language,
    subject: repo.subject,
    abbreviation: repo.abbreviation,
    branch_or_tag_name: repo.zipballUrl.split("/").pop()!.replace(".zip", ""),
    zipball_url: repo.zipballUrl,
    ingredients: repo.ingredients,
  };
}

function catalogSearch(url: URL): Record<string, unknown>[] {
  const p = url.searchParams;
  const subjects = p
    .get("subject")
    ?.split(",")
    .map((s) => s.trim());
  return repos
    .filter((r) => !p.get("topic") || r.topics.includes(p.get("topic")!))
    .filter((r) => !p.get("lang") || r.language === p.get("lang"))
    .filter(
      (r) => !p.get("abbreviation") || r.abbreviation === p.get("abbreviation"),
    )
    .filter((r) => !subjects || subjects.includes(r.subject))
    .filter((r) => !p.get("owner") || r.owner === p.get("owner"))
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
    return Response.json({ ok: true, data: catalogSearch(url) });
  }
  if (url.pathname === "/api/v1/catalog/list/languages") {
    const langs = [
      ...new Set(
        repos
          .filter((r) => r.topics.includes("tc-ready"))
          .map((r) => r.language),
      ),
    ];
    return Response.json({ ok: true, data: langs.map((lang) => ({ lang })) });
  }
  if (url.pathname.startsWith("/api/v1/catalog/list/")) {
    return Response.json({ ok: true, data: [] });
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
  clearCatalogProcessCache();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function rest(
  handler: typeof handleObsStudyNotes,
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

async function mcp(
  tool: typeof getObsStudyNotesTool,
  handler: typeof handleObsStudyNotes,
  reference: string,
  language: string,
): Promise<{ isError?: boolean; structuredContent?: Record<string, unknown> }> {
  const api = {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = new URL(String(input instanceof Request ? input.url : input));
      return handler({ url, env: {} as never });
    },
  };
  return (await tool.handler(
    { reference, language },
    { API: api } as never,
    "test",
  )) as { isError?: boolean; structuredContent?: Record<string, unknown> };
}

function ids(rows: unknown): string[] {
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

/** The tool's notAvailable() result, not an ok() wrapping the REST body. */
function expectMcpNotAvailable(result: {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}): void {
  expect(result.isError).toBe(false);
  expect(result.structuredContent?.available).toBe(false);
  expect(result.structuredContent?.code).toBe("RESOURCE_NOT_AVAILABLE");
  expect(result.structuredContent?.hints).toEqual([
    expect.stringContaining("list_resources"),
  ]);
}

describe("a third language under a non-unfoldingWord owner", () => {
  beforeEach(() => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-tn",
      language: "xyz",
      subject: "TSV OBS Translation Notes",
      abbreviation: "obs-tn",
      ingredients: [{ identifier: "obs", path: "./tn_OBS.tsv" }],
      files: {
        "tn_OBS.tsv":
          "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n1:1\twrong\t\t\t\t\tTN, not SN",
      },
    });
  });

  it("gets OBS Study Notes from REST and MCP", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(body.language).toBe("xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);

    const result = await mcp(
      getObsStudyNotesTool,
      handleObsStudyNotes,
      "1:1",
      "xyz",
    );
    expect(result.isError).not.toBe(true);
    expect(ids(result.structuredContent?.notes)).toEqual(SN_1_1_IDS);
  });

  it("gets OBS Study Questions from REST and MCP", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sq",
      language: "xyz",
      subject: "TSV OBS Study Questions",
      abbreviation: "obs-sq",
      ingredients: [{ identifier: "obs", path: "./sq_OBS.tsv" }],
      files: { "sq_OBS.tsv": SAMPLE_SQ_TSV },
    });

    const body = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(body.language).toBe("xyz");
    expect(ids(body.questions)).toEqual(SQ_1_3_IDS);

    const result = await mcp(
      getObsStudyQuestionsTool,
      handleObsStudyQuestions,
      "1:3",
      "xyz",
    );
    expect(result.isError).not.toBe(true);
    expect(ids(result.structuredContent?.questions)).toEqual(SQ_1_3_IDS);
  });

  it("is RESOURCE_NOT_AVAILABLE when the catalog has OBS-TN but no SQ", async () => {
    const body = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(body.available).toBe(false);
    expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(String(body.message)).toMatch(
      /No OBS Study Questions resource available for language "xyz"/,
    );

    const result = await mcp(
      getObsStudyQuestionsTool,
      handleObsStudyQuestions,
      "1:3",
      "xyz",
    );
    expectMcpNotAvailable(result);
  });

  it("is RESOURCE_NOT_AVAILABLE over MCP when the catalog has no SN", async () => {
    const result = await mcp(
      getObsStudyNotesTool,
      handleObsStudyNotes,
      "1:1",
      "xyz",
    );
    expectMcpNotAvailable(result);
  });

  it("finds a Study Notes row that has no tc-ready topic", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      topics: [],
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(body.available).not.toBe(false);
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });
});

describe("catalog rows whose abbreviation is not obs-sn / obs-sq", () => {
  it("finds Study Notes by subject when the abbreviation is obs-sn-tsv", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn-tsv",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });

  it("finds Study Questions by subject when the abbreviation is obs-sq-tsv", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sq",
      language: "xyz",
      subject: "TSV OBS Study Questions",
      abbreviation: "obs-sq-tsv",
      ingredients: [{ identifier: "obs", path: "./sq_OBS.tsv" }],
      files: { "sq_OBS.tsv": SAMPLE_SQ_TSV },
    });

    const body = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(ids(body.questions)).toEqual(SQ_1_3_IDS);
  });
});

describe("TSV path from the catalog ingredients", () => {
  it("reads Study Notes from the ingredient path (./sn_OBS_xyz.tsv)", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [
        { identifier: "front", path: "./content/front.md" },
        { identifier: "obs", path: "./sn_OBS_xyz.tsv" },
      ],
      files: { "sn_OBS_xyz.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });

  it("reads Study Questions from the ingredient path (./sq_OBS_xyz.tsv)", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sq",
      language: "xyz",
      subject: "TSV OBS Study Questions",
      abbreviation: "obs-sq",
      ingredients: [{ identifier: "obs", path: "./sq_OBS_xyz.tsv" }],
      files: { "sq_OBS_xyz.tsv": SAMPLE_SQ_TSV },
    });

    const body = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(ids(body.questions)).toEqual(SQ_1_3_IDS);
  });

  it("falls back to sn_OBS.tsv when the catalog lists no TSV ingredient", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });
});

describe("TSV missing from the zip", () => {
  const study = [
    {
      kind: "Notes",
      tool: getObsStudyNotesTool,
      handler: handleObsStudyNotes,
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredient: "./sn_OBS_xyz.tsv",
    },
    {
      kind: "Questions",
      tool: getObsStudyQuestionsTool,
      handler: handleObsStudyQuestions,
      subject: "TSV OBS Study Questions",
      abbreviation: "obs-sq",
      ingredient: "./sq_OBS_xyz.tsv",
    },
  ] as const;

  it.each(study)(
    "Study $kind is RESOURCE_NOT_AVAILABLE over REST and MCP",
    async ({ kind, tool, handler, subject, abbreviation, ingredient }) => {
      addRepo({
        owner: "xyz_gl",
        name: `xyz_${abbreviation}`,
        language: "xyz",
        subject,
        abbreviation,
        ingredients: [{ identifier: "obs", path: ingredient }],
        files: { "README.md": "no TSV here" },
      });

      const body = await rest(handler, "1:1", "xyz");
      expect(body.available).toBe(false);
      expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
      expect(String(body.message)).toBe(
        `OBS Study ${kind} TSV not found in resource for language "xyz".`,
      );

      expectMcpNotAvailable(await mcp(tool, handler, "1:1", "xyz"));
    },
  );
});

describe("language variant resolution", () => {
  it("serves xyz from the only catalog variant xyz-x-abc", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz-x-abc_obs-sn",
      language: "xyz-x-abc",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });
    addRepo({
      owner: "xyz_gl",
      name: "xyz-x-abc_obs-sq",
      language: "xyz-x-abc",
      subject: "TSV OBS Study Questions",
      abbreviation: "obs-sq",
      ingredients: [{ identifier: "obs", path: "./sq_OBS.tsv" }],
      files: { "sq_OBS.tsv": SAMPLE_SQ_TSV },
    });

    const notes = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(notes.language).toBe("xyz-x-abc");
    expect(ids(notes.notes)).toEqual(SN_1_1_IDS);

    const questions = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(questions.language).toBe("xyz-x-abc");
    expect(ids(questions.questions)).toEqual(SQ_1_3_IDS);

    const result = await mcp(
      getObsStudyNotesTool,
      handleObsStudyNotes,
      "1:1",
      "xyz",
    );
    expect(result.structuredContent?.language).toBe("xyz-x-abc");
    expect(ids(result.structuredContent?.notes)).toEqual(SN_1_1_IDS);
  });
});

describe("subject labels without the TSV prefix", () => {
  it("finds Study Notes under subject 'OBS Study Notes'", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "OBS Study Notes",
      abbreviation: "obs-sn-tsv",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });

  it("finds Study Questions under subject 'OBS Study Questions'", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sq",
      language: "xyz",
      subject: "OBS Study Questions",
      abbreviation: "obs-sq-tsv",
      ingredients: [{ identifier: "obs", path: "./sq_OBS.tsv" }],
      files: { "sq_OBS.tsv": SAMPLE_SQ_TSV },
    });

    const body = await rest(handleObsStudyQuestions, "1:3", "xyz");
    expect(ids(body.questions)).toEqual(SQ_1_3_IDS);
  });
});

describe("owner choice", () => {
  it("prefers unfoldingWord when two owners publish SN for the language", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: {
        "sn_OBS.tsv":
          "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote\n1:1\tzzzz\t\t\tGod\t1\tother owner",
      },
    });
    addRepo({
      owner: "unfoldingWord",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: { "sn_OBS.tsv": SAMPLE_SN_TSV },
    });

    const body = await rest(handleObsStudyNotes, "1:1", "xyz");
    expect(ids(body.notes)).toEqual(SN_1_1_IDS);
  });
});

describe("list_resources", () => {
  it("lists obsStudyNotes and obsStudyQuestions for a third language", async () => {
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sn",
      language: "xyz",
      subject: "TSV OBS Study Notes",
      abbreviation: "obs-sn-tsv",
      ingredients: [{ identifier: "obs", path: "./sn_OBS.tsv" }],
      files: {},
    });
    addRepo({
      owner: "xyz_gl",
      name: "xyz_obs-sq",
      language: "xyz",
      subject: "OBS Study Questions",
      abbreviation: "obs-sq",
      ingredients: [{ identifier: "obs", path: "./sq_OBS.tsv" }],
      files: {},
    });

    const response = await handleResources({
      url: new URL("http://internal/api/v1/resources?language=xyz"),
      env: {} as never,
    });
    const body = (await response.json()) as {
      available: Array<{ type: string; role: string; abbreviation: string }>;
    };
    const study = body.available
      .filter((r) => r.type.startsWith("obsStudy"))
      .map(({ type, role, abbreviation }) => ({ type, role, abbreviation }));
    expect(study).toEqual([
      {
        type: "obsStudyNotes",
        role: "obsStudyNotes",
        abbreviation: "obs-sn-tsv",
      },
      {
        type: "obsStudyQuestions",
        role: "obsStudyQuestions",
        abbreviation: "obs-sq",
      },
    ]);
  });
});
