/**
 * DCS Source of Truth Verification Tests
 *
 * These tests verify that our API responses match the actual data
 * available in the Door43 Content Service (DCS) catalog.
 *
 * This ensures we're not:
 * - Returning resources that don't exist in DCS
 * - Failing to find resources that DO exist in DCS
 * - Returning incorrect metadata (language, organization)
 * - Auto-discovering variants that don't exist in DCS
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient } from "./helpers/test-client";
import {
  dcsResourceExists,
  dcsScriptureExists,
  dcsAcademyExists,
  dcsWordExists,
  dcsGetLanguages,
  dcsGetLanguageVariants,
  comparewithDCS,
} from "./helpers/dcs-client";

const client = new TestClient();

describe("DCS Source of Truth Verification", () => {
  beforeAll(async () => {
    await client.waitForServer();
  });

  describe("Language Discovery Validation", () => {
    it("should only list languages that exist in DCS catalog", async () => {
      // Get languages from our API
      const ourResponse = await client.callRESTRaw("list-languages");
      expect(ourResponse.status).toBe(200);
      expect(ourResponse.data.languages).toBeDefined();

      // Get languages from DCS
      const dcsLanguages = await dcsGetLanguages();

      // Every language we return should exist in DCS
      const ourLanguages = ourResponse.data.languages.map((l: any) => l.code);
      const missingInDCS = ourLanguages.filter(
        (code: string) => !dcsLanguages.includes(code),
      );

      expect(missingInDCS).toEqual([]);
    });

    it("should discover language variants that actually exist in DCS", async () => {
      // Test Spanish variant discovery
      const dcsSpanishVariants = await dcsGetLanguageVariants("es");

      // Try fetching with base language 'es'
      const ourResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "JHN 1:1",
        language: "es",
      });

      if (ourResponse.status === 200) {
        const actualLanguage = ourResponse.data.metadata?.language;

        // If we found it, the language should be in DCS variants
        expect(dcsSpanishVariants).toContain(actualLanguage);
      } else if (ourResponse.status === 404) {
        // If we didn't find it, DCS shouldn't have Spanish variants for this org
        const dcsHasSpanish = await dcsScriptureExists({
          language: "es",
          organization: "unfoldingWord",
        });

        const dcsHasSpanishVariants = await Promise.all(
          dcsSpanishVariants.map((variant) =>
            dcsScriptureExists({
              language: variant,
              organization: "unfoldingWord",
            }),
          ),
        );

        const anySpanishExists =
          dcsHasSpanish.exists || dcsHasSpanishVariants.some((r) => r.exists);

        if (anySpanishExists) {
          throw new Error(
            "We returned 404 but DCS has Spanish scripture for unfoldingWord",
          );
        }
      }
    });
  });

  describe("Scripture Resource Validation", () => {
    it("should find scripture that exists in DCS", async () => {
      // English scripture definitely exists in DCS
      const dcsResult = await dcsScriptureExists({
        language: "en",
        organization: "unfoldingWord",
      });

      expect(dcsResult.exists).toBe(true);

      const ourResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "JHN 3:16",
        language: "en",
      });

      expect(ourResponse.status).toBe(200);
      expect(ourResponse.data.scripture).toBeDefined();
      expect(ourResponse.data.scripture.length).toBeGreaterThan(0);
    });

    it("should return 404 for scripture that does NOT exist in DCS", async () => {
      // Made-up language code
      const dcsResult = await dcsScriptureExists({
        language: "xyz123",
        organization: "unfoldingWord",
      });

      expect(dcsResult.exists).toBe(false);

      const ourResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "JHN 3:16",
        language: "xyz123",
      });

      expect([400, 404]).toContain(ourResponse.status);
    });

    it("should return metadata matching DCS for scripture", async () => {
      const ourResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "GEN 1:1",
        language: "en",
      });

      expect(ourResponse.status).toBe(200);

      const dcsResult = await dcsScriptureExists({
        language: "en",
        organization: "unfoldingWord",
      });

      expect(dcsResult.exists).toBe(true);

      if (ourResponse.data.metadata) {
        expect(ourResponse.data.metadata.language).toBe(
          dcsResult.actualLanguage,
        );
        const org = ourResponse.data.metadata.organization;
        expect(["unfoldingWord", "multiple", "all"]).toContain(org);
      }
    });
  });

  describe("Translation Academy Validation", () => {
    it("should find Translation Academy articles that exist in DCS", async () => {
      const dcsResult = await dcsAcademyExists({
        path: "translate/figs-metaphor",
        language: "en",
        organization: "unfoldingWord",
      });

      // Check if TA exists at all for this language
      if (!dcsResult.exists) {
        console.warn(
          "DCS does not have en_ta for unfoldingWord, skipping test",
        );
        return;
      }

      const ourResponse = await client.callRESTRaw(
        "fetch-translation-academy",
        {
          path: "translate/figs-metaphor",
          language: "en",
        },
      );

      expect(ourResponse.status).toBe(200);
      expect(
        ourResponse.data.content ??
          ourResponse.data.markdown ??
          ourResponse.data,
      ).toBeDefined();
    });

    it("should return metadata matching DCS for Translation Academy", async () => {
      const ourResponse = await client.callRESTRaw(
        "fetch-translation-academy",
        {
          path: "translate/translate-unknown",
          language: "en",
        },
      );

      if (ourResponse.status === 200) {
        const dcsResult = await dcsAcademyExists({
          path: "translate/translate-unknown",
          language: "en",
          organization: "unfoldingWord",
        });

        expect(dcsResult.exists).toBe(true);

        if (ourResponse.data.metadata) {
          expect(ourResponse.data.metadata.language).toBe(
            dcsResult.actualLanguage,
          );
          const mo = ourResponse.data.metadata.organization;
          expect(
            mo === dcsResult.actualOrganization ||
              mo === "all" ||
              mo === "multiple",
          ).toBe(true);
        } else {
          throw new Error("Response missing metadata object");
        }
      }
    });
  });

  describe("Translation Word Validation", () => {
    it("should find Translation Words that exist in DCS", async () => {
      const dcsResult = await dcsWordExists({
        path: "bible/kt/god",
        language: "en",
        organization: "unfoldingWord",
      });

      // Check if TW exists at all for this language
      if (!dcsResult.exists) {
        console.warn(
          "DCS does not have en_tw for unfoldingWord, skipping test",
        );
        return;
      }

      const ourResponse = await client.callRESTRaw("fetch-translation-word", {
        path: "bible/kt/god",
        language: "en",
      });

      expect(ourResponse.status).toBe(200);
      expect(
        ourResponse.data.content ??
          ourResponse.data.markdown ??
          ourResponse.data,
      ).toBeDefined();
    });

    it("should return metadata matching DCS for Translation Word", async () => {
      const ourResponse = await client.callRESTRaw("fetch-translation-word", {
        path: "bible/kt/jesus",
        language: "en",
      });

      if (ourResponse.status === 200) {
        const dcsResult = await dcsWordExists({
          path: "bible/kt/jesus",
          language: "en",
          organization: "unfoldingWord",
        });

        expect(dcsResult.exists).toBe(true);

        if (ourResponse.data.metadata) {
          expect(ourResponse.data.metadata.language).toBe(
            dcsResult.actualLanguage,
          );
          const mo = ourResponse.data.metadata.organization;
          expect(
            mo === dcsResult.actualOrganization ||
              mo === "all" ||
              mo === "multiple",
          ).toBe(true);
        } else {
          throw new Error("Response missing metadata object");
        }
      }
    });
  });

  describe("Scripture discovery (no org filter)", () => {
    it("should search all organizations when parameter empty/missing (matching DCS behavior)", async () => {
      const withoutOrgResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "JHN 3:16",
        language: "en",
      });

      const dcsWithoutOrg = await dcsScriptureExists({
        language: "en",
      });

      if (dcsWithoutOrg.exists) {
        expect(withoutOrgResponse.status).toBe(200);
        expect(withoutOrgResponse.data.metadata?.organization).toBeDefined();
      } else {
        expect(withoutOrgResponse.status).toBe(404);
      }
    });
  });

  describe("Comprehensive Source Comparison", () => {
    it("should match DCS for English ULT scripture", async () => {
      const ourResponse = await client.callRESTRaw("fetch-scripture", {
        reference: "MAT 1:1",
        language: "en",
      });

      const comparison = await comparewithDCS({
        endpoint: "/api/fetch-scripture",
        language: "en",
        organization: "unfoldingWord",
        subject: "Bible",
        ourResponse: ourResponse.data,
        httpStatus: ourResponse.status,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });

    it("should match DCS for Translation Academy", async () => {
      const ourResponse = await client.callRESTRaw(
        "fetch-translation-academy",
        {
          path: "translate/figs-idiom",
          language: "en",
        },
      );

      const comparison = await comparewithDCS({
        endpoint: "/api/fetch-translation-academy",
        language: "en",
        organization: "unfoldingWord",
        subject: "Translation Academy",
        ourResponse: ourResponse.data,
        httpStatus: ourResponse.status,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });

    it("should match DCS for Translation Words", async () => {
      const ourResponse = await client.callRESTRaw("fetch-translation-word", {
        path: "bible/kt/faith",
        language: "en",
      });

      const comparison = await comparewithDCS({
        endpoint: "/api/fetch-translation-word",
        language: "en",
        organization: "unfoldingWord",
        subject: "Translation Words",
        ourResponse: ourResponse.data,
        httpStatus: ourResponse.status,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });
  });

  describe("Edge Cases & Data Consistency", () => {
    it("should not hallucinate resources (return data DCS does not have)", async () => {
      // Try fetching resources for a language/org combination that definitely doesn't exist
      const testCases = [
        {
          endpoint: "fetch-scripture",
          params: { reference: "JHN 1:1", language: "zz" },
          subject: "Bible",
        },
        {
          endpoint: "fetch-translation-academy",
          params: { path: "translate/test", language: "zz" },
          subject: "Translation Academy",
        },
        {
          endpoint: "fetch-translation-word",
          params: { path: "bible/kt/test", language: "zz" },
          subject: "Translation Words",
        },
      ];

      for (const testCase of testCases) {
        const ourResponse = await client.callRESTRaw(
          testCase.endpoint,
          testCase.params,
        );

        const dcsExists = await dcsResourceExists({
          language: testCase.params.language,
          subject: testCase.subject,
        });

        if (!dcsExists.exists) {
          expect(ourResponse.status).toBe(404);
        }
      }
    });

    it("should not miss resources (fail to find data DCS does have)", async () => {
      const testCases = [
        {
          endpoint: "fetch-scripture",
          params: { reference: "GEN 1:1", language: "en" },
          subject: "Bible",
        },
        {
          endpoint: "fetch-translation-academy",
          params: { path: "translate/translate-names", language: "en" },
          subject: "Translation Academy",
        },
        {
          endpoint: "fetch-translation-word",
          params: { path: "bible/kt/grace", language: "en" },
          subject: "Translation Words",
        },
      ];

      for (const testCase of testCases) {
        const dcsExists = await dcsResourceExists({
          language: testCase.params.language,
          subject: testCase.subject,
        });

        if (dcsExists.exists) {
          const ourResponse = await client.callRESTRaw(
            testCase.endpoint,
            testCase.params,
          );

          expect(ourResponse.status).toBe(200);
          expect(ourResponse.data).toBeDefined();
        }
      }
    });
  });
});
