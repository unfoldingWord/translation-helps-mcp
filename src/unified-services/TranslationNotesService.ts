/**
 * Unified Translation Notes Service
 * 
 * Wraps the core translation-notes-service for use by both MCP and REST endpoints
 */

import { BaseService } from './BaseService.js';
import { PARAMETER_GROUPS } from '../config/parameters/index.js';
import type { ServiceResponse, ServiceContext } from './types.js';
import { 
  fetchTranslationNotes, 
  type TranslationNotesOptions, 
  type TranslationNotesResult 
} from '../functions/translation-notes-service.js';
import { formatResponse } from '../utils/response-formatter.js';

/**
 * Translation notes service parameters
 */
export interface TranslationNotesParams {
  reference: string;
  language?: string;
  organization?: string | string[];
  format?: 'json' | 'text' | 'markdown' | 'md';
  includeContext?: boolean;
  includeIntro?: boolean;
  topic?: string;
}

/**
 * Unified Translation Notes Service
 */
export class TranslationNotesService extends BaseService<TranslationNotesParams, TranslationNotesResult> {
  name = 'fetchTranslationNotes';
  description = 'Fetch translation notes for a specific Bible reference';
  parameters = PARAMETER_GROUPS.translationNotes.parameters;

  async execute(
    params: TranslationNotesParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<TranslationNotesResult>> {
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
      const options: TranslationNotesOptions = {
        reference: params.reference,
        language: params.language || 'en',
        organization: params.organization,
        includeContext: params.includeContext ?? true,
        includeIntro: params.includeIntro ?? true,
        topic: params.topic || 'tc-ready',
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchTranslationNotes(options),
        'fetchTranslationNotes'
      );

      // Format response based on requested format
      const formattedData = this.formatResponse(result, params.format);

      return this.success(
        formattedData,
        {
          count: (result.verseNotes?.length || 0) + (result.contextNotes?.length || 0),
          verseNotesCount: result.verseNotes?.length || 0,
          contextNotesCount: result.contextNotes?.length || 0,
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

  private formatResponse(result: TranslationNotesResult, format?: string): any {
    if (!format || format === 'json') {
      return result;
    }
    return formatResponse(result, format as any);
  }
}

export function createTranslationNotesService(context?: ServiceContext): TranslationNotesService {
  return new TranslationNotesService();
}
