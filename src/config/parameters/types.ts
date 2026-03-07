/**
 * Unified Parameter Definition System
 * 
 * This module provides a single source of truth for all API parameters used across:
 * - MCP tools (Zod schemas)
 * - REST API endpoints (TypeScript configs)
 * - UI documentation pages (auto-generated forms)
 */

import { z } from 'zod';

/**
 * Base parameter definition that can be used to generate both Zod schemas and REST API configs
 */
export interface UnifiedParameterDef<T = any> {
  /** Parameter name */
  name: string;
  
  /** TypeScript type for REST API configs */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  
  /** Whether the parameter is required */
  required: boolean;
  
  /** Human-readable description */
  description: string;
  
  /** Default value (if any) */
  default?: T;
  
  /** Example value */
  example?: T;
  
  /** Allowed values (for enum-like parameters) */
  options?: readonly T[];
  
  /** Minimum value (for numbers) */
  min?: number;
  
  /** Maximum value (for numbers) */
  max?: number;
  
  /** Regex pattern (for strings) */
  pattern?: string;
  
  /** Transform function to apply to the value */
  transform?: (value: any) => T;
  
  /** Validation function for complex validation */
  validate?: (value: T) => boolean | string;
  
  /** Zod schema generator (optional, for complex types) */
  zodSchema?: () => z.ZodType<T>;
}

/**
 * Parameter group definition for organizing related parameters
 */
export interface ParameterGroup {
  name: string;
  description: string;
  parameters: UnifiedParameterDef[];
}

/**
 * Converts a unified parameter definition to a Zod schema
 */
export function toZodSchema(param: UnifiedParameterDef): z.ZodType {
  // If custom Zod schema provided, use it
  if (param.zodSchema) {
    return param.zodSchema();
  }

  let schema: z.ZodType;

  // Create base schema based on type
  switch (param.type) {
    case 'string':
      schema = z.string();
      if (param.options && param.options.length > 0) {
        // Create enum schema
        schema = z.enum(param.options as [string, ...string[]]);
      } else {
        if (param.pattern) {
          schema = (schema as z.ZodString).regex(new RegExp(param.pattern));
        }
      }
      break;
    
    case 'number':
      schema = z.number();
      if (param.min !== undefined) {
        schema = (schema as z.ZodNumber).min(param.min);
      }
      if (param.max !== undefined) {
        schema = (schema as z.ZodNumber).max(param.max);
      }
      break;
    
    case 'boolean':
      schema = z.boolean();
      break;
    
    case 'array':
      // Default to string array, can be customized with zodSchema
      schema = z.array(z.string());
      break;
    
    case 'object':
      // Default to any object, should be customized with zodSchema
      schema = z.record(z.any());
      break;
    
    default:
      schema = z.any();
  }

  // Apply transform if provided
  if (param.transform) {
    schema = schema.transform(param.transform);
  }

  // Apply custom validation if provided
  if (param.validate) {
    schema = schema.refine(param.validate, {
      message: `Invalid value for ${param.name}`
    });
  }

  // Add description
  schema = schema.describe(param.description);

  // Handle optional vs required
  if (!param.required) {
    schema = schema.optional();
    if (param.default !== undefined) {
      schema = schema.default(param.default);
    }
  }

  return schema;
}

/**
 * Converts a unified parameter definition to REST API endpoint config format
 */
export function toEndpointConfig(param: UnifiedParameterDef) {
  return {
    type: param.type,
    required: param.required,
    description: param.description,
    ...(param.default !== undefined && { default: param.default }),
    ...(param.example !== undefined && { example: param.example }),
    ...(param.options && param.options.length > 0 && { options: param.options }),
    ...(param.min !== undefined && { min: param.min }),
    ...(param.max !== undefined && { max: param.max }),
    ...(param.pattern && { pattern: param.pattern }),
    ...(param.transform && { transform: param.transform }),
  };
}

/**
 * Helper to create a parameter group from multiple definitions
 */
export function createParameterGroup(
  name: string,
  description: string,
  parameters: UnifiedParameterDef[]
): ParameterGroup {
  return { name, description, parameters };
}

/**
 * Helper to merge multiple parameter groups
 */
export function mergeParameterGroups(...groups: ParameterGroup[]): ParameterGroup {
  return {
    name: groups.map(g => g.name).join(' + '),
    description: groups.map(g => g.description).join('; '),
    parameters: groups.flatMap(g => g.parameters)
  };
}

/**
 * Converts an array of parameter definitions to a Zod object schema
 */
export function toZodObject(params: UnifiedParameterDef[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodType> = {};
  
  for (const param of params) {
    shape[param.name] = toZodSchema(param);
  }
  
  return z.object(shape);
}

/**
 * Converts an array of parameter definitions to REST endpoint config
 */
export function toEndpointParams(params: UnifiedParameterDef[]): Record<string, any> {
  const config: Record<string, any> = {};
  
  for (const param of params) {
    config[param.name] = toEndpointConfig(param);
  }
  
  return config;
}
