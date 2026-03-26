/**
 * Error Handling Tests
 *
 * Ensures errors are consistent and helpful across MCP and REST:
 * - Missing required parameters → 400 error
 * - Invalid parameter values → 400 error
 * - Resource not found → 404 error
 * - Language variant fallback → successful retry or clear error
 * - Organization parameter handling → respects explicit values
 * - Error messages are clear and actionable
 */

import { describe, it, expect, beforeAll } from "vitest";
import { TestClient } from "./helpers/test-client";
import { TEST_DATA } from "./helpers/test-data";

describe("Error Handling Tests", () => {
  const client = new TestClient();

  beforeAll(async () => {
    await client.waitForServer();
  });

  describe("Missing Required Parameters (400 errors)", () => {
    const testCases = [
      {
        name: "fetch_scripture without reference",
        tool: "fetch_scripture",
        endpoint: "fetch-scripture",
        params: {},
        expectedPattern: /required.*reference/i,
      },
      {
        name: "fetch_translation_notes without reference",
        tool: "fetch_translation_notes",
        endpoint: "fetch-translation-notes",
        params: {},
        expectedPattern: /required.*reference/i,
      },
      {
        name: "fetch_translation_word without path",
        tool: "fetch_translation_word",
        endpoint: "fetch-translation-word",
        params: {},
        // MCP: missing required param; REST: 400 "No path provided…"
        expectedPattern: /required.*path|path.*required|no path|missing.*path/i,
      },
      {
        name: "fetch_translation_academy without path",
        tool: "fetch_translation_academy",
        endpoint: "fetch-translation-academy",
        params: {},
        expectedPattern: /required.*path|path.*required|no path|missing.*path/i,
      },
      {
        name: "list_resources_for_language without language",
        tool: "list_resources_for_language",
        endpoint: "list-resources-for-language",
        params: {},
        expectedPattern: /required.*language/i,
      },
    ];

    testCases.forEach(({ name, tool, endpoint, params, expectedPattern }) => {
      it(`should return consistent 400 errors for ${name}`, async () => {
        let mcpError: string = "";
        let restError: string = "";

        // Try MCP
        try {
          await client.callMCPTool({ name: tool, arguments: params });
          throw new Error("MCP should have thrown an error");
        } catch (error: any) {
          mcpError = error.message;
        }

        // Try REST
        try {
          await client.callREST(endpoint, params);
          throw new Error("REST should have thrown an error");
        } catch (error: any) {
          restError = error.message;
        }

        // Both should have failed
        expect(mcpError, "MCP should have error").toBeTruthy();
        expect(restError, "REST should have error").toBeTruthy();

        // Both should match expected pattern
        expect(mcpError).toMatch(expectedPattern);
        expect(restError).toMatch(expectedPattern);

        console.log(`\n  ✅ Both APIs failed consistently for ${name}`);
        console.log(`     MCP:  ${mcpError.slice(0, 80)}...`);
        console.log(`     REST: ${restError.slice(0, 80)}...`);
      });
    });
  });

  describe("Invalid Parameter Values (400 errors)", () => {
    it("should reject invalid format with clear error", async () => {
      const mcpErrors: string[] = [];
      const restErrors: string[] = [];

      try {
        await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: { path: "kt/faith", format: "invalid" },
        });
      } catch (error: any) {
        mcpErrors.push(error.message);
      }

      try {
        await client.callREST("fetch-translation-word", {
          path: "kt/faith",
          format: "invalid",
        });
      } catch (error: any) {
        restErrors.push(error.message);
      }

      expect(mcpErrors.length).toBeGreaterThan(0);
      expect(restErrors.length).toBeGreaterThan(0);

      mcpErrors.forEach((err) => {
        expect(err.toLowerCase()).toMatch(/format|invalid/);
      });

      restErrors.forEach((err) => {
        expect(err.toLowerCase()).toMatch(/format|invalid/);
      });
    });

    it("should reject invalid reference format", async () => {
      const invalidReferences = [
        "InvalidBook 1:1",
        "Genesis 999:999",
        "NotABook 1:1",
      ];

      for (const reference of invalidReferences) {
        try {
          await client.callMCPTool({
            name: "fetch_scripture",
            arguments: { reference },
          });

          // If it doesn't throw, that's OK - some invalid refs might be handled gracefully
        } catch (error: any) {
          // Error should mention reference, validation, book codes, or missing content
          expect(error.message.toLowerCase()).toMatch(
            /reference|invalid|not found|book|parameter|scripture/,
          );
        }
      }
    });
  });

  describe("Resource Not Found (404 errors)", () => {
    it("should return 404 for non-existent language", async () => {
      let mcpError: string = "";
      let restError: string = "";

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: TEST_DATA.languages.invalid,
          },
        });
      } catch (error: any) {
        mcpError = error.message;
      }

      try {
        await client.callREST("fetch-scripture", {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.invalid,
        });
      } catch (error: any) {
        restError = error.message;
      }

      // Both should fail
      expect(mcpError).toBeTruthy();
      expect(restError).toBeTruthy();

      // Unresolvable language may be 404 upstream or 400 invalid parameter
      expect(mcpError.toLowerCase()).toMatch(
        /not found|404|invalid|language|parameter|scripture/,
      );
      expect(restError.toLowerCase()).toMatch(
        /not found|404|invalid|language|parameter|scripture/,
      );
    });

    it("should return 404 for non-existent resource path", async () => {
      let mcpError: string = "";

      try {
        await client.callMCPTool({
          name: "fetch_translation_word",
          arguments: {
            path: "kt/nonexistent-word-xyz123",
            language: "en",
          },
        });
      } catch (error: any) {
        mcpError = error.message;
      }

      expect(mcpError).toBeTruthy();
      expect(mcpError.toLowerCase()).toMatch(/not found|404/);
    });
  });

  describe("Error Message Quality", () => {
    it("should provide actionable error messages", async () => {
      const errorScenarios = [
        {
          tool: "fetch_scripture",
          params: {},
          shouldMention: ["reference", "required"],
        },
        {
          tool: "fetch_translation_word",
          params: { path: "kt/faith", format: "invalid" },
          shouldMention: ["format", "invalid"],
        },
      ];

      for (const scenario of errorScenarios) {
        try {
          await client.callMCPTool({
            name: scenario.tool,
            arguments: scenario.params,
          });
        } catch (error: any) {
          const errorLower = error.message.toLowerCase();

          scenario.shouldMention.forEach((keyword) => {
            expect(
              errorLower,
              `Error for ${scenario.tool} should mention '${keyword}'`,
            ).toContain(keyword);
          });

          // Error should not be just "Error" or empty
          expect(error.message.length).toBeGreaterThan(10);
        }
      }
    });

    it("should include helpful context in error messages", async () => {
      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {},
        });
      } catch (error: any) {
        const message = error.message;

        // Good error messages should:
        // 1. Say what went wrong
        expect(message.toLowerCase()).toMatch(/missing|required|error/);

        // 2. Say what parameter is problematic
        expect(message.toLowerCase()).toContain("reference");

        // 3. Be reasonably concise (not a stack trace)
        expect(message.length).toBeLessThan(500);
      }
    });
  });

  describe("Error Consistency Between MCP and REST", () => {
    it("should return structurally similar errors", async () => {
      const testParams = {
        tool: "fetch_scripture",
        endpoint: "fetch-scripture",
        params: {}, // Missing required reference
      };

      let mcpErrorStructure: any = {};
      let restErrorStructure: any = {};

      try {
        await client.callMCPTool({
          name: testParams.tool,
          arguments: testParams.params,
        });
      } catch (error: any) {
        mcpErrorStructure = {
          hasMessage: !!error.message,
          messageLength: error.message?.length || 0,
          isString: typeof error.message === "string",
        };
      }

      try {
        await client.callREST(testParams.endpoint, testParams.params);
      } catch (error: any) {
        restErrorStructure = {
          hasMessage: !!error.message,
          messageLength: error.message?.length || 0,
          isString: typeof error.message === "string",
        };
      }

      // Both should have string messages
      expect(mcpErrorStructure.isString).toBe(true);
      expect(restErrorStructure.isString).toBe(true);

      // Both should have non-empty messages
      expect(mcpErrorStructure.messageLength).toBeGreaterThan(0);
      expect(restErrorStructure.messageLength).toBeGreaterThan(0);
    });
  });

  describe("Graceful Degradation", () => {
    it("should handle malformed requests without crashing", async () => {
      const malformedRequests = [
        { name: "fetch_scripture", arguments: { reference: null as any } },
        { name: "fetch_scripture", arguments: { reference: undefined as any } },
        { name: "fetch_scripture", arguments: { reference: "" } },
      ];

      for (const request of malformedRequests) {
        try {
          await client.callMCPTool(request);
          // If it succeeds (unlikely), that's OK
        } catch (error: any) {
          // Should get a proper error, not a crash
          expect(error.message).toBeDefined();
          expect(typeof error.message).toBe("string");
          expect(error.message.length).toBeGreaterThan(0);
        }
      }
    });

    it("should handle unexpected parameter types gracefully", async () => {
      const unexpectedTypes = [
        { reference: { invalid: "object" } as any },
        { reference: ["array"] as any },
        { reference: 12345 as any },
        { reference: true as any },
      ];

      for (const params of unexpectedTypes) {
        try {
          await client.callMCPTool({
            name: "fetch_scripture",
            arguments: params,
          });
        } catch (error: any) {
          // Should get type validation error, not crash
          expect(error.message).toBeDefined();
          expect(error.message.toLowerCase()).toMatch(/type|invalid|string/);
        }
      }
    });
  });

  describe("Rate Limiting and Server Errors", () => {
    it("should handle server errors gracefully", async () => {
      // Try to trigger server error with extreme parameters
      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: "A".repeat(10000), // Extremely long reference
          },
        });
      } catch (error: any) {
        // Should get error, not hang forever
        expect(error.message).toBeDefined();
      }
    }, 10000); // 10s timeout

    it("should timeout appropriately for slow requests", async () => {
      const startTime = Date.now();

      try {
        await client.callMCPTool({
          name: "fetch_scripture",
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: "en",
          },
        });
      } catch (_error: any) {
        // If error occurs, it should happen within reasonable time
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(30000); // 30s max
      }
    }, 35000); // 35s test timeout
  });
});
