/**
 * OBS Study Notes (SN) and Study Questions (SQ) — REST + MCP (#67).
 *
 * Fixtures (./fixtures/obs-study.ts) are trimmed from live
 * unfoldingWord/en_obs-sn sn_OBS.tsv and unfoldingWord/en_obs-sq sq_OBS.tsv
 * (same columns as OBS-TN / OBS-TQ; SQ rows include frame ranges like 1:1-8
 * that must cover a 1:3 request).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseObsNotesTsv,
  parseObsQuestionsTsv,
  parseObsReference,
} from "@translation-helps/door43";
import {
  SAMPLE_SN_TSV,
  SAMPLE_SQ_TSV,
  SQ_1_2_4_IDS,
  SQ_FRONT_IDS,
  SQ_STORY_1_IDS,
} from "./fixtures/obs-study.js";

describe("OBS study TSV fixtures (real-file shapes)", () => {
  it("SN 1:1 returns the four notes for that frame", () => {
    const notes = parseObsNotesTsv(SAMPLE_SN_TSV, parseObsReference("1:1")!);
    expect(notes.map((n) => n.id)).toEqual(["prf0", "qs8q", "b70w", "wcjr"]);
    expect(notes[0].quote).toBe("God");
    expect(notes[0].note).toContain("eternal being");
  });

  it("SN reference=1 returns every note in story 1", () => {
    const notes = parseObsNotesTsv(SAMPLE_SN_TSV, parseObsReference("1")!);
    expect(notes.map((n) => n.id)).toEqual([
      "prf0",
      "qs8q",
      "b70w",
      "wcjr",
      "t4c6",
      "bwkg",
    ]);
  });

  it("SQ 1:3 matches range rows whose frame range covers frame 3 (v1 behavior)", () => {
    const questions = parseObsQuestionsTsv(
      SAMPLE_SQ_TSV,
      parseObsReference("1:3")!,
    );
    expect(questions.map((q) => q.id).sort()).toEqual(["kn32", "tmdk", "toi2"]);
    expect(questions.find((q) => q.id === "toi2")?.question).toContain(
      "create everything",
    );
  });
});

const catalog = vi.hoisted(() => ({
  zips: new Map<string, Map<string, string>>(),
  files: new Map<string, string>(),
}));

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    resolveCatalogLanguage: async (lang: string) => ({
      language: lang,
      entries: [],
    }),
    getResourceZipUrl: async (lang: string, subject: string) => {
      const bySubject = catalog.zips.get(lang);
      if (!bySubject) return null;
      const preferred = subject.includes(",")
        ? subject.split(",")[0]!.trim()
        : subject;
      const zipUrl =
        bySubject.get(preferred) ??
        bySubject.get(subject) ??
        [...bySubject.entries()].find(([s]) =>
          subject.split(",").some((p) => p.trim() === s),
        )?.[1];
      if (!zipUrl) return null;
      return {
        zipUrl,
        entry: {
          owner: "unfoldingWord",
          repo: `${lang}_obs`,
          name: `${lang}_obs`,
          ingredients: [],
          catalog: { prod: { zipball_url: zipUrl } },
        },
      };
    },
    ZipResourceFetcher2: class {
      async getOrDownloadZip(url: string): Promise<Uint8Array> {
        return new TextEncoder().encode(url);
      }
      async extractFileFromZip(
        _zip: Uint8Array,
        path: string,
      ): Promise<string | null> {
        return (
          catalog.files.get(path) ??
          catalog.files.get(path.toLowerCase()) ??
          null
        );
      }
    },
  };
});

import {
  handleObsStudyNotes,
  handleObsStudyQuestions,
} from "../../src/api/routes/obs.js";
import { getObsStudyNotesTool } from "../../src/mcp/tools/getObsStudyNotes.js";
import { getObsStudyQuestionsTool } from "../../src/mcp/tools/getObsStudyQuestions.js";
import { MCP_TOOLS, TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";

const SN_SUBJECT = "TSV OBS Study Notes";
const SQ_SUBJECT = "TSV OBS Study Questions";

function putSn(language: string, tsv: string): void {
  const zip = `https://example.test/${language}-obs-sn.zip`;
  const bySubject = catalog.zips.get(language) ?? new Map();
  bySubject.set(SN_SUBJECT, zip);
  catalog.zips.set(language, bySubject);
  catalog.files.set("sn_OBS.tsv", tsv);
}

function putSq(language: string, tsv: string): void {
  const zip = `https://example.test/${language}-obs-sq.zip`;
  const bySubject = catalog.zips.get(language) ?? new Map();
  bySubject.set(SQ_SUBJECT, zip);
  catalog.zips.set(language, bySubject);
  catalog.files.set("sq_OBS.tsv", tsv);
}

beforeEach(() => {
  catalog.zips.clear();
  catalog.files.clear();
  putSn("en", SAMPLE_SN_TSV);
  putSq("en", SAMPLE_SQ_TSV);
});

async function getJson(
  handler: typeof handleObsStudyNotes,
  path: string,
  reference: string,
  language: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler({
    url: new URL(
      `http://internal${path}?reference=${encodeURIComponent(reference)}&language=${encodeURIComponent(language)}`,
    ),
    env: {} as never,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe("GET /api/v1/obs-study-notes", () => {
  it("returns SN notes for reference=1:1&language=en", async () => {
    const { body } = await getJson(
      handleObsStudyNotes,
      "/api/v1/obs-study-notes",
      "1:1",
      "en",
    );
    expect(body.available).not.toBe(false);
    const notes = body.notes as Array<{ id: string }>;
    expect(notes.map((n) => n.id)).toEqual(["prf0", "qs8q", "b70w", "wcjr"]);
  });

  it("returns the whole story for reference=1", async () => {
    const { body } = await getJson(
      handleObsStudyNotes,
      "/api/v1/obs-study-notes",
      "1",
      "en",
    );
    const notes = body.notes as Array<{ id: string }>;
    expect(notes).toHaveLength(6);
  });

  it("returns RESOURCE_NOT_AVAILABLE for es-419 with a clear message", async () => {
    const { body } = await getJson(
      handleObsStudyNotes,
      "/api/v1/obs-study-notes",
      "1:1",
      "es-419",
    );
    expect(body.available).toBe(false);
    expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(String(body.message)).toMatch(
      /No OBS Study Notes resource available for language "es-419"/,
    );
  });

  it("rejects an invalid reference like OBS-TN", async () => {
    const { status, body } = await getJson(
      handleObsStudyNotes,
      "/api/v1/obs-study-notes",
      "JHN 3:16",
      "en",
    );
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("BAD_REQUEST");
    expect(String((body.error as { message: string }).message)).toMatch(
      /Invalid OBS reference/,
    );
  });
});

describe("GET /api/v1/obs-study-questions", () => {
  it("returns SQ questions whose range covers 1:3 (same as v1)", async () => {
    const { body } = await getJson(
      handleObsStudyQuestions,
      "/api/v1/obs-study-questions",
      "1:3",
      "en",
    );
    const questions = body.questions as Array<{ id: string }>;
    expect(questions.map((q) => q.id).sort()).toEqual(["kn32", "tmdk", "toi2"]);
  });

  it.each([
    ["front", SQ_FRONT_IDS],
    ["1:2-4", SQ_1_2_4_IDS],
    ["1", SQ_STORY_1_IDS],
  ])("returns the same SQ IDs as v1 for reference=%s", async (ref, ids) => {
    const { body } = await getJson(
      handleObsStudyQuestions,
      "/api/v1/obs-study-questions",
      ref,
      "en",
    );
    const questions = body.questions as Array<{ id: string }>;
    expect(questions.map((q) => q.id)).toEqual(ids);
  });

  it("returns RESOURCE_NOT_AVAILABLE for es-419 with a clear message", async () => {
    const { body } = await getJson(
      handleObsStudyQuestions,
      "/api/v1/obs-study-questions",
      "1:3",
      "es-419",
    );
    expect(body.available).toBe(false);
    expect(body.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(String(body.message)).toMatch(
      /No OBS Study Questions resource available for language "es-419"/,
    );
  });

  it("rejects an invalid reference like OBS-TN", async () => {
    const { status, body } = await getJson(
      handleObsStudyQuestions,
      "/api/v1/obs-study-questions",
      "not-a-ref",
      "en",
    );
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("BAD_REQUEST");
  });
});

async function mcpCall(
  tool: typeof getObsStudyNotesTool,
  apiPath: string,
  params: { reference: string; language: string },
  restHandler: typeof handleObsStudyNotes,
): Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}> {
  const api = {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(href);
      if (url.pathname.endsWith(apiPath)) {
        return restHandler({
          url: new URL(
            `http://internal${apiPath}?${url.searchParams.toString()}`,
          ),
          env: {} as never,
        });
      }
      return new Response("{}", { status: 404 });
    },
  };
  return (await tool.handler(params, { API: api } as never, "test")) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
}

describe("MCP get_obs_study_notes / get_obs_study_questions", () => {
  it("get_obs_study_notes returns the same notes as REST", async () => {
    const result = await mcpCall(
      getObsStudyNotesTool,
      "/api/v1/obs-study-notes",
      { reference: "1:1", language: "en" },
      handleObsStudyNotes,
    );
    expect(result.isError).not.toBe(true);
    const notes = result.structuredContent?.notes as Array<{ id: string }>;
    expect(notes.map((n) => n.id)).toEqual(["prf0", "qs8q", "b70w", "wcjr"]);
  });

  it("get_obs_study_questions returns the same questions as REST for 1:3", async () => {
    const result = await mcpCall(
      getObsStudyQuestionsTool,
      "/api/v1/obs-study-questions",
      { reference: "1:3", language: "en" },
      handleObsStudyQuestions,
    );
    expect(result.isError).not.toBe(true);
    const questions = result.structuredContent?.questions as Array<{
      id: string;
    }>;
    expect(questions.map((q) => q.id).sort()).toEqual(["kn32", "tmdk", "toi2"]);
  });

  it("missing language soft-fails RESOURCE_NOT_AVAILABLE with isError false", async () => {
    const result = await mcpCall(
      getObsStudyNotesTool,
      "/api/v1/obs-study-notes",
      { reference: "1:1", language: "es-419" },
      handleObsStudyNotes,
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.code).toBe("RESOURCE_NOT_AVAILABLE");
    expect(result.structuredContent?.available).toBe(false);
  });
});

describe("tools/list includes study tools", () => {
  it("registers get_obs_study_notes and get_obs_study_questions", () => {
    const names = MCP_TOOLS.map((t) => t.name as string);
    expect(names).toContain("get_obs_study_notes");
    expect(names).toContain("get_obs_study_questions");
    expect(TOOL_REGISTRY["get_obs_study_notes"]).toBeDefined();
    expect(TOOL_REGISTRY["get_obs_study_questions"]).toBeDefined();
  });

  it("has exactly 15 tools (13 prior + 2 study)", () => {
    expect(MCP_TOOLS).toHaveLength(15);
  });
});
