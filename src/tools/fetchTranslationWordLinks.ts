/**
 * Fetch Translation Word Links Tool
 * Tool for fetching translation word links for a specific Bible reference
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { createTranslationWordLinksService, type TranslationWordLinksParams } from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchTranslationWordLinksArgs = toZodObject(PARAMETER_GROUPS.translationWordLinks.parameters);

export type FetchTranslationWordLinksArgs = z.infer<typeof FetchTranslationWordLinksArgs>;

/**
 * Handle the fetch translation word links tool call
 * Uses unified service layer for consistent business logic
 */
export async function handleFetchTranslationWordLinks(
  args: FetchTranslationWordLinksArgs,
) {
  try {
    logger.info("Fetching translation word links", args);

    // Create and execute unified service
    const service = createTranslationWordLinksService();
    const response = await service.execute(args as TranslationWordLinksParams, {
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
    logger.error("Failed to fetch translation word links", { error, args });
    return handleMCPError({
      toolName: "fetch_translation_word_links",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
