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
import { findLanguageVariants } from '../functions/resource-detector.js';
import { logger } from '../utils/logger.js';

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

      // Handle both single scripture and array formats from core service
      const scriptureArray = result.scriptures || (result.scripture ? [result.scripture] : []);
      const count = scriptureArray.length;
      const resources = scriptureArray.map((s: any) => s.translation).filter(Boolean);
      const organizations = scriptureArray.map((s: any) => s.citation?.organization).filter(Boolean);

      return this.success(
        formattedData,
        {
          count,
          resources,
          organizations,
          elapsed,
          ...(context?.useCache !== false && { cached: result.cached }),
        },
        params.format
      );
    } catch (error: any) {
      // If it's a "No scripture resources found" error, try to find language variants
      if (error.message?.includes('No scripture resources found') && params.language) {
        try {
          const baseLanguage = params.language.split('-')[0]; // Get base code (e.g., "es" from "es-419")
          
          // Handle organization parameter (could be string, array, or undefined)
          const orgParam = Array.isArray(params.organization) 
            ? params.organization[0] 
            : params.organization;
          
          logger.info(`Searching for language variants after resource not found`, {
            requestedLanguage: params.language,
            baseLanguage,
            organization: orgParam || 'all'
          });
          
          const variants = await findLanguageVariants(baseLanguage, orgParam, params.topic);
          
          if (variants.length > 0) {
            logger.info(`Found language variants`, { baseLanguage, variants });
            
            // Enhance error with available variants
            const enhancedMessage = `No scripture resources found for language="${params.language}".\n\nAvailable language variants for '${baseLanguage}': ${variants.join(', ')}\n\nPlease try one of these language codes instead.`;
            
            throw this.error(
              'LANGUAGE_NOT_FOUND',
              enhancedMessage,
              { 
                requestedLanguage: params.language,
                baseLanguage,
                availableVariants: variants,
                suggestion: `Try using language="${variants[0]}" instead`
              },
              404
            );
          } else {
            logger.warn(`No language variants found for base language`, { baseLanguage });
          }
        } catch (variantError) {
          // If variant discovery fails, log but don't hide the original error
          logger.error(`Failed to discover language variants`, { error: variantError });
        }
      }
      
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
