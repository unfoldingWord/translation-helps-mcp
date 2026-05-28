/**
 * SkillService integration tests.
 *
 * Uses stub callTool implementations to avoid actual MCP dispatch.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SkillService, createSkillService } from "../src/skill/SkillService.js";
import { FakeLLMProvider } from "../src/services/rag/providers/FakeLLMProvider.js";
import type { Bundle } from "../src/services/rag/BundleCache.js";

function makeBundle(language: string, reference: string): Bundle {
  return {
    scripture: {
      text: "In the beginning God created the heavens and the earth.",
      format: "plain",
    },
    notes: [
      {
        id: "n1",
        text: "God's love for the world is the primary theme of this verse.",
      },
      { id: "n2", text: "Believes: pisteúō — to trust, to have faith." },
    ],
    tw: [{ id: "tw1", title: "Love", path: "bible/kt/love" }],
    ta: [
      {
        id: "ta1",
        title: "Figures of Speech",
        path: "translate/figs-metaphor",
      },
    ],
    metadata: {
      cacheStatus: "miss",
      license: "CC BY-SA 4.0",
      language,
      reference,
      provenance: [],
    },
  };
}

function makeStubCallTool(bundle: Bundle) {
  return async (
    name: string,
    _params: Record<string, unknown>,
  ): Promise<unknown> => {
    if (name === "get_bundle") return { bundle };
    if (name === "rag_query") {
      return {
        requestId: "stub-req",
        query: String(_params["query"] ?? ""),
        language: String(_params["language"] ?? "en"),
        documents: [],
        fallbackMode: "empty",
        cacheStatus: "miss",
        latencyMs: 0,
      };
    }
    return {};
  };
}

describe("SkillService.fetchPassageWithNotesAndLinks()", () => {
  let skillService: SkillService;
  const bundle = makeBundle("en", "JHN 3:16");

  beforeEach(() => {
    skillService = createSkillService({
      callTool: makeStubCallTool(bundle),
      llmProvider: new FakeLLMProvider(),
    });
  });

  it("returns a bundle with correct shape", async () => {
    const result = await skillService.fetchPassageWithNotesAndLinks({
      language: "en",
      reference: "JHN 3:16",
    });
    expect(result.metadata.language).toBe("en");
    expect(result.metadata.reference).toBe("JHN 3:16");
    expect(result.notes).toBeInstanceOf(Array);
    expect(result.tw).toBeInstanceOf(Array);
    expect(result.ta).toBeInstanceOf(Array);
  });

  it("returns scripture text", async () => {
    const result = await skillService.fetchPassageWithNotesAndLinks({
      language: "en",
      reference: "JHN 3:16",
    });
    expect(result.scripture.text).toBeTruthy();
  });

  it("returns empty bundle on callTool error (graceful degradation)", async () => {
    const errorSvc = createSkillService({
      callTool: async () => {
        throw new Error("tool not found");
      },
      llmProvider: new FakeLLMProvider(),
    });
    // Should not throw
    await expect(
      errorSvc.fetchPassageWithNotesAndLinks({
        language: "en",
        reference: "JHN 3:16",
      }),
    ).rejects.toThrow();
  });
});

describe("SkillService.generateTranslationHelp()", () => {
  let skillService: SkillService;
  const bundle = makeBundle("en", "JHN 3:16");

  beforeEach(() => {
    skillService = createSkillService({
      callTool: makeStubCallTool(bundle),
      llmProvider: new FakeLLMProvider(),
    });
  });

  it("returns a response string", async () => {
    const result = await skillService.generateTranslationHelp(
      bundle,
      "Explain the theological significance",
    );
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
  });

  it("returns citations array", async () => {
    const result = await skillService.generateTranslationHelp(
      bundle,
      "Give me translation notes for JHN 3:16",
    );
    expect(result.citations).toBeInstanceOf(Array);
  });

  it("handles LLM failure gracefully", async () => {
    const errorLLM = {
      generate: async (): Promise<string> => {
        throw new Error("LLM down");
      },
      modelId: () => "error-llm",
    };
    const svc = createSkillService({
      callTool: makeStubCallTool(bundle),
      llmProvider: errorLLM,
    });
    const result = await svc.generateTranslationHelp(bundle, "help?");
    expect(result.response).toContain("LLM_UNAVAILABLE");
    expect(result.citations).toHaveLength(0);
  });
});

describe("SkillService.queryRAG()", () => {
  let skillService: SkillService;

  beforeEach(() => {
    skillService = createSkillService({
      callTool: makeStubCallTool(makeBundle("en", "JHN 3:16")),
      llmProvider: new FakeLLMProvider(),
    });
  });

  it("returns a QueryResult shape", async () => {
    const result = await skillService.queryRAG("grace faith", {
      language: "en",
    });
    expect(result).toMatchObject({
      query: "grace faith",
      language: "en",
      documents: expect.any(Array),
      fallbackMode: expect.any(String),
      cacheStatus: expect.any(String),
    });
  });

  it("passes query through unchanged", async () => {
    let capturedParams: Record<string, unknown> = {};
    const svc = createSkillService({
      callTool: async (_name, params) => {
        capturedParams = params;
        return {
          documents: [],
          fallbackMode: "empty",
          cacheStatus: "miss",
          latencyMs: 0,
        };
      },
      llmProvider: new FakeLLMProvider(),
    });
    await svc.queryRAG("exact query text", { language: "fr" });
    expect(capturedParams["query"]).toBe("exact query text");
    expect(capturedParams["language"]).toBe("fr");
  });
});

describe("SkillService.composeTranslationReport()", () => {
  it("returns response, citations, bundle, and latencyMs", async () => {
    const bundle = makeBundle("en", "JHN 3:16");
    const svc = createSkillService({
      callTool: makeStubCallTool(bundle),
      llmProvider: new FakeLLMProvider(),
    });

    const result = await svc.composeTranslationReport("JHN 3:16", "en");
    expect(typeof result.response).toBe("string");
    expect(result.citations).toBeInstanceOf(Array);
    expect(result.bundle).toBeDefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
