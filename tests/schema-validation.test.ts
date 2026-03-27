/**
 * Schema Validation Tests
 *
 * Ensures tool input schemas match actual parameter requirements:
 * - Required parameters are enforced
 * - Optional parameters work with defaults
 * - Invalid parameters are rejected
 * - Parameter types are validated
 * - Enum parameters only accept valid values
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient } from "./helpers/test-client";
import { TEST_DATA } from "./helpers/test-data";

describe("Schema Validation Tests", () => {
  const client = new TestClient();

  beforeAll(async () => {
    await client.waitForServer();
  });

  describe("Required Parameters", () => {
    it("should reject fetch_scripture without reference", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {}, // Missing required 'reference'
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(
          /required|missing|reference/,
        );
      }

      expect(
        errorThrown,
        "Should have thrown error for missing required parameter",
      ).toBe(true);
    });

    it("should reject fetch_translation_notes without reference", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_translation_notes",
          arguments: {},
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(
          /required|missing|reference/,
        );
      }

      expect(errorThrown).toBe(true);
    });

    it("should reject fetch_translation_word without path", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: {},
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/required|missing|path/);
      }

      expect(errorThrown).toBe(true);
    });

    it("should reject fetch_translation_academy without path", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_translation_academy",
          arguments: {},
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/required|missing|path/);
      }

      expect(errorThrown).toBe(true);
    });

    it("should reject list_resources_for_language without language", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "list_resources_for_language",
          arguments: {},
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(
          /required|missing|language/,
        );
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("Optional Parameters", () => {
    it("should accept fetch_scripture with only required params", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
          },
        });

        expect(response).toBeDefined();
        expect(response.content).toBeDefined();
      } catch (error: any) {
        // 404 is OK (resource might not be found), but validation errors are not
        if (
          !error.message.includes("404") &&
          !error.message.includes("not found")
        ) {
          throw error;
        }
      }
    });

    it("should accept fetch_scripture with optional language", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: TEST_DATA.languages.english,
          },
        });

        expect(response).toBeDefined();
      } catch (error: any) {
        if (
          !error.message.includes("404") &&
          !error.message.includes("not found")
        ) {
          throw error;
        }
      }
    });

    it("should accept fetch_scripture with optional resource", async () => {
      try {
        const response = await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerseUsfm,
            language: TEST_DATA.languages.english,
            resource: "ult",
          },
        });

        expect(response).toBeDefined();
      } catch (error: any) {
        if (
          !error.message.includes("404") &&
          !error.message.includes("not found")
        ) {
          throw error;
        }
      }
    });
  });

  describe("Parameter Type Validation", () => {
    it("should reject non-string reference", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: 12345 as any, // Should be string
          },
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/type|string|invalid/);
      }

      expect(errorThrown).toBe(true);
    });

    it("should reject non-string language", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: true as any, // Should be string
          },
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/type|string|invalid/);
      }

      expect(errorThrown).toBe(true);
    });
  });

  describe("Enum Parameter Validation", () => {
    it("should reject invalid format value", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: {
            path: TEST_DATA.translationWords.faith.path,
            format: "invalid-format" as any,
          },
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/format|invalid|must be/);
      }

      expect(errorThrown).toBe(true);
    });

    it("should accept valid format values", async () => {
      const validFormats = ["json", "md", "markdown"];

      for (const format of validFormats) {
        try {
          const response = await client.callMCPTool({
            name: "fetch_translation_word",
            arguments: {
              path: TEST_DATA.translationWords.faith.path,
              format,
            },
          });

          expect(response).toBeDefined();
        } catch (error: any) {
          // 404 is OK, validation errors are not
          if (
            !error.message.includes("404") &&
            !error.message.includes("not found")
          ) {
            throw new Error(
              `Valid format '${format}' was rejected: ${error.message}`,
            );
          }
        }
      }
    });

    it("should reject invalid category value", async () => {
      let errorThrown = false;

      try {
        await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: {
            path: TEST_DATA.translationWords.faith.path,
            category: "invalid-category" as any,
          },
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/category|invalid|must be/);
      }

      expect(errorThrown).toBe(true);
    });

    it("should accept valid category values", async () => {
      const validCategories = ["kt", "names", "other"];

      for (const category of validCategories) {
        try {
          const response = await client.callMCPTool({
            name: "fetch_translation_word",
            arguments: {
              path: `${category}/test`,
              category,
            },
          });

          // We expect this to succeed or 404, not validation error
          expect(response).toBeDefined();
        } catch (error: any) {
          if (
            !error.message.includes("404") &&
            !error.message.includes("not found")
          ) {
            throw new Error(
              `Valid category '${category}' was rejected: ${error.message}`,
            );
          }
        }
      }
    });
  });

  describe("Parameter Combinations", () => {
    it("should accept all valid parameter combinations for fetch_scripture", async () => {
      const combinations = [
        { reference: TEST_DATA.references.singleVerse },
        { reference: TEST_DATA.references.singleVerse, language: "en" },
        {
          reference: TEST_DATA.references.singleVerseUsfm,
          language: "en",
          resource: "ult",
        },
      ];

      for (const params of combinations) {
        try {
          const response = await client.callMCPTool({
            name: "fetch_scripture",
            arguments: params,
          });

          expect(response).toBeDefined();
        } catch (error: any) {
          // 404 is OK
          if (
            !error.message.includes("404") &&
            !error.message.includes("not found")
          ) {
            throw new Error(
              `Valid combination ${JSON.stringify(params)} was rejected: ${error.message}`,
            );
          }
        }
      }
    });

    it("should accept all valid parameter combinations for fetch_translation_word", async () => {
      const combinations = [
        { path: "kt/faith" },
        { path: "kt/faith", language: "en" },
        { path: "kt/faith", format: "json" },
        { path: "kt/faith", category: "kt" },
        { path: "kt/faith", language: "en", format: "json", category: "kt" },
      ];

      for (const params of combinations) {
        try {
          const response = await client.callMCPTool({
            name: "fetch_translation_word",
            arguments: params,
          });

          expect(response).toBeDefined();
        } catch (error: any) {
          if (
            !error.message.includes("404") &&
            !error.message.includes("not found")
          ) {
            throw new Error(
              `Valid combination ${JSON.stringify(params)} was rejected: ${error.message}`,
            );
          }
        }
      }
    });
  });

  describe("Tool Schema Consistency", () => {
    it("should have consistent schemas across all tools", async () => {
      const tools = await client.listMCPTools();

      // Check that all tools have input schemas
      tools.forEach((tool) => {
        expect(
          tool.inputSchema,
          `Tool ${tool.name} should have inputSchema`,
        ).toBeDefined();
      });

      // Check common parameter names are consistent
      const toolsWithLanguage = tools.filter(
        (t) => t.inputSchema?.properties?.language !== undefined,
      );

      toolsWithLanguage.forEach((tool) => {
        const langSchema = tool.inputSchema.properties.language;
        expect(langSchema.type, `${tool.name} language should be string`).toBe(
          "string",
        );
      });

      const toolsWithOrganization = tools.filter(
        (t) => t.inputSchema?.properties?.organization !== undefined,
      );

      expect(
        toolsWithOrganization.map((t) => t.name),
        "MCP tools must not expose an organization input parameter (all-org discovery only)",
      ).toEqual([]);
    });
  });
});
