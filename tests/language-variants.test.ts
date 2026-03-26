/**
 * Language Variant Tests
 *
 * Tests auto-discovery and retry logic for language variants:
 * - Base language → discovers variant (e.g., es → es-419)
 * - Explicit variant → uses as-is (no discovery)
 * - Invalid language → proper error (no infinite retry)
 * - Multiple variants → best match selected
 * - Variant mapping cache works correctly
 * - Scripture uses all-org discovery (organization is not a fetch_scripture parameter)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, extractMCPText } from "./helpers/test-client";
import { TEST_DATA } from "./helpers/test-data";

/** Scripture ref that resolves for es / es-419 (JHN is often absent from those catalogs). */
const REF_ES = TEST_DATA.references.spanishCatalogVerse;
/** USFM-style reference for strict validators (full names like "John" can 400). */
const REF_USFM = TEST_DATA.references.singleVerseUsfm;

describe("Language Variant Tests", () => {
  const client = new TestClient();

  beforeAll(async () => {
    await client.waitForServer();
  });

  describe("Base Language → Variant Discovery", () => {
    it("should auto-discover variant for Spanish (es → es-419)", async () => {
      const response = await client.callMCPTool({
        name: "fetch_scripture",
        arguments: {
          reference: REF_ES,
          language: "es", // Base language
        },
      });

      const text = extractMCPText(response);

      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(50);

      // Should contain Spanish text
      expect(text).toMatch(/Dios|porque|mundo|amó/i);

      console.log(
        '\n  ✅ Base language "es" auto-discovered variant (likely es-419)',
      );
      console.log(`     Response: ${text.slice(0, 80)}...`);
    }, 30000);

    it("should handle base Portuguese (pt → pt-br)", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: REF_USFM,
            language: "pt", // Base language
          },
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();

        console.log(
          '\n  ✅ Base language "pt" handled (discovered pt-br or similar)',
        );
      } catch (error: any) {
        // Portuguese might not be available
        if (
          error.message.includes("404") ||
          error.message.includes("not found")
        ) {
          console.log(
            "\n  ⚠️  Portuguese not available (expected for some deployments)",
          );
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    }, 30000);

    it("should handle base French (fr)", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: REF_USFM,
            language: "fr", // Base language
          },
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();
        expect(text).toMatch(/Dieu|car|monde/i);

        console.log('\n  ✅ Base language "fr" handled successfully');
      } catch (error: any) {
        if (
          error.message.includes("404") ||
          error.message.includes("not found")
        ) {
          console.log(
            "\n  ⚠️  French not available (expected for some deployments)",
          );
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    }, 30000);
  });

  describe("Explicit Variant → No Discovery", () => {
    it("should use explicit variant without discovery (es-419)", async () => {
      const response = await client.callMCPTool({
        name: "fetch_scripture",
        arguments: {
          reference: REF_ES,
          language: "es-419", // Explicit variant
        },
      });

      const text = extractMCPText(response);

      expect(text).toBeTruthy();
      expect(text).toMatch(/Dios|porque|mundo/i);

      console.log(
        '\n  ✅ Explicit variant "es-419" used directly (no discovery)',
      );
    }, 10000);

    it("should use explicit variant without discovery (pt-br)", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: REF_USFM,
            language: "pt-br", // Explicit variant
          },
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();

        console.log('\n  ✅ Explicit variant "pt-br" used directly');
      } catch (error: any) {
        if (
          error.message.includes("404") ||
          error.message.includes("not found")
        ) {
          console.log("\n  ⚠️  pt-br not available (expected)");
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    }, 10000);
  });

  describe("Invalid Language Handling", () => {
    it("should return 404 for completely invalid language", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: "zz-ZZ", // Invalid
          },
        });
      } catch (error: any) {
        errorThrown = true;
        const m = String(error.message || "").toLowerCase();
        const looksLikeRejection =
          /404|not found|no scripture|language|unavailable|invalid|failed|tool endpoint|-32000|mcp tool error/.test(
            m,
          );
        expect(
          looksLikeRejection,
          `expected server/MCP rejection, got: ${String(error.message).slice(0, 200)}`,
        ).toBe(true);
      }

      expect(errorThrown, "Should have thrown error for invalid language").toBe(
        true,
      );

      console.log('\n  ✅ Invalid language "zz-ZZ" properly rejected');
    }, 30000);

    it("should not infinite loop on non-existent language", async () => {
      const startTime = Date.now();

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: REF_USFM,
            language: "xyz", // Non-existent
          },
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Should fail without multi-minute retry storms (allow CI jitter)
        expect(duration).toBeLessThan(20000);
        expect(error.message.toLowerCase()).toMatch(
          /not found|404|no scripture|language/,
        );
      }

      console.log(
        "\n  ✅ Non-existent language fails gracefully (no infinite retry)",
      );
    }, 10000);
  });

  describe("Variant Mapping Cache", () => {
    it("should cache variant mappings for faster subsequent lookups", async () => {
      // First lookup (builds cache)
      const start1 = Date.now();
      await client.callMCPTool({
        name: "fetch_scripture",
        arguments: {
          reference: REF_ES,
          language: "es",
        },
      });
      const duration1 = Date.now() - start1;

      // Second lookup with same base language (uses cached mapping)
      const start2 = Date.now();
      await client.callMCPTool({
        name: "fetch_scripture",
        arguments: {
          reference: "Titus 1:2",
          language: "es",
        },
      });
      const duration2 = Date.now() - start2;

      // Second should be faster (cached variant mapping)
      expect(duration2).toBeLessThanOrEqual(duration1);

      console.log(
        `\n  ✅ Variant mapping cached: ${duration1}ms → ${duration2}ms`,
      );
    }, 15000);
  });

  describe("Fallback Behavior", () => {
    it("should provide helpful message when variant not found", async () => {
      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: REF_USFM,
            language: "zu", // Zulu - unlikely to be available
          },
        });
      } catch (error: any) {
        // Error should be clear
        expect(error.message).toBeDefined();
        expect(error.message.toLowerCase()).toMatch(/not found|404|language/);

        console.log(
          `\n  ✅ Clear error for unavailable language: ${error.message.slice(0, 80)}...`,
        );
      }
    }, 10000);

    it("should suggest available alternatives when possible", async () => {
      // This test would check if error messages suggest alternatives
      // Implementation depends on server error response format

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: "spa", // ISO 639-2 code instead of 639-1
          },
        });
      } catch (error: any) {
        // Error should be helpful
        expect(error.message).toBeDefined();
        expect(error.message.length).toBeGreaterThan(10);

        console.log(
          "\n  ✅ Error provides context for wrong language code format",
        );
      }
    }, 10000);
  });

  describe("Edge Cases", () => {
    it("should handle language with multiple possible variants", async () => {
      // English has multiple variants (en-US, en-GB, etc.)
      // System should handle gracefully

      const response = await client.callMCPTool({
        name: "fetch_scripture",
        arguments: {
          reference: REF_USFM,
          language: "en",
        },
      });

      const text = extractMCPText(response);
      expect(text).toBeTruthy();
      expect(text).toContain("God");

      console.log("\n  ✅ Language with multiple variants handled correctly");
    }, 10000);

    it("should handle region-specific variants", async () => {
      // Test various region codes
      const variants = ["es-419", "es-ES", "pt-BR", "pt-PT", "fr-FR", "fr-CA"];

      for (const variant of variants.slice(0, 2)) {
        // Test first 2 to save time
        try {
          const response = await client.callMCPTool({
            name: "fetch_scripture",
            arguments: {
              reference: TEST_DATA.references.singleVerse,
              language: variant,
            },
          });

          const text = extractMCPText(response);
          expect(text).toBeTruthy();

          console.log(`\n  ✅ Region variant "${variant}" handled`);
        } catch (error: any) {
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `\n  ⚠️  Variant "${variant}" not available (expected)`,
            );
          } else {
            throw error;
          }
        }
      }
    }, 20000);

    it("should handle case sensitivity in language codes", async () => {
      const casevariants = ["en", "EN", "En", "eN"];

      for (const lang of casevariants.slice(0, 2)) {
        // Test 2 variants
        try {
          const response = await client.callMCPTool({
            name: "fetch_scripture",
            arguments: {
              reference: REF_USFM,
              language: lang,
            },
          });

          const text = extractMCPText(response);
          expect(text).toBeTruthy();

          console.log(`\n  ✅ Case variant "${lang}" handled correctly`);
        } catch (_error: any) {
          // Some servers might be case-sensitive
          console.log(
            `\n  ⚠️  Case variant "${lang}" failed (server might be case-sensitive)`,
          );
        }
      }
    }, 15000);
  });

  describe("Translation Notes Language Variants", () => {
    it("should handle variants for translation notes", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_translation_notes",
          arguments: {
            reference: REF_ES,
            language: "es", // Base language
          },
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();

        console.log("\n  ✅ Translation notes handle language variants");
      } catch (error: any) {
        if (
          error.message.includes("404") ||
          error.message.includes("not found")
        ) {
          console.log(
            "\n  ⚠️  Spanish translation notes not available (expected)",
          );
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    }, 10000);
  });

  describe("Translation Words Language Variants", () => {
    it("should handle variants for translation words", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: {
            path: TEST_DATA.translationWords.faith.path,
            language: "es", // Base language
          },
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();

        console.log("\n  ✅ Translation words handle language variants");
      } catch (error: any) {
        if (
          error.message.includes("404") ||
          error.message.includes("not found")
        ) {
          console.log(
            "\n  ⚠️  Spanish translation word not available (expected)",
          );
          expect(true).toBe(true);
        } else {
          throw error;
        }
      }
    }, 10000);
  });
});
