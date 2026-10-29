/**
 * Real get_obs_story handler for decomposed story/frame args.
 *
 * Normalization runs first, then the handler calls GET /api/v1/obs. The
 * catalog and zip download are fixtures; parse, filter, and the handler are
 * the real ones. No network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  zipUrl: "https://example.test/en-obs.zip",
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
    getResourceZipUrl: async () => ({
      zipUrl: catalog.zipUrl,
      entry: {
        owner: "unfoldingWord",
        repo: "en_obs",
        name: "en_obs",
        ingredients: [],
        catalog: { prod: { zipball_url: catalog.zipUrl } },
      },
    }),
    ZipResourceFetcher2: class {
      async getOrDownloadZip(): Promise<Uint8Array> {
        return new Uint8Array();
      }
      async extractFileFromZip(
        _zip: Uint8Array,
        path: string,
      ): Promise<string | null> {
        return catalog.files.get(path) ?? null;
      }
    },
  };
});

import { handleObs } from "../../src/api/routes/obs.js";
import { getObsStoryTool } from "../../src/mcp/tools/getObsStory.js";
import { normalizeToolArgs } from "../../src/mcp/normalizeToolArgs.js";

/**
 * Story 3. Frame indexes come from image order (plus a title at 0), so frame
 * 5 is the fifth picture. Neighbor frames make a whole-story response fail.
 */
const STORY_3_MARKDOWN = `# The Birth of Jesus

![Image](https://example.test/03-01.jpg)

Frame one text.

![Image](https://example.test/03-02.jpg)

Frame two text.

![Image](https://example.test/03-03.jpg)

Frame three text.

![Image](https://example.test/03-04.jpg)

Frame four text.

![Image](https://example.test/03-05.jpg)

The shepherds found the baby.

![Image](https://example.test/03-06.jpg)

Frame six text.

_A Bible story from: Luke 2_
`;

beforeEach(() => {
  catalog.files.clear();
  catalog.files.set("content/03.md", STORY_3_MARKDOWN);
});

describe("get_obs_story decomposed args through the real handler", () => {
  it("returns frame 5 of story 3 for story_number and frame_number", async () => {
    const params = getObsStoryTool.inputSchema.parse(
      normalizeToolArgs("get_obs_story", {
        story_number: 3,
        frame_number: 5,
        language: "en",
      }),
    );

    const api = {
      async fetch(input: RequestInfo | URL): Promise<Response> {
        const url = new URL(
          String(input instanceof Request ? input.url : input),
        );
        return handleObs({ url, env: {} as never });
      },
    };

    const result = (await getObsStoryTool.handler(
      params,
      { API: api } as never,
      "test",
    )) as {
      isError?: boolean;
      structuredContent?: {
        story?: number;
        frames?: Array<{ index: number; text: string }>;
      };
    };

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.story).toBe(3);
    expect(result.structuredContent?.frames).toEqual([
      expect.objectContaining({
        index: 5,
        text: expect.stringContaining("The shepherds found the baby."),
      }),
    ]);
  });

  it("rejects a non-integer end frame as an invalid OBS reference", async () => {
    const params = getObsStoryTool.inputSchema.parse(
      normalizeToolArgs("get_obs_story", {
        story: 3,
        frame: 5,
        endFrame: "8x",
        language: "en",
      }),
    );
    expect(params.reference).toBe("3:5-8x");

    const api = {
      async fetch(input: RequestInfo | URL): Promise<Response> {
        const url = new URL(
          String(input instanceof Request ? input.url : input),
        );
        return handleObs({ url, env: {} as never });
      },
    };

    await expect(
      getObsStoryTool.handler(params, { API: api } as never, "test"),
    ).rejects.toThrow(/Invalid OBS reference: "3:5-8x"/);
  });
});
