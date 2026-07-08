/**
 * Fetch OBS Helps Tools (issue #32)
 * One shared handler for the four OBS helps tools — translation notes (tn),
 * translation questions (tq), study notes (sn), study questions (sq). They
 * differ only by resource type; all take an OBS story:frame reference.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  handleMCPError,
  buildResourceUnavailableResult,
} from "../utils/mcp-error-handler.js";
import {
  fetchOBSHelps,
  type OBSHelpsType,
} from "../functions/obs-helps-service.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions (same
// story:frame reference + language shape for all four helps tools)
export const FetchObsHelpsArgs = toZodObject(PARAMETER_GROUPS.obs.parameters);

export type FetchObsHelpsArgs = z.infer<typeof FetchObsHelpsArgs>;

const TOOL_NAMES: Record<OBSHelpsType, string> = {
  tn: "fetch_obs_translation_notes",
  tq: "fetch_obs_translation_questions",
  sn: "fetch_obs_study_notes",
  sq: "fetch_obs_study_questions",
};

/**
 * Handle a fetch_obs_* helps tool call for the given resource type.
 */
export async function handleFetchObsHelps(
  resourceType: OBSHelpsType,
  args: FetchObsHelpsArgs,
) {
  const toolName = TOOL_NAMES[resourceType];
  try {
    logger.info(`Fetching OBS helps (${resourceType})`, args);

    const result = await fetchOBSHelps({
      resourceType,
      reference: args.reference as string,
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
      logger.info(`OBS ${resourceType} resource not available`, {
        args,
        message: error?.message,
      });
      return notAvailable;
    }

    logger.error(`Failed to fetch OBS helps (${resourceType})`, {
      error,
      args,
    });
    return handleMCPError({
      toolName,
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
