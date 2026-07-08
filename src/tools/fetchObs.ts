/**
 * Fetch Open Bible Stories Tool (issue #32)
 * Fetches OBS story text (title + implicit image/paragraph frames, or front
 * matter) for an OBS story:frame reference — NOT a Bible book/chapter/verse.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  handleMCPError,
  buildResourceUnavailableResult,
} from "../utils/mcp-error-handler.js";
import { fetchOBSStory } from "../functions/obs-service.js";
import { resolveOBSReferenceArg } from "../functions/obs-reference-parser.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchObsArgs = toZodObject(PARAMETER_GROUPS.obs.parameters);

export type FetchObsArgs = z.infer<typeof FetchObsArgs>;

/**
 * Handle the fetch_obs tool call
 */
export async function handleFetchObs(args: FetchObsArgs) {
  try {
    logger.info("Fetching OBS story", args);

    // Honor the advertised story/frame fallback fields on this transport too
    // (the HTTP path normalizes them in UnifiedMCPHandler). An empty string
    // falls through to the parser's descriptive invalid-reference error.
    const reference =
      resolveOBSReferenceArg(args as Record<string, unknown>) ?? "";
    const result = await fetchOBSStory({
      reference,
      language: (args.language as string) || "en",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    // A not-available resource (404) is an expected result, not a failure (issue #30).
    const notAvailable = buildResourceUnavailableResult(error);
    if (notAvailable) {
      logger.info("OBS resource not available", {
        args,
        message: error?.message,
      });
      return notAvailable;
    }

    logger.error("Failed to fetch OBS story", { error, args });
    return handleMCPError({
      toolName: "fetch_obs",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
