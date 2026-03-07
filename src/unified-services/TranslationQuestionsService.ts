/**
 * Unified Translation Questions Service
 * 
 * Wraps the core translation-questions-service for use by both MCP and REST endpoints
 */

import { BaseService } from './BaseService.js';
import { PARAMETER_GROUPS } from '../config/parameters/index.js';
import type { ServiceResponse, ServiceContext } from './types.js';
import { 
  fetchTranslationQuestions, 
  type TranslationQuestionsOptions, 
  type TranslationQuestionsResult 
} from '../functions/translation-questions-service.js';
import { formatResponse } from '../utils/response-formatter.js';

/**
 * Translation questions service parameters
 */
export interface TranslationQuestionsParams {
  reference: string;
  language?: string;
  organization?: string | string[];
  format?: 'json' | 'text' | 'markdown' | 'md';
  topic?: string;
}

/**
 * Unified Translation Questions Service
 */
export class TranslationQuestionsService extends BaseService<TranslationQuestionsParams, TranslationQuestionsResult> {
  name = 'fetchTranslationQuestions';
  description = 'Fetch translation questions for a specific Bible reference';
  parameters = PARAMETER_GROUPS.translationQuestions.parameters;

  async execute(
    params: TranslationQuestionsParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<TranslationQuestionsResult>> {
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
      const options: TranslationQuestionsOptions = {
        reference: params.reference,
        language: params.language || 'en',
        organization: params.organization,
        topic: params.topic || 'tc-ready',
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchTranslationQuestions(options),
        'fetchTranslationQuestions'
      );

      // Format response based on requested format
      const formattedData = this.formatResponse(result, params.format);

      return this.success(
        formattedData,
        {
          count: result.translationQuestions?.length || 0,
          resources: result.citations?.map(c => c.resource).filter(Boolean) || [],
          organizations: result.citations?.map(c => c.organization).filter(Boolean) || [],
          elapsed,
        },
        params.format
      );
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }

  private formatResponse(result: TranslationQuestionsResult, format?: string): any {
    if (!format || format === 'json') {
      return result;
    }
    return formatResponse(result, format as any);
  }
}

export function createTranslationQuestionsService(context?: ServiceContext): TranslationQuestionsService {
  return new TranslationQuestionsService();
}
