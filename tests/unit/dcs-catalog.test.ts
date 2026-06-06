/**
 * Unit tests for dcsClient.ts catalog URL building and catalog-first resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  catalogSearch,
  listLanguages,
  listSubjects,
  getResourceZipUrl,
  getResourceZipUrlByAbbreviation,
  type CatalogEntry,
} from "../../src/core/resources/dcsClient.js";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(responses: Record<string, unknown>) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    const key = Object.keys(responses).find((k) => url.includes(k));
    const body = key ? responses[key] : { ok: true, data: [] };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// buildCatalogUrl — verify topic=tc-ready is always injected
// ---------------------------------------------------------------------------

describe("catalogSearch always includes topic=tc-ready", () => {
  it("injects topic=tc-ready in the URL", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_ult",
            owner: "unfoldingWord",
            subject: "Aligned Bible",
            abbreviation: "ult",
            branch_or_tag_name: "v88",
            zipball_url: "https://git.door43.org/unfoldingWord/en_ult/archive/v88.zip",
            ingredients: [
              { identifier: "jhn", path: "./44-JHN.usfm" },
            ],
          },
        ],
      },
    });

    const results = await catalogSearch({ lang: "en", abbreviation: "ult" });
    expect(results.length).toBe(1);
    expect(results[0].abbreviation).toBe("ult");
    expect(results[0].repo).toBe("en_ult");
    expect(results[0].catalog?.prod?.branch_or_tag_name).toBe("v88");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const calledUrl = fetchCall[0] as string;
    expect(calledUrl).toContain("topic=tc-ready");
    expect(calledUrl).toContain("stage=prod");
    expect(calledUrl).toContain("abbreviation=ult");
    expect(calledUrl).toContain("showIngredients=true");
  });

  it("returns empty array when API returns no results", async () => {
    mockFetch({ "catalog/search": { ok: true, data: [] } });
    const results = await catalogSearch({ lang: "xx" });
    expect(results).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const results = await catalogSearch({ lang: "en" });
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listLanguages
// ---------------------------------------------------------------------------

describe("listLanguages", () => {
  it("maps catalog response to LanguageEntry array", async () => {
    mockFetch({
      "catalog/list/languages": {
        ok: true,
        data: [
          { lang: "en", language_title: "English", ld: "ltr" },
          { lang: "es", language_title: "Español", ld: "ltr" },
        ],
      },
    });

    const langs = await listLanguages();
    expect(langs).toHaveLength(2);
    expect(langs[0]).toMatchObject({ code: "en", name: "English", direction: "ltr" });
    expect(langs[1]).toMatchObject({ code: "es", name: "Español" });
  });

  it("uses KV cache on second call", async () => {
    const kv: Record<string, string> = {};
    const kvStore = {
      get: vi.fn((key: string) => Promise.resolve(kv[key] ?? null)),
      put: vi.fn((key: string, value: string) => {
        kv[key] = value;
        return Promise.resolve();
      }),
    };

    mockFetch({
      "catalog/list/languages": { ok: true, data: [{ lang: "en", language_title: "English" }] },
    });

    await listLanguages(kvStore);
    await listLanguages(kvStore);

    // fetch should only be called once (second call hits KV)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// listSubjects
// ---------------------------------------------------------------------------

describe("listSubjects", () => {
  it("returns subject strings from catalog", async () => {
    mockFetch({
      "catalog/list/subjects": {
        ok: true,
        data: [{ subject: "Aligned Bible" }, { subject: "Translation Notes" }],
      },
    });
    const subjects = await listSubjects();
    expect(subjects).toContain("Aligned Bible");
    expect(subjects).toContain("Translation Notes");
  });

  it("falls back to hardcoded list on error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const subjects = await listSubjects();
    expect(subjects.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getResourceZipUrl
// ---------------------------------------------------------------------------

describe("getResourceZipUrl", () => {
  it("returns zipball_url from catalog on happy path", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_tn",
            owner: "unfoldingWord",
            subject: "TSV Translation Notes",
            abbreviation: "tn",
            branch_or_tag_name: "v44",
            zipball_url: "https://git.door43.org/unfoldingWord/en_tn/archive/v44.zip",
            ingredients: [],
          },
        ],
      },
    });

    const result = await getResourceZipUrl("en", "TSV Translation Notes");
    expect(result).not.toBeNull();
    expect(result!.zipUrl).toContain("v44.zip");
    expect(result!.entry.abbreviation).toBe("tn");
  });
});

// ---------------------------------------------------------------------------
// getResourceZipUrlByAbbreviation — UST/ULT disambiguation fix
// ---------------------------------------------------------------------------

describe("getResourceZipUrlByAbbreviation", () => {
  it("resolves ULT by abbreviation=ult", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_ult",
            owner: "unfoldingWord",
            subject: "Aligned Bible",
            abbreviation: "ult",
            branch_or_tag_name: "v88",
            zipball_url: "https://git.door43.org/unfoldingWord/en_ult/archive/v88.zip",
            ingredients: [],
          },
        ],
      },
    });

    const result = await getResourceZipUrlByAbbreviation("en", "ult");
    expect(result).not.toBeNull();
    expect(result!.entry.abbreviation).toBe("ult");
    expect(result!.entry.repo).toBe("en_ult");

    // Verify abbreviation was passed to catalog
    const calledUrl = ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(calledUrl).toContain("abbreviation=ult");
  });

  it("resolves UST separately from ULT (no confusion)", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_ust",
            owner: "unfoldingWord",
            subject: "Aligned Bible",
            abbreviation: "ust",
            branch_or_tag_name: "v88",
            zipball_url: "https://git.door43.org/unfoldingWord/en_ust/archive/v88.zip",
            ingredients: [],
          },
        ],
      },
    });

    const result = await getResourceZipUrlByAbbreviation("en", "ust");
    expect(result).not.toBeNull();
    expect(result!.entry.repo).toBe("en_ust");
    expect(result!.entry.abbreviation).toBe("ust");

    const calledUrl = ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0];
    expect(calledUrl).toContain("abbreviation=ust");
    // Should NOT contain "ult"
    expect(calledUrl).not.toContain("abbreviation=ult");
  });
});
