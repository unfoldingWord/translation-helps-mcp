/**
 * Unified Translation Academy Service
 *
 * Wraps the core translation-academy-service for use by both MCP and REST endpoints
 */

import { BaseService } from "./BaseService.js";
import { PARAMETER_GROUPS } from "../config/parameters/index.js";
import type { ServiceResponse, ServiceContext } from "./types.js";
import { fetchTranslationAcademy } from "../functions/translation-academy-service.js";
import { formatResponse } from "../utils/response-formatter.js";

/**
 * Translation academy service parameters
 */
export interface TranslationAcademyParams {
  moduleId?: string;
  language?: string;
  format?: "json" | "text" | "markdown" | "md";
  path?: string;
  rcLink?: string;
  topic?: string;
}

/**
 * Unified Translation Academy Service
 */
export class TranslationAcademyService extends BaseService<
  TranslationAcademyParams,
  any
> {
  name = "fetchTranslationAcademy";
  description = "Fetch translation academy modules and training content";
  parameters = PARAMETER_GROUPS.translationAcademy.parameters;

  async execute(
    params: TranslationAcademyParams,
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

      // Transform params to match core service interface
      const options = {
        moduleId: params.moduleId,
        language: params.language || "en",
        organization: undefined,
        format: params.format,
        path: params.path,
        rcLink: params.rcLink,
        topic: params.topic || "tc-ready",
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchTranslationAcademy(options),
        "fetchTranslationAcademy",
      );

      // Check for errors in result
      if (result.error) {
        throw this.error(
          "TRANSLATION_ACADEMY_ERROR",
          result.error,
          result,
          404,
        );
      }

      // Format response based on requested format
      const formattedData = this.formatResponse(result, params.format);

      return this.success(
        formattedData,
        {
          elapsed,
        },
        params.format,
      );
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }

  private formatResponse(result: any, format?: string): any {
    if (!format || format === "json") {
      return result;
    }
    return formatResponse(result, format as any);
  }
}

export function createTranslationAcademyService(
  _context?: ServiceContext,
): TranslationAcademyService {
  return new TranslationAcademyService();
}
