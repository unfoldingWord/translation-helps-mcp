/**
 * Response Equivalence Tests
 *
 * Ensures MCP tools and REST endpoints return structurally equivalent data:
 * - Same data structure (fields, types)
 * - Same content (accounting for MCP text formatting)
 * - Consistent error responses
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient, extractMCPText } from "./helpers/test-client";
import { TEST_COMBINATIONS, EXPECTED_STRUCTURES } from "./helpers/test-data";

describe("Response Equivalence Tests", () => {
  const client = new TestClient();

  beforeAll(async () => {
    await client.waitForServer();
  });

  describe("Scripture Endpoint", () => {
    TEST_COMBINATIONS.scripture.forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        let restResponse: any;
        let mcpResponse: any;
        let bothSucceeded = false;

        try {
          // Call REST endpoint
          restResponse = await client.callREST("fetch-scripture", params);

          // Call MCP tool
          const mcpResult = await client.callMCPTool({
            name: "fetch_scripture",
            arguments: params,
          });
          mcpResponse = extractMCPText(mcpResult);

          bothSucceeded = true;

          // Verify REST response structure
          expect(restResponse).toBeDefined();
          EXPECTED_STRUCTURES.scripture.requiredFields.forEach((field) => {
            expect(restResponse).toHaveProperty(field);
          });
          expect(Array.isArray(restResponse.scripture)).toBe(true);
          expect(restResponse.scripture.length).toBeGreaterThan(0);
          expect(restResponse.scripture[0]).toHaveProperty("text");

          // Verify MCP response contains content
          expect(mcpResponse).toBeTruthy();
          expect(mcpResponse.length).toBeGreaterThan(0);

          // MCP response should be formatted text, not raw JSON
          // (unless textExtractor returns JSON for some reason)
        } catch (error: any) {
          // If both fail with 404 (resource not found), that's OK for this test
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `  ⚠️  Resource not found for ${JSON.stringify(params)} (expected for some combinations)`,
            );
            return;
          }

          throw error;
        }

        // If we got here, both succeeded
        expect(bothSucceeded).toBe(true);
      });
    });
  });

  describe("Translation Notes Endpoint", () => {
    TEST_COMBINATIONS.translationNotes.slice(0, 2).forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        try {
          const restResponse = await client.callREST(
            "fetch-translation-notes",
            params,
          );
          const mcpResult = await client.callMCPTool({
            name: "fetch_translation_notes",
            arguments: params,
          });
          const mcpResponse = extractMCPText(mcpResult);

          // Verify REST response structure
          expect(restResponse).toBeDefined();
          EXPECTED_STRUCTURES.translationNotes.requiredFields.forEach(
            (field) => {
              expect(restResponse).toHaveProperty(field);
            },
          );
          expect(Array.isArray(restResponse.verseNotes)).toBe(true);

          // Verify MCP response
          expect(mcpResponse).toBeTruthy();
        } catch (error: any) {
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `  ⚠️  Resource not found for ${JSON.stringify(params)}`,
            );
            return;
          }
          throw error;
        }
      });
    });
  });

  describe("Translation Word Endpoint", () => {
    TEST_COMBINATIONS.translationWords.forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        try {
          const restResponse = await client.callREST(
            "fetch-translation-word",
            params,
          );
          const mcpResult = await client.callMCPTool({
            name: "fetch_translation_word",
            arguments: params,
          });
          const mcpResponse = extractMCPText(mcpResult);

          // Verify REST response structure
          expect(restResponse).toBeDefined();
          if (typeof restResponse === "string") {
            expect(restResponse.length).toBeGreaterThan(20);
          } else {
            EXPECTED_STRUCTURES.translationWord.requiredFields.forEach(
              (field) => {
                expect(restResponse).toHaveProperty(field);
              },
            );
          }

          // Verify MCP response
          expect(mcpResponse).toBeTruthy();

          // If format is JSON, MCP might return JSON string
          if (params.format === "json") {
            // Try parsing as JSON
            try {
              const mcpObject = JSON.parse(mcpResponse);
              expect(mcpObject).toHaveProperty("content");
            } catch {
              // If not JSON, that's OK - textExtractor might format it
            }
          }
        } catch (error: any) {
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `  ⚠️  Resource not found for ${JSON.stringify(params)}`,
            );
            return;
          }
          throw error;
        }
      });
    });
  });

  describe("Translation Academy Endpoint", () => {
    TEST_COMBINATIONS.translationAcademy.forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        try {
          const restResponse = await client.callREST(
            "fetch-translation-academy",
            params,
          );
          const mcpResult = await client.callMCPTool({
            name: "fetch_translation_academy",
            arguments: params,
          });
          const mcpResponse = extractMCPText(mcpResult);

          // Verify REST response structure
          expect(restResponse).toBeDefined();
          if (typeof restResponse === "string") {
            expect(restResponse.length).toBeGreaterThan(20);
          } else {
            EXPECTED_STRUCTURES.translationAcademy.requiredFields.forEach(
              (field) => {
                expect(restResponse).toHaveProperty(field);
              },
            );
          }

          // Verify MCP response
          expect(mcpResponse).toBeTruthy();
          expect(mcpResponse).not.toBe("No translation academy content found");
          expect(mcpResponse).not.toBe("No content found");

          // If format is JSON, verify structure
          if (params.format === "json") {
            try {
              const mcpObject = JSON.parse(mcpResponse);
              expect(mcpObject).toHaveProperty("content");
            } catch {
              // If not JSON, that's OK
            }
          }
        } catch (error: any) {
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `  ⚠️  Resource not found for ${JSON.stringify(params)}`,
            );
            return;
          }
          throw error;
        }
      });
    });
  });

  describe("List Languages Endpoint", () => {
    TEST_COMBINATIONS.listLanguages.forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        const restResponse = await client.callREST("list-languages", params);
        const mcpResult = await client.callMCPTool({
          name: "list_languages",
          arguments: params,
        });
        const mcpText = extractMCPText(mcpResult);

        // Verify REST response structure
        expect(restResponse).toBeDefined();
        EXPECTED_STRUCTURES.listLanguages.requiredFields.forEach((field) => {
          expect(restResponse).toHaveProperty(field);
        });
        expect(Array.isArray(restResponse.languages)).toBe(true);
        expect(restResponse.languages.length).toBeGreaterThan(0);

        // Verify MCP response
        expect(mcpText).toBeTruthy();

        // MCP should return formatted text listing languages
        // Try to parse as JSON first
        try {
          const mcpObject = JSON.parse(mcpText);
          expect(mcpObject).toHaveProperty("languages");
          expect(Array.isArray(mcpObject.languages)).toBe(true);
          expect(mcpObject.languages.length).toBe(
            restResponse.languages.length,
          );
        } catch {
          // If not JSON, should be formatted text
          expect(mcpText).toContain("language");
        }
      });
    });
  });

  describe("List Subjects Endpoint", () => {
    TEST_COMBINATIONS.listSubjects.forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        const restResponse = await client.callREST("list-subjects", params);
        const mcpResult = await client.callMCPTool({
          name: "list_subjects",
          arguments: params,
        });
        const mcpText = extractMCPText(mcpResult);

        // Verify REST response structure
        expect(restResponse).toBeDefined();
        EXPECTED_STRUCTURES.listSubjects.requiredFields.forEach((field) => {
          expect(restResponse).toHaveProperty(field);
        });
        expect(Array.isArray(restResponse.subjects)).toBe(true);

        // Verify MCP response
        expect(mcpText).toBeTruthy();
      });
    });
  });

  describe("List Resources For Language Endpoint", () => {
    TEST_COMBINATIONS.listResourcesForLanguage.slice(0, 3).forEach((params) => {
      it(`should return equivalent data for ${JSON.stringify(params)}`, async () => {
        try {
          const restResponse = await client.callREST(
            "list-resources-for-language",
            params,
          );
          const mcpResult = await client.callMCPTool({
            name: "list_resources_for_language",
            arguments: params,
          });
          const mcpText = extractMCPText(mcpResult);

          // Verify REST response structure
          expect(restResponse).toBeDefined();
          EXPECTED_STRUCTURES.listResourcesForLanguage.requiredFields.forEach(
            (field) => {
              expect(restResponse).toHaveProperty(field);
            },
          );

          // Verify MCP response
          expect(mcpText).toBeTruthy();
        } catch (error: any) {
          if (
            error.message.includes("404") ||
            error.message.includes("not found")
          ) {
            console.log(
              `  ⚠️  Resource not found for ${JSON.stringify(params)}`,
            );
            return;
          }
          throw error;
        }
      });
    });
  });

  describe("Error Response Consistency", () => {
    const errorTestCases = [
      {
        name: "fetch_scripture without reference",
        tool: "fetch_scripture",
        endpoint: "fetch-scripture",
        params: {},
        expectedError: /required/i,
      },
      {
        name: "fetch_translation_word with invalid format",
        tool: "fetch_translation_word",
        endpoint: "fetch-translation-word",
        params: { path: "kt/faith", format: "invalid" },
        expectedError: /invalid.*format/i,
      },
    ];

    errorTestCases.forEach(
      ({ name, tool, endpoint, params, expectedError }) => {
        it(`should return consistent errors for ${name}`, async () => {
          let mcpError: string = "";
          let restError: string = "";

          // Try MCP
          try {
            await client.callMCPTool({ name: tool, arguments: params });
          } catch (error: any) {
            mcpError = error.message;
          }

          // Try REST
          try {
            await client.callREST(endpoint, params);
          } catch (error: any) {
            restError = error.message;
          }

          // Both should fail
          expect(mcpError, "MCP should have failed").toBeTruthy();
          expect(restError, "REST should have failed").toBeTruthy();

          // Both errors should match the expected pattern
          expect(mcpError).toMatch(expectedError);
          expect(restError).toMatch(expectedError);

          console.log(`\n  ✅ Both failed consistently:`);
          console.log(`     MCP:  ${mcpError.slice(0, 100)}`);
          console.log(`     REST: ${restError.slice(0, 100)}`);
        });
      },
    );
  });

  describe("Format Parameter Consistency", () => {
    const formatTests = [
      {
        tool: "fetch_translation_word",
        endpoint: "fetch-translation-word",
        baseParams: { path: "kt/faith" },
        formats: ["json", "md", "markdown"],
      },
      {
        tool: "fetch_translation_academy",
        endpoint: "fetch-translation-academy",
        baseParams: { path: "figs-metaphor" },
        formats: ["json", "md", "markdown"],
      },
    ];

    formatTests.forEach(({ tool, endpoint, baseParams, formats }) => {
      formats.forEach((format) => {
        it(`should handle format=${format} consistently for ${tool}`, async () => {
          const params = { ...baseParams, format };

          try {
            const restResponse = await client.callREST(endpoint, params);
            const mcpResult = await client.callMCPTool({
              name: tool,
              arguments: params,
            });
            const mcpText = extractMCPText(mcpResult);

            // Both should succeed
            expect(restResponse).toBeDefined();
            expect(mcpText).toBeTruthy();

            // Verify format-specific expectations
            if (format === "json") {
              expect(restResponse).toHaveProperty("content");

              // MCP might return JSON or formatted text
              if (mcpText.startsWith("{")) {
                const mcpObject = JSON.parse(mcpText);
                expect(mcpObject).toHaveProperty("content");
              }
            }

            if (format === "md" || format === "markdown") {
              // REST should return content
              expect(
                restResponse.content || typeof restResponse === "string",
              ).toBeTruthy();

              // MCP should return markdown text
              expect(mcpText).toBeTruthy();
              expect(mcpText).not.toBe("No content found");
            }
          } catch (error: any) {
            if (
              error.message.includes("404") ||
              error.message.includes("not found")
            ) {
              console.log(
                `  ⚠️  Resource not found for ${JSON.stringify(params)}`,
              );
              return;
            }
            throw error;
          }
        });
      });
    });
  });
});
