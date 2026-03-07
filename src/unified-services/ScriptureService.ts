/**
 * Unified Scripture Service
 * 
 * Wraps the core scripture-service for use by both MCP and REST endpoints
 */

import { BaseService } from './BaseService.js';
import { PARAMETER_GROUPS } from '../config/parameters/index.js';
import type { ServiceResponse, ServiceContext } from './types.js';
import { fetchScripture, type ScriptureOptions, type ScriptureResult } from '../functions/scripture-service.js';
import { formatResponse } from '../utils/response-formatter.js';

/**
 * Scripture service parameters (matches ScriptureOptions from core service)
 */
export interface ScriptureParams {
  reference: string;
  language?: string;
  organization?: string | string[];
  resource?: string;
  format?: 'json' | 'text' | 'markdown' | 'md' | 'usfm';
  includeAlignment?: boolean;
  includeVerseNumbers?: boolean;
  topic?: string;
}

/**
 * Unified Scripture Service
 * 
 * Provides scripture fetching with consistent parameter handling,
 * error handling, and response formatting
 */
export class ScriptureService extends BaseService<ScriptureParams, ScriptureResult> {
  name = 'fetchScripture';
  description = 'Fetch Bible scripture text';
  parameters = PARAMETER_GROUPS.scripture.parameters;

  /**
   * Execute scripture fetching with unified error handling and response formatting
   */
  async execute(
    params: ScriptureParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<ScriptureResult>> {
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
      const options: ScriptureOptions = {
        reference: params.reference,
        language: params.language || 'en',
        organization: params.organization,
        includeVerseNumbers: params.includeVerseNumbers ?? true,
        format: this.mapFormatToCore(params.format),
        includeAlignment: params.includeAlignment || false,
        topic: params.topic || 'tc-ready',
        // Map resource parameter if provided
        ...(params.resource && params.resource !== 'all' && {
          specificTranslations: params.resource.split(',').map(r => r.trim())
        }),
      };

      // Execute with timing
      const { result, elapsed } = await this.withTiming(
        () => fetchScripture(options),
        'fetchScripture'
      );

      // Check for errors in result
      if (result.error) {
        throw this.error(
          'SCRIPTURE_ERROR',
          result.error,
          result,
          404
        );
      }

      // Format response based on requested format
      const formattedData = this.formatScriptureResponse(result, params.format);

      return this.success(
        formattedData,
        {
          count: result.scripture?.length || 0,
          resources: result.scripture?.map(s => s.translation) || [],
          organizations: result.scripture?.map(s => s.citation.organization) || [],
          elapsed,
          ...(context?.useCache !== false && { cached: result.cached }),
        },
        params.format
      );
    } catch (error: any) {
      throw this.handleError(error, context);
    }
  }

  /**
   * Map unified format to core service format
   */
  private mapFormatToCore(format?: string): 'text' | 'usfm' {
    if (format === 'usfm') return 'usfm';
    return 'text'; // Core service handles text, we'll format to JSON/MD later
  }

  /**
   * Format scripture response based on requested format
   */
  private formatScriptureResponse(result: ScriptureResult, format?: string): any {
    // For JSON format (default), return as-is
    if (!format || format === 'json') {
      return result;
    }

    // For other formats, use the response formatter utility
    // This will be implemented to provide consistent formatting
    return formatResponse(result, format as any);
  }
}

/**
 * Factory function to create scripture service
 */
export function createScriptureService(context?: ServiceContext): ScriptureService {
  return new ScriptureService();
}
