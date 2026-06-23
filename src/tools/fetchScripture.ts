/**
 * Fetch Scripture Tool
 * Tool for fetching scripture text for a specific Bible reference
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  handleMCPError,
  buildResourceUnavailableResult,
} from "../utils/mcp-error-handler.js";
import { withPerformanceTracking } from "../utils/mcp-performance-tracker.js";
import {
  createScriptureService,
  type ScriptureParams,
} from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchScriptureArgs = toZodObject(
  PARAMETER_GROUPS.scripture.parameters,
);

export type FetchScriptureArgs = z.infer<typeof FetchScriptureArgs>;

/**
 * Handle the fetch scripture tool call
 * Uses unified service layer for consistent business logic
 */
export async function handleFetchScripture(args: FetchScriptureArgs) {
  return withPerformanceTracking(
    "fetch_scripture",
    async () => {
      try {
        logger.info("Fetching scripture", args);

        // Create and execute unified service
        const service = createScriptureService();
        const response = await service.execute(args as ScriptureParams, {
          platform: "mcp",
        });

        // Format response for MCP
        const textContent =
          typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data, null, 2);

        return {
          content: [
            {
              type: "text",
              text: textContent,
            },
          ],
          isError: false,
          ...(response.metadata && { metadata: response.metadata }),
        };
      } catch (error: any) {
        // A not-available resource (404) is an expected result, not a failure:
        // return it as a normal (isError:false) result so downstream consumers
        // don't treat it as a server outage (issue #30).
        const notAvailable = buildResourceUnavailableResult(error);
        if (notAvailable) {
          logger.info("Scripture resource not available", {
            args,
            message: error?.message,
          });
          return notAvailable;
        }

        logger.error("Failed to fetch scripture", { error, args });
        return handleMCPError({
          toolName: "fetch_scripture",
          args,
          startTime: Date.now(),
          originalError: error,
        });
      }
    },
    {
      extractCacheHit: (result) => {
        return result?.metadata?.cached || false;
      },
      extractDataSize: (result) => {
        if (result && typeof result === "object" && "content" in result) {
          const content = (result as any).content;
          if (Array.isArray(content) && content[0]?.text) {
            return Buffer.byteLength(content[0].text, "utf8");
          }
        }
        return 0;
      },
    },
  );
}
