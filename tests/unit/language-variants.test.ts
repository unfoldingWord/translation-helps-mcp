/**
 * Unit tests for language-variant fallback helpers in dcsClient.ts.
 *
 * Tests the three-layer strategy:
 *   1. KNOWN_VARIANTS static map (instant, no network)
 *   2. listLanguages-based discovery (reuses cached language list)
 *   3. resolveCatalogLanguage (happy path, variant miss, unknown base)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  findLanguageVariants,
  resolveCatalogLanguage,
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

// Language list returned by /catalog/list/languages — includes es-419 but not es
const LANGUAGES_WITH_ES419 = {
  "catalog/list/languages": {
    ok: true,
    data: [
      { lc: "en", ln: "English" },
      { lc: "es-419", ln: "Latin American Spanish" },
      { lc: "pt-br", ln: "Brazilian Portuguese" },
      { lc: "fr", ln: "French" },
    ],
  },
};

// Catalog search stubs
const ES_BIBLE_ENTRIES = [
  { name: "es-419_ult", owner: "unfoldingWord", abbreviation: "ult", ingredients: [], catalog: { prod: { zipball_url: "https://example.com/es-419_ult.zip" } } },
];

beforeEach(() => {
  // Clear in-process caches before each test by re-importing with a fresh module
  // (vitest isolates modules per test file, so the Maps start empty)
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// findLanguageVariants
// ---------------------------------------------------------------------------

describe("findLanguageVariants", () => {
  it("returns [] immediately for codes that already have a hyphen", async () => {
    const variants = await findLanguageVariants("es-419");
    expect(variants).toEqual([]);
  });

  it("returns KNOWN_VARIANTS entries without a network call (pt → pt-br)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const variants = await findLanguageVariants("pt");
    expect(variants).toEqual(["pt-br"]);
    // Should NOT have called fetch — known variants are instant
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("discovers variants from the language list (es → es-419)", async () => {
    mockFetch(LANGUAGES_WITH_ES419);
    const variants = await findLanguageVariants("es");
    expect(variants).toContain("es-419");
  });

  it("returns [] for a base code that has no variants in the catalog", async () => {
    mockFetch({
      "catalog/list/languages": { ok: true, data: [{ lc: "fr", ln: "French" }] },
    });
    const variants = await findLanguageVariants("xx");
    expect(variants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveCatalogLanguage
// ---------------------------------------------------------------------------

describe("resolveCatalogLanguage", () => {
  it("happy path: returns the exact code when catalog has resources", async () => {
    mockFetch({
      // catalogSearch with lang=en returns results
      "catalog/search": { ok: true, data: [
        { name: "en_ult", owner: "unfoldingWord", abbreviation: "ult", ingredients: [], catalog: { prod: { zipball_url: "https://example.com/en_ult.zip" } } },
      ]},
    });

    const { language, entries } = await resolveCatalogLanguage("en", { subject: "Aligned Bible" });
    expect(language).toBe("en");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("upgrades base code to variant when exact code has no resources (es → es-419)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      // First catalogSearch (lang=es) returns empty; languages list includes es-419;
      // second catalogSearch (lang=es-419) returns results.
      if (url.includes("catalog/search") && url.includes("lang=es") && !url.includes("es-419")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: [] }) });
      }
      if (url.includes("catalog/list/languages")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(LANGUAGES_WITH_ES419["catalog/list/languages"]) });
      }
      if (url.includes("catalog/search") && url.includes("es-419")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: ES_BIBLE_ENTRIES }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: [] }) });
    }) as unknown as typeof fetch;

    const { language, entries } = await resolveCatalogLanguage("es", { subject: "Aligned Bible,Bible" });
    expect(language).toBe("es-419");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("returns original code with empty entries when no variant found", async () => {
    mockFetch({
      "catalog/search": { ok: true, data: [] },
      "catalog/list/languages": { ok: true, data: [{ lc: "fr", ln: "French" }] },
    });

    const { language, entries } = await resolveCatalogLanguage("xx", { subject: "Aligned Bible" });
    expect(language).toBe("xx");
    expect(entries).toEqual([]);
  });

  it("does not attempt variant discovery for explicit variant codes", async () => {
    mockFetch({
      "catalog/search": { ok: true, data: [] },
    });
    const fetchSpy = vi.fn().mockImplementation(globalThis.fetch);
    globalThis.fetch = fetchSpy;

    const { language, entries } = await resolveCatalogLanguage("es-419", { subject: "Aligned Bible" });
    // Should not call listLanguages since es-419 already has a hyphen
    const languageListCalls = fetchSpy.mock.calls.filter(([url]: [string]) => url.includes("list/languages"));
    expect(languageListCalls).toHaveLength(0);
    expect(language).toBe("es-419");
    expect(entries).toEqual([]);
  });
});
