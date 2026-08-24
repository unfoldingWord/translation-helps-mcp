/**
 * Unit tests for TW/TA zip resolution helpers (non-UW owners + es→es-419).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearCatalogProcessCache } from "@translation-helps/door43";
import { resolveResourceZip } from "../../src/api/routes/helpers.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  clearCatalogProcessCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveResourceZip", () => {
  it("returns non-UW Hindi TW owner from catalog", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const data =
        typeof url === "string" && url.includes("catalog/search")
          ? [
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
            ]
          : [];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, data }),
      });
    }) as unknown as typeof fetch;

    const result = await resolveResourceZip("hi", "Translation Words", null);
    expect(result).not.toBeNull();
    expect(result!.language).toBe("hi");
    expect(result!.entry.owner).toBe("translationCore-Create-BCS");
    expect(result!.zipUrl).toContain("hi_tw");
  });

  it("resolves Spanish TW via es → es-419 with es-419_gl owner", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const u = url as string;
      let data: unknown[] = [];
      if (u.includes("catalog/search") && u.includes("lang=es-419")) {
        data = [
          {
            name: "es-419_ta",
            owner: "es-419_gl",
            subject: "Translation Academy",
            abbreviation: "ta",
            branch_or_tag_name: "v9",
            zipball_url:
              "https://git.door43.org/es-419_gl/es-419_ta/archive/v9.zip",
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

    const result = await resolveResourceZip("es", "Translation Academy", null);
    expect(result).not.toBeNull();
    expect(result!.language).toBe("es-419");
    expect(result!.entry.owner).toBe("es-419_gl");
    expect(result!.zipUrl).toContain("es-419_ta");
  });
});
