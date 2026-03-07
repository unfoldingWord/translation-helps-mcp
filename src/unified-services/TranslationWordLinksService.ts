/**
 * Unified Translation Word Links Service
 * 
 * Wraps the core translation-word-links-service for use by both MCP and REST endpoints
 */

import { BaseService } from './BaseService.js';
import { PARAMETER_GROUPS } from '../config/parameters/index.js';
import type { ServiceResponse, ServiceContext } from './types.js';
import { fetchTranslationWordLinks } from '../functions/word-links-service.js';
import { formatResponse } from '../utils/response-formatter.js';

/**
 * Translation word links service parameters
 */
export interface TranslationWordLinksParams {
  reference: string;
  language?: string;
  organization?: string | string[];
  format?: 'json' | 'text' | 'markdown' | 'md';
  topic?: string;
}

/**
 * Unified Translation Word Links Service
 */
export class TranslationWordLinksService extends BaseService<TranslationWordLinksParams, any> {
  name = 'fetchTranslationWordLinks';
  description = 'Fetch translation word links for a specific Bible reference';
  parameters = PARAMETER_GROUPS.translationWordLinks.parameters;

  async execute(
    params: TranslationWordLinksParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<any>> {
    try {
      // Validate parameters
      const validation = this.validateParams(params);
      if (!validation.valid) {
        throw this.error(
          'VALIDATION_ERROR',
          'Invalid parameters',
          validation.errors,
          400
        );
      }

      // Transform params to match core service interface
      const options = {
        reference: params.reference,
        language: params.language || 'en',
        organization: params.organization,
        topic: params.topic || 'tc-ready',
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchTranslationWordLinks(options),
        'fetchTranslationWordLinks'
      );

      // Check for errors in result
      if (result.error) {
        throw this.error(
          'TRANSLATION_WORD_LINKS_ERROR',
          result.error,
          result,
          404
        );
      }

      // Format response based on requested format
      const formattedData = this.formatResponse(result, params.format);

      return this.success(
        formattedData,
        {
          count: result.links?.length || 0,
          elapsed,
        },
        params.format
      );
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }

  private formatResponse(result: any, format?: string): any {
    if (!format || format === 'json') {
      return result;
    }
    return formatResponse(result, format as any);
  }
}

export function createTranslationWordLinksService(context?: ServiceContext): TranslationWordLinksService {
  return new TranslationWordLinksService();
}
