/**
 * Unified Translation Word Service
 * 
 * Wraps the core translation-words-service for use by both MCP and REST endpoints
 */

import { BaseService } from './BaseService.js';
import { PARAMETER_GROUPS } from '../config/parameters/index.js';
import type { ServiceResponse, ServiceContext } from './types.js';
import { getTranslationWord } from '../functions/translation-words-service.js';
import { formatResponse } from '../utils/response-formatter.js';

/**
 * Translation word service parameters
 */
export interface TranslationWordParams {
  term?: string;
  reference?: string;
  language?: string;
  organization?: string | string[];
  category?: string;
  path?: string;
  rcLink?: string;
  topic?: string;
}

/**
 * Unified Translation Word Service
 */
export class TranslationWordService extends BaseService<TranslationWordParams, any> {
  name = 'getTranslationWord';
  description = 'Fetch translation word articles for biblical terms';
  parameters = PARAMETER_GROUPS.translationWord.parameters;

  async execute(
    params: TranslationWordParams,
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
        term: params.term,
        reference: params.reference,
        language: params.language || 'en',
        organization: params.organization,
        category: params.category,
        path: params.path,
        rcLink: params.rcLink,
        topic: params.topic || 'tc-ready',
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => getTranslationWord(options),
        'getTranslationWord'
      );

      // Check for errors in result
      if (result.error) {
        throw this.error(
          'TRANSLATION_WORD_ERROR',
          result.error,
          result,
          404
        );
      }

      // Return result (formatting handled by response-formatter if needed)
      return this.success(
        result,
        {
          elapsed,
        }
      );
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }
}

export function createTranslationWordService(context?: ServiceContext): TranslationWordService {
  return new TranslationWordService();
}
