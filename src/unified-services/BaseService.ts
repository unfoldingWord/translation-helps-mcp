/**
 * Base Service Class
 * 
 * Provides common functionality for all unified services
 */

import type { UnifiedParameterDef } from '../config/parameters/index.js';
import type {
  UnifiedService,
  ServiceResponse,
  ServiceError,
  ServiceContext,
} from './types.js';

/**
 * Base class for unified services
 */
export abstract class BaseService<TParams = any, TResult = any>
  implements UnifiedService<TParams, TResult>
{
  abstract name: string;
  abstract description: string;
  abstract parameters: UnifiedParameterDef[];

  /**
   * Execute the service - must be implemented by subclasses
   */
  abstract execute(
    params: TParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<TResult>>;

  /**
   * Create a standardized success response
   */
  protected success(
    data: TResult,
    metadata?: ServiceResponse['metadata'],
    format?: ServiceResponse['format']
  ): ServiceResponse<TResult> {
    return {
      data,
      ...(metadata && { metadata }),
      ...(format && { format }),
    };
  }

  /**
   * Create a standardized error
   */
  protected error(
    code: string,
    message: string,
    details?: any,
    status?: number
  ): ServiceError {
    const error: ServiceError = {
      code,
      message,
      ...(details && { details }),
      ...(status && { status }),
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development') {
      error.stack = new Error().stack;
    }

    return error;
  }

  /**
   * Handle errors consistently
   */
  protected handleError(error: any, context?: ServiceContext): ServiceError {
    // If it's already a ServiceError, return it
    if (this.isServiceError(error)) {
      return error;
    }

    // Handle common error types
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      return this.error('NOT_FOUND', error.message || 'Resource not found', error, 404);
    }

    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      return this.error(
        'UNAUTHORIZED',
        error.message || 'Unauthorized access',
        error,
        401
      );
    }

    if (error.message?.includes('timeout')) {
      return this.error(
        'TIMEOUT',
        error.message || 'Request timeout',
        error,
        504
      );
    }

    // Handle invalid reference/book code errors (400 Bad Request)
    if (
      error.message?.includes('Invalid reference') ||
      error.message?.includes('book code') ||
      error.message?.includes('3-letter')
    ) {
      return this.error(
        'INVALID_REFERENCE',
        error.message || 'Invalid reference format',
        error,
        400
      );
    }

    // Generic error
    return this.error(
      'INTERNAL_ERROR',
      error.message || 'An unexpected error occurred',
      error,
      500
    );
  }

  /**
   * Check if an object is a ServiceError
   */
  private isServiceError(obj: any): obj is ServiceError {
    return obj && typeof obj.code === 'string' && typeof obj.message === 'string';
  }

  /**
   * Measure execution time
   */
  protected async withTiming<T>(
    fn: () => Promise<T>,
    label?: string
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await fn();
    const elapsed = Math.round(performance.now() - start);

    if (label && process.env.NODE_ENV === 'development') {
      console.log(`[${this.name}] ${label}: ${elapsed}ms`);
    }

    return { result, elapsed };
  }

  /**
   * Validate parameters using parameter definitions
   */
  protected validateParams(params: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of this.parameters) {
      const value = params[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push(`Missing required parameter: ${param.name}`);
        continue;
      }

      // Skip validation if optional and not provided
      if (!param.required && (value === undefined || value === null)) {
        continue;
      }

      // Type validation
      if (value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (param.type !== actualType && param.type !== 'object') {
          errors.push(
            `Invalid type for ${param.name}: expected ${param.type}, got ${actualType}`
          );
        }
      }

      // Custom validation
      if (param.validate && value !== undefined && value !== null) {
        const validationResult = param.validate(value);
        if (validationResult !== true) {
          errors.push(
            typeof validationResult === 'string'
              ? validationResult
              : `Validation failed for ${param.name}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
