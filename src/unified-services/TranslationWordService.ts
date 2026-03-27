/**
 * Unified Translation Word Service
 *
 * Wraps the core translation-word-service for use by both MCP and REST endpoints
 */

import { BaseService } from "./BaseService.js";
import { PARAMETER_GROUPS } from "../config/parameters/index.js";
import type { ServiceResponse, ServiceContext } from "./types.js";
import { fetchTranslationWordArticle } from "../functions/translation-word-service.js";

/**
 * Translation word service parameters
 */
export interface TranslationWordParams {
  term?: string;
  reference?: string;
  language?: string;
  category?: string;
  path?: string;
  rcLink?: string;
  topic?: string;
}

/**
 * Unified Translation Word Service
 */
export class TranslationWordService extends BaseService<
  TranslationWordParams,
  any
> {
  name = "getTranslationWord";
  description = "Fetch translation word articles for biblical terms";
  parameters = PARAMETER_GROUPS.translationWord.parameters;

  async execute(
    params: TranslationWordParams,
    context?: ServiceContext,
  ): Promise<ServiceResponse<any>> {
    try {
      // Validate parameters
      const validation = this.validateParams(params);
      if (!validation.valid) {
        throw this.error(
          "VALIDATION_ERROR",
          "Invalid parameters",
          validation.errors,
          400,
        );
      }

      // Validate that at least one identifier is provided
      if (!params.term && !params.path && !params.rcLink) {
        throw this.error(
          "VALIDATION_ERROR",
          "Either term, path, or rcLink parameter is required",
          { provided: params },
          400,
        );
      }

      // Transform params to match core service interface
      const options = {
        term: params.term,
        path: params.path,
        rcLink: params.rcLink,
        language: params.language || "en",
        organization: undefined,
        category: params.category,
        topic: params.topic || "tc-ready",
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchTranslationWordArticle(options, context?.tracer),
        "fetchTranslationWordArticle",
      );

      // Return result (formatting handled by response-formatter if needed)
      return this.success(result, {
        elapsed,
      });
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }
}

export function createTranslationWordService(
  _context?: ServiceContext,
): TranslationWordService {
  return new TranslationWordService();
}
