/**
 * Unified MCP Handler
 * Single source of truth for all MCP tool calls
 */

import { ToolRegistry, type MCPToolResponse } from '../../../../src/contracts/ToolContracts';

/** True for values an LLM may send for "no value": undefined, null, or empty/blank string. */
function isBlank(v: unknown): boolean {
	return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Return the first non-blank value, or undefined if all are blank. */
function firstNonBlank(...vals: unknown[]): unknown {
	for (const v of vals) {
		if (!isBlank(v)) return v;
	}
	return undefined;
}

/**
 * Assemble a single `reference` string from decomposed book/chapter/verse args
 * (issue #24 Class C). The model sometimes sends {book,chapter,verse} instead of
 * one reference; the endpoints only accept a reference string.
 */
function assembleReference(a: Record<string, any>): string {
	const book = String(a.book).trim();
	const chapter = firstNonBlank(a.chapter, a.startChapter, a.start_chapter);
	const verse = firstNonBlank(a.verse, a.startVerse, a.start_verse);
	const endVerse = firstNonBlank(a.endVerse, a.end_verse);
	const endChapter = firstNonBlank(a.endChapter, a.end_chapter);

	let ref = book;
	if (!isBlank(chapter)) {
		ref += ` ${String(chapter).trim()}`;
		if (!isBlank(verse)) {
			ref += `:${String(verse).trim()}`;
			if (!isBlank(endVerse)) ref += `-${String(endVerse).trim()}`;
		} else if (!isBlank(endChapter)) {
			// Whole-chapter range, e.g. {book:"Titus",chapter:1,endChapter:2} → "Titus 1-2"
			ref += `-${String(endChapter).trim()}`;
		}
	}
	return ref;
}

/** Build a readable message from JSON error bodies (e.g. simpleEndpoint 400 responses). */
function formatEndpointFailureMessage(status: number, body: unknown): string {
	const base = `Tool endpoint failed: ${status}`;
	if (!body || typeof body !== 'object') return base;
	const o = body as Record<string, unknown>;
	const parts: string[] = [];
	if (typeof o.error === 'string') parts.push(o.error);
	if (Array.isArray(o.details)) {
		parts.push(...o.details.map(String));
	} else if (typeof o.details === 'string') {
		parts.push(o.details);
	}
	if (typeof o.message === 'string' && !parts.includes(o.message)) {
		parts.push(o.message);
	}
	if (parts.length === 0) return base;
	return `${base}: ${parts.join('; ')}`;
}

export class UnifiedMCPHandler {
	private baseUrl: string;
	private fetchFn: typeof fetch;
	private omitOrganization: boolean;

	constructor(
		baseUrl: string = '',
		fetchFn?: typeof fetch,
		options?: { omitOrganization?: boolean }
	) {
		// Default to empty (relative) base; caller may pass absolute when needed
		this.baseUrl = baseUrl;
		// Use provided fetch function (for SvelteKit event.fetch) or fallback to global fetch
		this.fetchFn = fetchFn || fetch;
		this.omitOrganization = options?.omitOrganization ?? false;
	}

	/**
	 * Normalize LLM-generated tool arguments into the shape the endpoints expect.
	 *
	 * Issue #24: ~90% of production tool-call errors are strict validation
	 * rejecting recoverable input. The worker forwards model arguments verbatim,
	 * so this dispatch chokepoint is the single place to be liberal in what we
	 * accept (Postel's law). Every transform is additive and only fires when the
	 * canonical field is absent, so well-formed calls pass through untouched.
	 *
	 * - Class H: args arriving as null / an array / a non-object → {}
	 * - Class D: language_code / languageCode / lang → language
	 * - Class C: decomposed book + chapter + verse → a single `reference`
	 * - Class B: term / word / moduleId / topic → `path` (for path-required tools)
	 */
	private normalizeArgs(
		toolName: string,
		requiredParams: string[],
		rawArgs: any
	): Record<string, any> {
		// Class H — coerce any non-plain-object container to an empty object.
		const args: Record<string, any> =
			rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};

		// Class D — language synonyms → language.
		if (isBlank(args.language)) {
			const langAlias = firstNonBlank(args.language_code, args.languageCode, args.lang);
			if (langAlias !== undefined) {
				args.language = langAlias;
				console.log(`[UNIFIED HANDLER] Aliased language for ${toolName}:`, langAlias);
			}
		}
		delete args.language_code;
		delete args.languageCode;
		delete args.lang;

		// Class C — decomposed book/chapter/verse → reference (only for ref tools).
		if (requiredParams.includes('reference') && isBlank(args.reference) && !isBlank(args.book)) {
			args.reference = assembleReference(args);
			console.log(
				`[UNIFIED HANDLER] Assembled reference for ${toolName} from decomposed args:`,
				args.reference
			);
		}
		if (!isBlank(args.reference)) {
			// Strip decomposed leftovers so they don't leak into the query string.
			for (const k of [
				'book',
				'chapter',
				'verse',
				'startChapter',
				'start_chapter',
				'startVerse',
				'start_verse',
				'endVerse',
				'end_verse',
				'endChapter',
				'end_chapter'
			]) {
				delete args[k];
			}
		}

		// Class B — term/word synonyms → bare `path` (path-required tools only).
		// The endpoints resolve a bare term across all categories, so the synonym
		// value is passed through verbatim as the path.
		if (requiredParams.includes('path')) {
			if (isBlank(args.path)) {
				// Synonyms observed in prod/staging logs the model sends instead of
				// `path`: term / word / name / article / moduleId / identifier
				// (issue #24). `topic` is last — it's a legitimate filter on these
				// tools, so only fall back to it when nothing clearer is present.
				for (const k of [
					'term',
					'word',
					'name',
					'article',
					'moduleId',
					'module',
					'identifier',
					'topic'
				]) {
					if (!isBlank(args[k])) {
						args.path = String(args[k]).trim();
						if (k === 'topic') delete args.topic; // consumed the filter as the path
						console.log(`[UNIFIED HANDLER] Aliased path for ${toolName} from ${k}:`, args.path);
						break;
					}
				}
			}
			// `term` is a deprecated endpoint param (rejected downstream); the other
			// synonyms aren't endpoint params either — drop any we didn't consume.
			for (const k of ['term', 'word', 'name', 'article', 'moduleId', 'module', 'identifier'])
				delete args[k];
		}

		return args;
	}

	/**
	 * Handle any MCP tool call consistently
	 */
	async handleToolCall(toolName: string, rawArgs: any): Promise<MCPToolResponse> {
		const tool = ToolRegistry[toolName as keyof typeof ToolRegistry];

		if (!tool) {
			throw new Error(`Unknown tool: ${toolName}`);
		}

		// Log received parameters (before normalization / defaults)
		console.log(
			`[UNIFIED HANDLER] Received parameters for ${toolName}:`,
			JSON.stringify(rawArgs, null, 2)
		);

		// Normalize LLM-generated arguments (issue #24 tolerance) before validation.
		const args = this.normalizeArgs(toolName, tool.requiredParams, rawArgs);

		// Validate required parameters
		for (const param of tool.requiredParams) {
			if (isBlank(args[param])) {
				throw new Error(`Missing required parameter: ${param}`);
			}
		}

		// Build query parameters with defaults
		const params = new URLSearchParams();

		// Apply defaults based on common parameter patterns
		const finalArgs = { ...args };
		if (!finalArgs.language) finalArgs.language = 'en';
		// Don't auto-default organization - empty string or undefined means "all organizations"
		// This allows fetch_scripture and other tools to use dynamic discovery
		// (No default organization - let the underlying service handle undefined)
		if (!finalArgs.format) finalArgs.format = 'json'; // Default to JSON for structured data

		// Log final parameters (after defaults)
		console.log(
			`[UNIFIED HANDLER] Final parameters (with defaults) for ${toolName}:`,
			JSON.stringify(finalArgs, null, 2)
		);

		Object.entries(finalArgs).forEach(([key, value]) => {
			// Skip undefined, null, and empty strings (especially for organization - empty means "all orgs")
			if (value !== undefined && value !== null && value !== '') {
				params.set(key, String(value));
			}
		});

		// Call the endpoint
		// Ensure we don't accidentally produce 'undefined' in the URL
		const base = this.baseUrl || '';
		const response = await this.fetchFn(`${base}${tool.endpoint}?${params}`);

		if (!response.ok) {
			// Try to get detailed error info from response body
			let errorDetails: any = {};
			let errorBody: any = null;

			try {
				errorBody = await response.json();
				errorDetails = errorBody.details || {};
			} catch (_parseError) {
				// If we can't parse the error body, use empty details
				console.warn('[UNIFIED HANDLER] Failed to parse error response body');
			}

			// Create enhanced error with details attached (message includes API validation text for clients/tests)
			const error: any = new Error(formatEndpointFailureMessage(response.status, errorBody));
			error.status = response.status;
			error.details = errorDetails;

			// Include helpful book code info for AI agents
			if (errorDetails.validBookCodes) {
				error.validBookCodes = errorDetails.validBookCodes;
				error.invalidCode = errorDetails.invalidCode;
				console.log(
					`[UNIFIED HANDLER] Attached ${errorDetails.validBookCodes.length} valid book codes to error`
				);
			}

			// Include language variant info for AI agents
			if (errorDetails.languageVariants) {
				error.languageVariants = errorDetails.languageVariants;
				error.requestedLanguage = errorDetails.requestedLanguage;
				console.log(
					`[UNIFIED HANDLER] Attached ${errorDetails.languageVariants.length} language variants to error`
				);
			}

			throw error;
		}

		// Capture diagnostic headers for metrics/debugging
		const cacheStatus = response.headers.get('X-Cache-Status');
		const xrayTrace = response.headers.get('X-XRay-Trace');
		const responseTime = response.headers.get('X-Response-Time');
		const traceId = response.headers.get('X-Trace-Id');

		console.log(`[UNIFIED HANDLER] Captured headers from ${tool.endpoint}:`, {
			cacheStatus,
			hasXrayTrace: !!xrayTrace,
			responseTime,
			traceId
		});

		// Handle both JSON and text/markdown responses
		const contentType = response.headers.get('content-type') || '';
		let data: any;

		if (contentType.includes('application/json')) {
			data = await response.json();
		} else {
			// For markdown or text responses, get as text
			const text = await response.text();
			// Try to parse as JSON first (some endpoints return JSON with text content-type)
			try {
				data = JSON.parse(text);
			} catch {
				// If not JSON, wrap in a structure that formatters can handle
				data = { text, raw: text };
			}
		}

		// Parse X-Ray trace if available
		let parsedXrayTrace: any = null;
		if (xrayTrace) {
			try {
				const cleaned = xrayTrace.replace(/\s+/g, '');
				parsedXrayTrace = JSON.parse(atob(cleaned));
				console.log(`[UNIFIED HANDLER] Parsed X-Ray trace:`, {
					hasCacheStats: !!parsedXrayTrace.cacheStats,
					apiCalls: parsedXrayTrace.apiCalls?.length || 0
				});
			} catch (e) {
				console.warn(`[UNIFIED HANDLER] Failed to parse X-Ray trace:`, e);
			}
		}

		// Check if format is JSON - if so, return raw structured data instead of formatting
		// Use finalArgs.format which includes defaults
		const format = finalArgs.format || 'json';
		console.log(`[UNIFIED HANDLER] Format determined for ${toolName}:`, format);
		if (format === 'json' || format === 'JSON') {
			// Return raw JSON data structure with metadata
			const result: MCPToolResponse = {
				content: [
					{
						type: 'text',
						text: JSON.stringify(data)
					}
				]
			};

			// Attach metadata if available
			if (cacheStatus || parsedXrayTrace || responseTime || traceId) {
				(result as any).metadata = {
					cacheStatus: cacheStatus?.toLowerCase(),
					responseTime: responseTime
						? parseInt(responseTime.replace(/[^0-9]/g, ''), 10)
						: undefined,
					traceId,
					xrayTrace: parsedXrayTrace
				};
				console.log(`[UNIFIED HANDLER] Attached metadata to response:`, (result as any).metadata);
			}

			return result;
		}

		// Format the response consistently for non-JSON formats
		const formattedText = tool.formatter(data);

		const result: MCPToolResponse = {
			content: [
				{
					type: 'text',
					text: formattedText
				}
			]
		};

		// Attach metadata for non-JSON formats too
		if (cacheStatus || parsedXrayTrace || responseTime || traceId) {
			(result as any).metadata = {
				cacheStatus: cacheStatus?.toLowerCase(),
				responseTime: responseTime ? parseInt(responseTime.replace(/[^0-9]/g, ''), 10) : undefined,
				traceId,
				xrayTrace: parsedXrayTrace
			};
			console.log(
				`[UNIFIED HANDLER] Attached metadata to formatted response:`,
				(result as any).metadata
			);
		}

		return result;
	}

	/**
	 * Get tool metadata
	 */
	getToolList() {
		return Object.entries(ToolRegistry).map(([name, config]) => ({
			name,
			endpoint: config.endpoint,
			requiredParams: config.requiredParams
		}));
	}
}

// Export singleton instance
export const mcpHandler = new UnifiedMCPHandler();
