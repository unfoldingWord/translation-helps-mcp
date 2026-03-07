/**
 * Get Translation Word Tool
 * Tool for fetching translation words by term name, path, rcLink, or Bible reference
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { createTranslationWordService, type TranslationWordParams } from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const GetTranslationWordArgs = toZodObject(PARAMETER_GROUPS.translationWord.parameters);

export type GetTranslationWordArgs = z.infer<typeof GetTranslationWordArgs>;

/**
 * Handle the get translation word tool call
 * Supports both term-based lookup (term, path, rcLink) and reference-based lookup
 * Uses unified service layer for consistent business logic
 */
export async function handleGetTranslationWord(args: GetTranslationWordArgs) {
  try {
    logger.info("Fetching translation word", args);

    // Create and execute unified service
    const service = createTranslationWordService();
    const response = await service.execute(args as TranslationWordParams, {
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
    logger.error("Failed to fetch translation word", { error, args });
    return handleMCPError({
      toolName: "get_translation_word",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
