/**
 * Unified Service Layer Types
 * 
 * Common types and interfaces for the unified service layer
 */

import type { UnifiedParameterDef } from '../config/parameters/index.js';

/**
 * Standard service response format
 */
export interface ServiceResponse<T = any> {
  /** The actual data payload */
  data: T;
  
  /** Additional metadata about the response */
  metadata?: {
    /** Total count of items */
    count?: number;
    
    /** Resources used */
    resources?: string[];
    
    /** Organizations involved */
    organizations?: string[];
    
    /** Cache information */
    cached?: boolean;
    cacheKey?: string;
    
    /** Timing information */
    elapsed?: number;
    
    /** Any warnings */
    warnings?: string[];
  };
  
  /** Format of the response */
  format?: 'json' | 'text' | 'markdown' | 'md' | 'usfm';
}

/**
 * Standard service error format
 */
export interface ServiceError {
  /** Error code */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** Additional error details */
  details?: any;
  
  /** HTTP status code suggestion */
  status?: number;
  
  /** Stack trace (only in development) */
  stack?: string;
}

/**
 * Service execution context
 */
export interface ServiceContext {
  /** Request ID for tracing */
  requestId?: string;
  
  /** Platform (mcp, rest, cli, etc.) */
  platform?: string;
  
  /** User agent or client info */
  userAgent?: string;
  
  /** Environment (production, development, test) */
  environment?: string;
  
  /** Whether to use caching */
  useCache?: boolean;
  
  /** Cache TTL override */
  cacheTTL?: number;
}

/**
 * Base unified service interface
 */
export interface UnifiedService<TParams = any, TResult = any> {
  /** Service name */
  name: string;
  
  /** Service description */
  description: string;
  
  /** Parameter definitions */
  parameters: UnifiedParameterDef[];
  
  /**
   * Execute the service with validated parameters
   */
  execute(params: TParams, context?: ServiceContext): Promise<ServiceResponse<TResult>>;
  
  /**
   * Validate parameters (optional, uses parameter definitions by default)
   */
  validate?(params: any): params is TParams;
}

/**
 * Service factory function type
 */
export type ServiceFactory<TParams = any, TResult = any> = (
  context?: ServiceContext
) => UnifiedService<TParams, TResult>;
