/**
 * Fetch Translation Questions Tool
 * Tool for fetching translation questions for a specific Bible reference
 * Uses unified service layer for consistency across MCP and REST endpoints
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { createTranslationQuestionsService, type TranslationQuestionsParams } from "../unified-services/index.js";
import { toZodObject, PARAMETER_GROUPS } from "../config/parameters/index.js";

// Input schema - generated from unified parameter definitions
export const FetchTranslationQuestionsArgs = toZodObject(PARAMETER_GROUPS.translationQuestions.parameters);

export type FetchTranslationQuestionsArgs = z.infer<typeof FetchTranslationQuestionsArgs>;

/**
 * Handle the fetch translation questions tool call
 * Uses unified service layer for consistent business logic
 */
export async function handleFetchTranslationQuestions(
  args: FetchTranslationQuestionsArgs,
) {
  try {
    logger.info("Fetching translation questions", args);

    // Create and execute unified service
    const service = createTranslationQuestionsService();
    const response = await service.execute(args as TranslationQuestionsParams, {
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
    logger.error("Failed to fetch translation questions", { error, args });
    return handleMCPError({
      toolName: "fetch_translation_questions",
      args,
      startTime: Date.now(),
      originalError: error,
    });
  }
}
