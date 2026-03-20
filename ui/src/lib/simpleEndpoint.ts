/**
 * Simple Endpoint Wrapper
 *
 * KISS: Direct, minimal abstraction for API endpoints
 * DRY: Reusable patterns without magic
 *
 * This is how endpoints SHOULD work - clean, simple, testable.
 * Updated: 2026-03-14 - Fixed 404 status code for missing resources
 */

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { EdgeXRayTracer } from '../../../src/functions/edge-xray.js';
import { initializeKVCache } from '../../../src/functions/kv-cache.js';
import { initializeR2Env } from '../../../src/functions/r2-env.js';
import { logger } from '../../../src/utils/logger.js';
import { formatResponse, type ResponseFormat } from './responseFormatter.js';

// 💾 In-memory variant mapping cache (prevents repeated expensive variant discovery)
// Format: "baseLanguage:organization:endpoint" -> { variant: string, timestamp: number }
const variantMappingCache = new Map<string, { variant: string; timestamp: number }>();
const VARIANT_MAPPING_TTL = 3600000; // 1 hour - variants rarely change

// Simple parameter validation
export interface ParamSchema {
	name: string;
	required?: boolean;
	type?: 'string' | 'number' | 'boolean';
	default?: any;
	validate?: (value: any) => boolean;
}

// Simple endpoint configuration
export interface SimpleEndpointConfig {
	// Basic info
	name: string;

	// Parameters
	params?: ParamSchema[];

	// Data fetcher - just a function!
	fetch: (params: Record<string, any>, request: Request) => Promise<any>;

	// Optional transform
	transform?: (data: any) => any;

	// Optional custom error handler
	onError?: (error: Error) => { status: number; message: string };

	// Format support
	supportsFormats?: boolean | ResponseFormat[]; // true = all formats, or specify allowed formats
}

/**
 * Parse parameters from request
 */
function parseParams(
	url: URL,
	schema: ParamSchema[] = []
): { params: Record<string, any>; errors: string[] } {
	const params: Record<string, any> = {};
	const errors: string[] = [];

	for (const param of schema) {
		// Special handling for organization parameter - can be array
		if (param.name === 'organization') {
			const orgValues = url.searchParams.getAll(param.name);

			// Check required
			if (param.required && orgValues.length === 0) {
				errors.push(`Missing required parameter: ${param.name}`);
				continue;
			}

			// Apply default only if no values provided
			if (orgValues.length === 0 && param.default !== undefined) {
				params[param.name] = param.default;
				continue;
			}

			// Skip if not provided and not required
			if (orgValues.length === 0) continue;

			// Parse organization: single value = string, multiple = array
			let parsed: string | string[] | undefined;
			if (orgValues.length === 0) {
				parsed = undefined; // No org specified - search all
			} else if (orgValues.length === 1) {
				// Convert empty string to undefined for multi-org fetch
				parsed = orgValues[0] === '' ? undefined : orgValues[0];
			} else {
				// Multiple organizations - filter out empty strings
				const filtered = orgValues.filter((v) => v !== '');
				parsed = filtered.length > 0 ? filtered : undefined;
			}

			// Custom validation
			if (param.validate && !param.validate(parsed)) {
				errors.push(`Parameter ${param.name} is invalid`);
				continue;
			}

			// Apply transform if available
			if (param.transform && parsed !== undefined) {
				parsed = param.transform(parsed);
			}

			params[param.name] = parsed;
			continue;
		}

		// Standard parameter handling
		const value = url.searchParams.get(param.name);

		// Check required
		if (param.required && !value) {
			errors.push(`Missing required parameter: ${param.name}`);
			continue;
		}

		// Apply default
		if (!value && param.default !== undefined) {
			params[param.name] = param.default;
			continue;
		}

		// Skip if not provided and not required
		if (!value) continue;

		// Type conversion
		let parsed: any = value;
		if (param.type === 'number') {
			parsed = Number(value);
			if (isNaN(parsed)) {
				errors.push(`Parameter ${param.name} must be a number`);
				continue;
			}
		} else if (param.type === 'boolean') {
			parsed = value === 'true' || value === '1';
		}

		// Custom validation
		if (param.validate && !param.validate(parsed)) {
			errors.push(`Parameter ${param.name} is invalid`);
			continue;
		}

		params[param.name] = parsed;
	}

	return { params, errors };
}

/**
 * Create a simple endpoint handler
 *
 * Example usage:
 * ```typescript
 * export const GET = createSimpleEndpoint({
 *   name: 'fetch-scripture',
 *   params: [
 *     { name: 'reference', required: true },
 *     { name: 'language', default: 'en' }
 *   ],
 *   fetch: async (params) => {
 *     return scriptureService.getScripture(params);
 *   }
 * });
 * ```
 */
export function createSimpleEndpoint(config: SimpleEndpointConfig): RequestHandler {
	return async ({ url, request, platform, fetch: eventFetch }) => {
		const startTime = Date.now();
		let parsedParams: Record<string, any> = {};

		// Initialize KV cache if available
		try {
			// platform typing differs by adapter
			const kv = (platform as any)?.env?.TRANSLATION_HELPS_CACHE;
			if (kv) {
				initializeKVCache(kv);
				logger.debug('KV cache initialized for endpoint', { endpoint: config.name });
			} else {
				// Log why KV wasn't initialized
				logger.debug('KV cache not available', {
					endpoint: config.name,
					hasPlatform: !!platform,
					hasPlatformEnv: !!platform?.env,
					envKeys: (platform as any)?.env ? Object.keys((platform as any).env) : []
				});
			}
		} catch (error) {
			logger.warn('Failed to initialize KV cache', { error });
		}

		// Initialize R2 environment if available
		try {
			const r2 = (platform as any)?.env?.ZIP_FILES;
			const caches: CacheStorage | undefined = (platform as any)?.caches;
			if (r2 || caches) {
				initializeR2Env(r2, caches);
				logger.debug('R2 env initialized', {
					endpoint: config.name,
					hasBucket: !!r2,
					hasCaches: !!caches
				});
			}
		} catch (error) {
			logger.warn('Failed to initialize R2 env', { error });
		}

		try {
			// 1. Parse parameters including format if supported
			let formatParam: ParamSchema | undefined;
			const params = config.params || [];

			// Add format parameter if endpoint supports formats
			if (config.supportsFormats) {
				formatParam = {
					name: 'format',
					type: 'string',
					default: 'json',
					validate: (value) => {
						const allowedFormats =
							config.supportsFormats === true
								? ['json', 'md', 'text']
								: (config.supportsFormats as ResponseFormat[]);
						return allowedFormats.includes(value);
					}
				};
			}

			const allParams = formatParam ? [...params, formatParam] : params;
			const parseResult = parseParams(url, allParams);
			parsedParams = parseResult.params;
			const errors = parseResult.errors;

			if (errors.length > 0) {
				return json(
					{
						error: 'Invalid parameters',
						details: errors,
						status: 400
					},
					{
						status: 400,
						headers: {
							'X-Response-Time': `${Date.now() - startTime}ms`,
							'X-Endpoint': config.name
						}
					}
				);
			}

		// 1.5. Check variant mapping cache (OPTIMIZATION)
		// If we've previously discovered that 'es' maps to 'es-419', use it directly
		if (parsedParams.language) {
			const variantMappingKey = `${parsedParams.language}:${parsedParams.organization || 'all'}:${config.name}`;
			const cachedMapping = variantMappingCache.get(variantMappingKey);
			
			if (cachedMapping && (Date.now() - cachedMapping.timestamp) < VARIANT_MAPPING_TTL) {
				console.log(`[VARIANT CACHE] ✅ Using cached variant mapping:`, {
					endpoint: config.name,
					requested: parsedParams.language,
					mapped: cachedMapping.variant,
					age: `${Math.round((Date.now() - cachedMapping.timestamp) / 1000)}s ago`
				});
				logger.info(`Using cached variant mapping`, {
					endpoint: config.name,
					from: parsedParams.language,
					to: cachedMapping.variant
				});
				
				// Update params to use the cached variant
				parsedParams.language = cachedMapping.variant;
			}
		}
		
		// 2. Fetch data
		logger.info(`${config.name}: Fetching data`, { params: parsedParams });
		let data = await config.fetch(parsedParams, request);

			// 3. Transform if needed
			if (config.transform) {
				data = config.transform(data);
			}

			// 4. Apply formatting if requested
			const format = (parsedParams.format as ResponseFormat) || 'json';
			let formattedData = data;
			let contentType = 'application/json';

			if (config.supportsFormats && format !== 'json') {
				formattedData = formatResponse(data, {
					format,
					includeMetadata: parsedParams.includeMetadata !== false
				});
				contentType = format === 'md' ? 'text/markdown' : 'text/plain';
			}

			// 5. Extract trace data if present
			let traceData: any = null;
			if (data && typeof data === 'object') {
				// Check for both _trace and trace fields
				if ('_trace' in data) {
					traceData = data._trace;
					delete data._trace;
				} else if ('trace' in data) {
					traceData = data.trace;
					delete data.trace;
				}

				// Clean formatted data too
				if (formattedData && typeof formattedData === 'object') {
					delete formattedData._trace;
					delete formattedData.trace;
				}
			}

			// 6. Build response headers with X-ray trace data
			const responseTime = Date.now() - startTime;
			const headers: Record<string, string> = {
				// CRITICAL: never cache endpoint responses
				'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
				Pragma: 'no-cache',
				'X-Response-Time': `${responseTime}ms`,
				'X-Endpoint': config.name,
				// CORS headers for cross-origin requests
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization'
			};

			// Add X-ray trace headers if available
			if (traceData) {
				// Calculate cache status based on internal cache calls only
				// External API calls (to DCS, etc.) shouldn't affect cache status
				const apiCalls = traceData.apiCalls || [];
				const internalCalls = apiCalls.filter((call: any) => call.url?.startsWith('internal://'));
				const externalCalls = apiCalls.filter((call: any) => !call.url?.startsWith('internal://'));

				// Calculate cache stats for internal calls only
				const internalHits = internalCalls.filter((call: any) => call.cached).length;
				const internalMisses = internalCalls.filter((call: any) => call.cached === false).length;
				const totalInternal = internalCalls.length;

				// DEBUG: Log cache calculation details
				console.log(`[CACHE DEBUG] Calculating cache status for ${config.name}:`, {
					totalApiCalls: apiCalls.length,
					internalCalls: internalCalls.length,
					externalCalls: externalCalls.length,
					internalHits,
					internalMisses,
					internalCallDetails: internalCalls.map((c: any) => ({
						url: c.url,
						cached: c.cached,
						duration: c.duration
					})),
					overallCacheStats: traceData.cacheStats
				});

				let cacheStatus = 'miss';
				if (totalInternal === 0) {
					// No internal cache calls - check overall stats
					const cacheStats = traceData.cacheStats || { hits: 0, misses: 0 };
					console.log(`[CACHE DEBUG] No internal calls, using overall stats:`, cacheStats);
					if (cacheStats.hits > 0 && cacheStats.misses === 0) {
						cacheStatus = 'hit';
					} else if (cacheStats.hits > 0 && cacheStats.misses > 0) {
						cacheStatus = 'partial';
					}
				} else if (internalHits > 0 && internalMisses === 0) {
					// All internal cache calls were hits
					cacheStatus = 'hit';
					console.log(
						`[CACHE DEBUG] ✅ All internal caches hit (${internalHits}/${totalInternal})`
					);
				} else if (internalHits > 0 && internalMisses > 0) {
					// Some internal cache hits, some misses
					cacheStatus = 'partial';
					console.log(
						`[CACHE DEBUG] ⚠️ Partial cache (${internalHits} hits, ${internalMisses} misses)`
					);
				} else if (internalHits === 0 && totalInternal > 0) {
					// All internal cache calls were misses
					cacheStatus = 'miss';
					console.log(
						`[CACHE DEBUG] ❌ All internal caches missed (${internalMisses}/${totalInternal})`
					);
				}

				console.log(`[CACHE DEBUG] Final cache status: ${cacheStatus}`);
				headers['X-Cache-Status'] = cacheStatus;

				// Add full trace as base64 encoded JSON
				const fullTrace = {
					traceId: traceData.traceId,
					mainEndpoint: traceData.mainEndpoint,
					startTime: traceData.startTime,
					totalDuration: traceData.totalDuration || responseTime,
					apiCalls: traceData.apiCalls || [],
					cacheStats: traceData.cacheStats
				};
				headers['X-XRay-Trace'] = btoa(JSON.stringify(fullTrace));
			}

			// 7. Return response with appropriate format
			if (format !== 'json' && typeof formattedData === 'string') {
				return new Response(formattedData, {
					status: 200,
					headers: {
						...headers,
						'Content-Type': `${contentType}; charset=utf-8`,
						'X-Format': format
					}
				});
			}

			return json(formattedData, {
				headers: {
					...headers,
					'X-Content-Type': contentType
				}
			});
		} catch (error) {
			const responseTime = Date.now() - startTime;
			logger.error(`${config.name}: Error`, { error });
			
			// DEBUG: Log error structure for troubleshooting
			if (error && typeof error === 'object') {
				console.log('[simpleEndpoint] Error object keys:', Object.keys(error));
				console.log('[simpleEndpoint] Has languageVariants?', 'languageVariants' in error);
				console.log('[simpleEndpoint] languageVariants value:', (error as any).languageVariants);
			}

			// 🔄 AUTOMATIC RETRY: If error has recovery data, retry internally before returning error
			const errorObj = error as any;
			if (errorObj?.languageVariants?.length > 0 && parsedParams?.language) {
				const suggestedLanguage = errorObj.languageVariants[0];
				logger.info(`[simpleEndpoint] 🔄 Auto-retry triggered: ${parsedParams.language} → ${suggestedLanguage}`);
				console.log(`[simpleEndpoint] 🔄 Retrying with language variant: ${suggestedLanguage}`);

			try {
				// Retry with modified parameters, preserving the original organization
				const retryParams = {
					...parsedParams,
					language: suggestedLanguage
					// Keep original organization - if user explicitly set it, respect their choice
				};
					const retryStartTime = Date.now();
					const retryData = await config.fetch(retryParams, request);
					const retryResponseTime = Date.now() - retryStartTime;
					
				logger.info(`[simpleEndpoint] ✅ Retry succeeded in ${retryResponseTime}ms`);
				console.log(`[simpleEndpoint] ✅ Auto-retry succeeded with ${suggestedLanguage}`);
				
				// 💾 CACHE VARIANT MAPPING: Save this mapping for future requests
				// This allows future 'es' requests to skip directly to 'es-419' without expensive discovery
				// 🔧 FIX: Normalize organization to match the check logic (use 'all' for undefined/empty)
				const normalizedOrg = retryParams.organization || 'all';
				const variantMappingKey = `${parsedParams.language}:${normalizedOrg}:${config.name}`;
				variantMappingCache.set(variantMappingKey, {
					variant: suggestedLanguage,
					timestamp: Date.now()
				});

				console.log(`[VARIANT CACHE] 💾 Saved variant mapping:`, {
					endpoint: config.name,
					from: parsedParams.language,
					to: suggestedLanguage,
					organization: normalizedOrg,
					cacheKey: variantMappingKey
				});
				
				logger.info(`Cached variant mapping for future requests`, {
					endpoint: config.name,
					from: parsedParams.language,
					to: suggestedLanguage
				});
					
					// Format and return the successful retry result
					const format = parsedParams?.format || 'json';
					const formattedData = config.formatters?.[format]
						? config.formatters[format](retryData)
						: retryData;

					// Add retry metadata to headers
					const headers: Record<string, string> = {
						'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
						Pragma: 'no-cache',
						'X-Response-Time': `${Date.now() - startTime}ms`,
						'X-Endpoint': config.name,
						'X-Retry': 'true',
						'X-Retry-Reason': 'language-variant',
						'X-Original-Language': parsedParams.language,
						'X-Retry-Language': suggestedLanguage
					};

					// Return successful retry response
					if (format === 'text') {
						return new Response(formattedData as string, {
							status: 200,
							headers: {
								...headers,
								'Content-Type': 'text/plain; charset=utf-8',
								'X-Format': format
							}
						});
					}

					return json(formattedData, { headers });
				} catch (retryError) {
					const retryErrorMsg = retryError instanceof Error ? retryError.message : JSON.stringify(retryError);
					const retryErrorObj = retryError as any;
					
					// Check if retry found useful data (availableBooks) even though it "failed"
					if (retryErrorObj?.availableBooks?.length > 0) {
						logger.info(`[simpleEndpoint] ✅ Retry found ${retryErrorObj.availableBooks.length} available books - returning useful data`);
						console.log(`[simpleEndpoint] ✅ Retry provided availableBooks, replacing original error`);
						
						// Replace the original error with the retry error (which has availableBooks)
						error = retryError;
					}
					// Check if retry error indicates "no more variants" (requestedLanguage without languageVariants)
					else if (retryErrorObj?.requestedLanguage && (!retryErrorObj?.languageVariants || retryErrorObj.languageVariants.length === 0)) {
						logger.info(`[simpleEndpoint] ℹ️ Retry exhausted all variants - no more options available`);
						console.log(`[simpleEndpoint] ℹ️ Retry confirmed no resources exist, replacing original error`);
						
						// Replace the original error with the retry error (which indicates final failure)
						error = retryError;
					} else {
						logger.error(`[simpleEndpoint] ❌ Retry failed:`, { retryError, message: retryErrorMsg });
						console.log(`[simpleEndpoint] ❌ Auto-retry failed with ${suggestedLanguage}:`, retryErrorMsg);
						console.log('[simpleEndpoint] ❌ Retry error details:', {
							hasMessage: retryError instanceof Error,
							keys: retryError && typeof retryError === 'object' ? Object.keys(retryError) : [],
							retryError
						});
						
						// Preserve verseNotFound flag from retry error if present
						// This is CRITICAL so execute-prompt knows the verse doesn't exist
						if (retryErrorObj?.verseNotFound) {
							console.log('[simpleEndpoint] ✅ Preserving verseNotFound flag from retry error');
							(error as any).verseNotFound = true;
							(error as any).requestedBook = retryErrorObj.requestedBook;
							(error as any).chapter = retryErrorObj.chapter;
							(error as any).verse = retryErrorObj.verse;
							(error as any).language = suggestedLanguage; // The language that was actually tried
							(error as any).resourcesChecked = retryErrorObj.resourcesChecked;
						}
						
						// Preserve hasContextOnly flag from retry error if present
						// This tells execute-prompt that only intro/context notes exist (no verse-specific notes)
						if (retryErrorObj?.hasContextOnly) {
							console.log('[simpleEndpoint] ✅ Preserving hasContextOnly flag from retry error');
							(error as any).hasContextOnly = true;
							(error as any).contextNotesCount = retryErrorObj.contextNotesCount;
						}
						
						// Fall through to return original error (now with verseNotFound/hasContextOnly info)
					}
				}
			}

			// Build detailed error response
			const errorDetails: any = {
				endpoint: config.name,
				path: url.pathname,
				params: parsedParams || {},
				timestamp: new Date().toISOString()
			};

			// Include debug info if present on the error
			if ((error as any)?.debug) {
				errorDetails.debug = (error as any).debug;
			}

			// Include TOC if present on the error (for 404 with discovery)
			if ((error as any)?.toc) {
				errorDetails.toc = (error as any).toc;
			}

			// Include valid book codes for invalid book code errors (helpful for AI agents)
			if ((error as any)?.validBookCodes) {
				errorDetails.validBookCodes = (error as any).validBookCodes;
				errorDetails.invalidCode = (error as any).invalidCode;
				console.log('[simpleEndpoint] ✅ Added validBookCodes to errorDetails');
			}

		// Include language variants for language not found errors (helpful for AI agents)
		if ((error as any)?.languageVariants) {
			errorDetails.languageVariants = (error as any).languageVariants;
			errorDetails.requestedLanguage = (error as any).requestedLanguage;
			console.log('[simpleEndpoint] ✅ Added languageVariants to errorDetails:', errorDetails.languageVariants);
		} else if ((error as any)?.requestedLanguage && !(error as any)?.availableBooks) {
			// Language not supported (no variants, no books available)
			errorDetails.requestedLanguage = (error as any).requestedLanguage;
			
			// Preserve all tool-specific request context (book, term, path, module)
			if ((error as any)?.requestedBook) errorDetails.requestedBook = (error as any).requestedBook;
			if ((error as any)?.requestedTerm) errorDetails.requestedTerm = (error as any).requestedTerm;
			if ((error as any)?.requestedPath) errorDetails.requestedPath = (error as any).requestedPath;
			if ((error as any)?.requestedModule) errorDetails.requestedModule = (error as any).requestedModule;
			
			console.log('[simpleEndpoint] ✅ Added requestedLanguage to errorDetails (no variants/books)');
		} else {
			console.log('[simpleEndpoint] ⚠️ No language-related error data found');
		}

		// Include available books when book not found (helpful for AI agents to suggest alternatives)
		if ((error as any)?.availableBooks) {
			errorDetails.availableBooks = (error as any).availableBooks;
			errorDetails.requestedBook = (error as any).requestedBook;
			errorDetails.language = (error as any).language;
			console.log('[simpleEndpoint] ✅ Added availableBooks to errorDetails:', errorDetails.availableBooks.length, 'books');
		}

		// Include verse details when verse not found (helpful for AI agents)
		if ((error as any)?.verseNotFound) {
			errorDetails.verseNotFound = true;
			errorDetails.requestedBook = (error as any).requestedBook;
			errorDetails.chapter = (error as any).chapter;
			errorDetails.verse = (error as any).verse;
			if ((error as any).endVerse) errorDetails.endVerse = (error as any).endVerse;
			errorDetails.language = (error as any).language;
			errorDetails.resourcesChecked = (error as any).resourcesChecked;
			console.log('[simpleEndpoint] ✅ Added verseNotFound details to errorDetails:', {
				book: errorDetails.requestedBook,
				chapter: errorDetails.chapter,
				verse: errorDetails.verse
			});
		}

		// Include context-only notes info when no verse-specific notes exist
		// NOTE: Context notes themselves are NOT included in error responses
		// They should only be returned when there ARE verse-specific notes (200 OK)
		if ((error as any)?.hasContextOnly) {
			errorDetails.hasContextOnly = true;
			errorDetails.contextNotesCount = (error as any).contextNotesCount;
			errorDetails.reference = (error as any).reference;
			errorDetails.language = (error as any).language;
			console.log('[simpleEndpoint] ✅ Added hasContextOnly details to errorDetails:', {
				reference: errorDetails.reference,
				contextNotesCount: errorDetails.contextNotesCount
			});
		}

			// Include stack trace in development
			if (import.meta.env.DEV && error instanceof Error) {
				errorDetails.stack = error.stack?.split('\n').slice(0, 5);
			}

			// Build error headers with X-ray trace
			const errorHeaders: Record<string, string> = {
				// CRITICAL: never cache endpoint responses
				'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
				Pragma: 'no-cache',
				'X-Response-Time': `${responseTime}ms`,
				'X-Endpoint': config.name,
				'X-Error': 'true',
				'X-Path': url.pathname,
				'X-Cache-Status': 'miss' // Errors are never cached
			};

			// Attach best-available X-ray trace for errors (prefer last tracer if present)
			const last = (EdgeXRayTracer as any)?.getLastTrace?.();
			const errorTrace = last || {
				traceId: `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				mainEndpoint: config.name,
				startTime: startTime,
				totalDuration: responseTime,
				apiCalls: [],
				cacheStats: { hits: 0, misses: 0, total: 0 },
				error: error instanceof Error ? error.message : 'Unknown error'
			};
			errorHeaders['X-XRay-Trace'] = btoa(JSON.stringify(errorTrace));

			// Custom error handling
			if (config.onError && error instanceof Error) {
				const { status, message } = config.onError(error);
				return json(
					{
						error: message,
						details: errorDetails,
						status
					},
					{
						status,
						headers: errorHeaders
					}
				);
			}

		// Determine error status based on error message
		let errorStatus = 500;
		let errorMessage = error instanceof Error ? error.message : 'Internal server error';

		// DEBUG: Log error structure to troubleshoot status code
		console.log('[simpleEndpoint] Determining status code:', {
			isError: error instanceof Error,
			hasAvailableBooks: !!(error as any)?.availableBooks,
			hasLanguageVariants: !!(error as any)?.languageVariants,
			hasRequestedLanguage: !!(error as any)?.requestedLanguage,
			errorMessage: error instanceof Error ? error.message : 'N/A'
		});

	// Handle specific error types (order matters - check specific cases first)
	if (error instanceof Error) {
		// Verse not found (404 Not Found) - check FIRST because it's very specific
		if ((error as any)?.verseNotFound) {
			errorStatus = 404;
			console.log('[simpleEndpoint] ✅ Setting status to 404 (verse not found)');
		}
		// Context-only notes (404 Not Found) - no verse-specific notes exist for this reference
		else if ((error as any)?.hasContextOnly) {
			errorStatus = 404;
			console.log('[simpleEndpoint] ✅ Setting status to 404 (context-only notes, no verse-specific notes)');
		}
		// Invalid reference/book code errors (400 Bad Request) - check FIRST before "not found"
		else if (
			error.message.includes('Invalid reference') ||
			error.message.includes('book code') ||
			error.message.includes('3-letter')
		) {
			errorStatus = 400;
		}
		// Timeout errors (504)
		else if (error.message.includes('timeout')) {
			errorStatus = 504;
		}
		// Unauthorized errors (401)
		else if (error.message.includes('unauthorized') || error.message.includes('401')) {
			errorStatus = 401;
		}
		// Resource not found (404) - language/book not available (with or without suggestions)
		else if ((error as any)?.availableBooks || (error as any)?.languageVariants || (error as any)?.requestedLanguage) {
			errorStatus = 404;
			console.log('[simpleEndpoint] ✅ Setting status to 404 (resource not found)');
		}
		// Not found errors (404) - check LAST since it's generic
		else if (error.message.includes('not found') || error.message.includes('not available') || error.message.includes('404')) {
			errorStatus = 404;
			console.log('[simpleEndpoint] ✅ Setting status to 404 (generic not found)');
		}
	}

			// For 500 errors, use generic message unless in development
			if (errorStatus === 500 && !import.meta.env.DEV) {
				errorMessage = 'An unexpected error occurred. Please try again later.';
			}

			// Default error
			return json(
				{
					error: errorMessage,
					details: errorDetails,
					status: errorStatus
				},
				{
					status: errorStatus,
					headers: errorHeaders
				}
			);
		}
	};
}

/**
 * Create OPTIONS handler for CORS
 */
export function createCORSHandler(): RequestHandler {
	return async ({ platform }) => {
		// Initialize KV cache if available (even for OPTIONS requests to keep singleton warm)
		try {
			const kv = (platform as any)?.env?.TRANSLATION_HELPS_CACHE;
			if (kv) {
				initializeKVCache(kv);
			}
		} catch {
			// Ignore errors for OPTIONS requests
		}

		return new Response(null, {
			status: 200,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Max-Age': '86400'
			}
		});
	};
}
