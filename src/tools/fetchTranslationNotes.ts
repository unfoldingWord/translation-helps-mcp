/**
 * Fetch Translation Notes Tool
 * Tool for fetching translation notes for a specific Bible reference
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { createTranslationNotesService, type TranslationNotesParams } from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchTranslationNotesArgs = toZodObject(PARAMETER_GROUPS.translationNotes.parameters);

export type FetchTranslationNotesArgs = z.infer<typeof FetchTranslationNotesArgs>;

/**
 * Handle the fetch translation notes tool call
 * Uses unified service layer for consistent business logic
 */
export async function handleFetchTranslationNotes(
  args: FetchTranslationNotesArgs,
) {
  try {
    logger.info("Fetching translation notes", args);

    // Create and execute unified service
    const service = createTranslationNotesService();
    const response = await service.execute(args as TranslationNotesParams, {
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
    logger.error("Failed to fetch translation notes", { error, args });
    return handleMCPError({
      toolName: "fetch_translation_notes",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
