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
  pickPreferredCatalogEntry,
  clearCatalogProcessCache,
  type CatalogEntry,
} from "@translation-helps/door43";

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
  clearCatalogProcessCache(); // prevent cross-test cache pollution
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
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_ult/archive/v88.zip",
            ingredients: [{ identifier: "jhn", path: "./44-JHN.usfm" }],
          },
        ],
      },
    });

    const results = await catalogSearch({ lang: "en", abbreviation: "ult" });
    expect(results.length).toBe(1);
    expect(results[0].abbreviation).toBe("ult");
    expect(results[0].repo).toBe("en_ult");
    expect(results[0].catalog?.prod?.branch_or_tag_name).toBe("v88");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
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
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
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
    expect(langs[0]).toMatchObject({
      code: "en",
      name: "English",
      direction: "ltr",
    });
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
      "catalog/list/languages": {
        ok: true,
        data: [{ lang: "en", language_title: "English" }],
      },
    });

    await listLanguages(kvStore);
    await listLanguages(kvStore);

    // fetch should only be called once (second call hits KV)
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(1);
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
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const subjects = await listSubjects();
    expect(subjects.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getResourceZipUrl
// ---------------------------------------------------------------------------

describe("getResourceZipUrl", () => {
  it("prefers Open Bible Stories over obs-tf when resolving obs abbreviation", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_obs-tf",
            owner: "unfoldingWord",
            subject: "OBS Theological Formation",
            abbreviation: "obs",
            branch_or_tag_name: "v4",
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_obs-tf/archive/v4.zip",
            ingredients: [],
          },
          {
            name: "en_obs",
            owner: "unfoldingWord",
            subject: "Open Bible Stories",
            abbreviation: "obs",
            branch_or_tag_name: "v9",
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_obs/archive/v9.zip",
            ingredients: [],
          },
        ],
      },
    });

    const result = await getResourceZipUrl("en", "Open Bible Stories");
    expect(result).not.toBeNull();
    expect(result!.entry.name).toBe("en_obs");
    expect(result!.zipUrl).toContain("en_obs/archive/v9.zip");
  });

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
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_tn/archive/v44.zip",
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

  it("falls back to non-unfoldingWord owner when UW has no TW (hi)", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "hi_tw",
            owner: "translationCore-Create-BCS",
            subject: "Translation Words",
            abbreviation: "tw",
            branch_or_tag_name: "v1",
            zipball_url:
              "https://git.door43.org/translationCore-Create-BCS/hi_tw/archive/v1.zip",
            ingredients: [],
          },
        ],
      },
    });

    // Prefer UW among hits when present; accept non-UW when that is the only hit.
    const result = await getResourceZipUrl("hi", "Translation Words");
    expect(result).not.toBeNull();
    expect(result!.entry.owner).toBe("translationCore-Create-BCS");
    expect(result!.zipUrl).toContain("hi_tw");
  });

  it("resolves es → es-419 TW owned by es-419_gl (not UW)", async () => {
    // URL-aware mock: empty for lang=es, non-UW hit for lang=es-419
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const u = url as string;
      let data: unknown[] = [];
      if (u.includes("catalog/search") && u.includes("lang=es-419")) {
        data = [
          {
            name: "es-419_tw",
            owner: "es-419_gl",
            subject: "Translation Words",
            abbreviation: "tw",
            branch_or_tag_name: "v12",
            zipball_url:
              "https://git.door43.org/es-419_gl/es-419_tw/archive/v12.zip",
            ingredients: [],
          },
        ];
      }
      // lang=es (exact, no region) → empty so variant fallback runs
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data }),
      });
    }) as unknown as typeof fetch;

    const result = await getResourceZipUrl("es", "Translation Words");
    expect(result).not.toBeNull();
    expect(result!.entry.owner).toBe("es-419_gl");
    expect(result!.entry.repo).toBe("es-419_tw");
    expect(result!.zipUrl).toContain("es-419_tw");
  });

  it("prefers unfoldingWord when both UW and community owners exist", async () => {
    mockFetch({
      "catalog/search": {
        ok: true,
        data: [
          {
            name: "en_tw",
            owner: "SomeCommunity",
            subject: "Translation Words",
            abbreviation: "tw",
            branch_or_tag_name: "v1",
            zipball_url:
              "https://git.door43.org/SomeCommunity/en_tw/archive/v1.zip",
            ingredients: [],
          },
          {
            name: "en_tw",
            owner: "unfoldingWord",
            subject: "Translation Words",
            abbreviation: "tw",
            branch_or_tag_name: "v88",
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_tw/archive/v88.zip",
            ingredients: [],
          },
        ],
      },
    });

    // Omit organization — still prefer UW among results, never owner= filter.
    const result = await getResourceZipUrl("en", "Translation Words");
    expect(result).not.toBeNull();
    expect(result!.entry.owner).toBe("unfoldingWord");
    expect(result!.zipUrl).toContain("v88.zip");

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const calledUrl = fetchCall[0] as string;
    expect(calledUrl).not.toContain("owner=");
  });

  it("does not inject owner into catalog search when organization omitted", async () => {
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
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_tn/archive/v44.zip",
            ingredients: [],
          },
        ],
      },
    });

    await getResourceZipUrl("en", "TSV Translation Notes");
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    for (const [url] of calls) {
      expect(url as string).not.toContain("owner=");
    }
  });
});

// ---------------------------------------------------------------------------
// pickPreferredCatalogEntry
// ---------------------------------------------------------------------------

describe("pickPreferredCatalogEntry", () => {
  const uw: CatalogEntry = {
    owner: "unfoldingWord",
    repo: "en_tw",
    name: "en_tw",
    abbreviation: "tw",
    ingredients: [],
  };
  const gl: CatalogEntry = {
    owner: "es-419_gl",
    repo: "es-419_tw",
    name: "es-419_tw",
    abbreviation: "tw",
    ingredients: [],
  };

  it("returns undefined for empty list", () => {
    expect(pickPreferredCatalogEntry([])).toBeUndefined();
  });

  it("prefers unfoldingWord when present", () => {
    expect(pickPreferredCatalogEntry([gl, uw])?.owner).toBe("unfoldingWord");
  });

  it("falls back to first entry when preferred owner missing", () => {
    expect(pickPreferredCatalogEntry([gl])?.owner).toBe("es-419_gl");
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
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_ult/archive/v88.zip",
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
    const calledUrl = (
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    )[0];
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
            zipball_url:
              "https://git.door43.org/unfoldingWord/en_ust/archive/v88.zip",
            ingredients: [],
          },
        ],
      },
    });

    const result = await getResourceZipUrlByAbbreviation("en", "ust");
    expect(result).not.toBeNull();
    expect(result!.entry.repo).toBe("en_ust");
    expect(result!.entry.abbreviation).toBe("ust");

    const calledUrl = (
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    )[0];
    expect(calledUrl).toContain("abbreviation=ust");
    // Should NOT contain "ult"
    expect(calledUrl).not.toContain("abbreviation=ult");
  });

  it("resolves es → es-419 by abbreviation (variant fallback)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const u = url as string;
      let data: unknown[] = [];
      if (u.includes("catalog/search") && u.includes("lang=es-419")) {
        data = [
          {
            name: "es-419_ult",
            owner: "unfoldingWord",
            subject: "Aligned Bible",
            abbreviation: "ult",
            branch_or_tag_name: "v1",
            zipball_url:
              "https://git.door43.org/unfoldingWord/es-419_ult/archive/v1.zip",
            ingredients: [],
          },
        ];
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data }),
      });
    }) as unknown as typeof fetch;

    const result = await getResourceZipUrlByAbbreviation("es", "ult");
    expect(result).not.toBeNull();
    expect(result!.entry.repo).toBe("es-419_ult");
    expect(result!.zipUrl).toContain("es-419_ult");
  });
});
