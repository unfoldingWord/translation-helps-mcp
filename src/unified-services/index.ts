/**
 * Unified Service Layer - Main Export
 * 
 * Single source of truth for all business logic used by both MCP and REST endpoints
 */

export * from './types.js';
export * from './BaseService.js';
export * from './ScriptureService.js';
export * from './TranslationNotesService.js';
export * from './TranslationQuestionsService.js';

// Re-export parameter system for convenience
export * from '../config/parameters/index.js';
