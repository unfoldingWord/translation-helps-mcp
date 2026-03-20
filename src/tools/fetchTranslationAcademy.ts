/**
 * Fetch Translation Academy Tool
 * Tool for fetching translation academy modules and training content
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { createTranslationAcademyService, type TranslationAcademyParams } from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchTranslationAcademyArgs = toZodObject(PARAMETER_GROUPS.translationAcademy.parameters);

export type FetchTranslationAcademyArgs = z.infer<typeof FetchTranslationAcademyArgs>;

/**
 * Handle the fetch translation academy tool call
 * Uses unified service layer for consistent business logic
 */
export async function handleFetchTranslationAcademy(
  args: FetchTranslationAcademyArgs,
) {
  try {
    logger.info("Fetching translation academy content", args);

    // Create and execute unified service
    const service = createTranslationAcademyService();
    const response = await service.execute(args as TranslationAcademyParams, {
      platform: 'mcp',
    });

    // Format response for MCP
    const textContent = typeof response.data === 'string' 
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
    logger.error("Failed to fetch translation academy", { error, args });
    return handleMCPError({
      toolName: "fetch_translation_academy",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
