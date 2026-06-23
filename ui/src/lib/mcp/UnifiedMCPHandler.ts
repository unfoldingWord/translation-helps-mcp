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

/** Normalize an arg key for structural matching: drop _, -, spaces; lowercase. */
function normKey(k: string): string {
	return k.replace(/[_\s-]/g, '').toLowerCase();
}

type RefPart = 'book' | 'chapter' | 'verse' | 'endVerse' | 'endChapter';

/**
 * Classify an arg key as a decomposed-reference part by its STRUCTURE, not by
 * matching a fixed list of names (issue #24 Class C).
 *
 * The first fix only matched the literal key `book` — but real production
 * traffic spells the book a dozen ways (`book_id`, `bookId`, `book_code`, …),
 * so it missed ~95% of decomposed calls. The fix is to match structurally:
 *
 *  - `book` is the high-variance dimension, so any key whose normalized form
 *    STARTS WITH `book` (book, bookId, book_code, bookName, bookUsfm, …) is the
 *    book. This is robust to permutations we have not seen yet.
 *  - chapter/verse have no observed variance, so they use prefix matches that
 *    cannot collide with unrelated params: `startsWith('verse')` does NOT match
 *    `version` (`'version'.startsWith('verse')` is false). The range start/end
 *    bounds are checked first so they are not swallowed by the plain cases.
 *
 * Returns the canonical part name, or null if the key is not a reference part.
 */
function classifyRefPart(nk: string): RefPart | null {
	if (nk.startsWith('book')) return 'book';
	if (nk.startsWith('endverse') || nk === 'verseend') return 'endVerse';
	if (nk.startsWith('endchapter') || nk === 'chapterend') return 'endChapter';
	// Range start bounds collapse onto the primary chapter/verse.
	if (nk.startsWith('startchapter') || nk.startsWith('fromchapter')) return 'chapter';
	if (nk.startsWith('startverse') || nk.startsWith('fromverse')) return 'verse';
	if (nk.startsWith('chapter') || nk === 'chap') return 'chapter';
	if (nk.startsWith('verse') || nk === 'v') return 'verse';
	return null;
}

/** Canonical bare-`path` synonyms (issue #24 Class B). `topic` is excluded — it
 *  is a legitimate filter on these tools, handled only as a last-resort fallback. */
const PATH_SYNONYMS = new Set([
	'term',
	'word',
	'name',
	'article',
	'module',
	'moduleid',
	'identifier'
]);

/**
 * Classify an arg key as a `path` synonym STRUCTURALLY (issue #24 Round 3 / #28),
 * returning its canonical base or null. Catches `<synonym>_id` / `<synonym>Id`
 * (word_id, wordId, article_id, …) the model emits without enumerating every
 * spelling — same principle as classifyRefPart() for `book*`. `nk` is normKey(key).
 *
 * The trailing `id` is only stripped when the remainder is a known synonym, so it
 * cannot misfire: `uuid` → `uu` ∉ set → ignored; `identifier` is matched whole.
 */
function classifyPathSynonym(nk: string): string | null {
	if (nk === 'id') return 'id'; // bare id
	if (PATH_SYNONYMS.has(nk)) return nk; // term/word/name/article/module/moduleid/identifier
	if (nk.endsWith('id') && PATH_SYNONYMS.has(nk.slice(0, -2))) {
		return nk.slice(0, -2); // word_id->word, article_id->article, term_id->term
	}
	return null;
}

interface DecomposedRef {
	parts: Partial<Record<RefPart, unknown>>;
	/** Every original arg key that was classified as a reference part. */
	consumedKeys: string[];
}

/**
 * Structurally collect decomposed reference parts from arbitrary arg keys
 * (issue #24 Class C). Scans every key once; first non-blank value wins per
 * part. `reference` itself is never treated as a part.
 */
function collectDecomposedRef(args: Record<string, any>): DecomposedRef {
	const parts: Partial<Record<RefPart, unknown>> = {};
	const consumedKeys: string[] = [];
	for (const k of Object.keys(args)) {
		if (k === 'reference') continue;
		const part = classifyRefPart(normKey(k));
		if (!part) continue;
		consumedKeys.push(k);
		if (parts[part] === undefined && !isBlank(args[k])) {
			parts[part] = args[k];
		}
	}
	return { parts, consumedKeys };
}

/**
 * Assemble a single `reference` string from collected decomposed parts
 * (issue #24 Class C). The model sometimes sends the passage split across
 * book/chapter/verse keys instead of one reference; the endpoints only accept
 * a reference string.
 */
function assembleReference(parts: Partial<Record<RefPart, unknown>>): string {
	let ref = String(parts.book).trim();
	if (!isBlank(parts.chapter)) {
		ref += ` ${String(parts.chapter).trim()}`;
		if (!isBlank(parts.verse)) {
			ref += `:${String(parts.verse).trim()}`;
			if (!isBlank(parts.endVerse)) ref += `-${String(parts.endVerse).trim()}`;
		} else if (!isBlank(parts.endChapter)) {
			// Whole-chapter range, e.g. {book:"Titus",chapter:1,endChapter:2} → "Titus 1-2"
			ref += `-${String(parts.endChapter).trim()}`;
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
	 * - Class C: decomposed reference parts → a single `reference`. Matched
	 *            STRUCTURALLY (any `book*` key, e.g. book_id/bookId/book_code),
	 *            not against a fixed name list — see classifyRefPart().
	 * - Class B: term / word / name / article / moduleId / id / topic → `path`
	 *            (for path-required tools). Matched STRUCTURALLY, so `<synonym>_id`
	 *            / `<synonym>Id` (word_id, article_id, …) resolve too — see
	 *            classifyPathSynonym().
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
		// Structural: catches book/book_id/bookId/book_code/… (any "book*" key),
		// not just the literal `book` the first fix matched (issue #24 root cause).
		if (requiredParams.includes('reference')) {
			const { parts, consumedKeys } = collectDecomposedRef(args);
			if (isBlank(args.reference) && !isBlank(parts.book)) {
				args.reference = assembleReference(parts);
				console.log(
					`[UNIFIED HANDLER] Assembled reference for ${toolName} from decomposed args:`,
					args.reference
				);
			}
			// Once a reference exists (assembled or supplied), strip the decomposed
			// leftovers so they don't leak into the query string.
			if (!isBlank(args.reference)) {
				for (const k of consumedKeys) delete args[k];
			}
		}

		// Class B — term/word synonyms → bare `path` (path-required tools only).
		// The endpoints resolve a bare term across all categories, so the synonym
		// value is passed through verbatim as the path. Synonyms are matched
		// STRUCTURALLY (classifyPathSynonym), so `<synonym>_id`/`<synonym>Id`
		// spellings the model emits (word_id, article_id, …) resolve too — issue #28.
		if (requiredParams.includes('path')) {
			if (isBlank(args.path)) {
				// Map each canonical synonym to the model's original arg key (first
				// non-blank wins). Then pick by priority — the model's preferred
				// identifier wins. `topic` is NOT a synonym: it's a real filter, used
				// as the path only as a last resort when nothing clearer is present.
				const bySyn = new Map<string, string>();
				for (const k of Object.keys(args)) {
					const syn = classifyPathSynonym(normKey(k));
					if (syn && !isBlank(args[k]) && !bySyn.has(syn)) bySyn.set(syn, k);
				}
				const PRIORITY = [
					'term',
					'word',
					'name',
					'article',
					'module',
					'moduleid',
					'identifier',
					'id'
				];
				for (const syn of PRIORITY) {
					const k = bySyn.get(syn);
					if (k) {
						args.path = String(args[k]).trim();
						console.log(`[UNIFIED HANDLER] Aliased path for ${toolName} from ${k}:`, args.path);
						break;
					}
				}
				if (isBlank(args.path) && !isBlank(args.topic)) {
					args.path = String(args.topic).trim();
					delete args.topic; // consumed the filter as the path
					console.log(`[UNIFIED HANDLER] Aliased path for ${toolName} from topic:`, args.path);
				}
			}
			// These synonyms aren't endpoint params (`term` is a rejected deprecated
			// one); strip any consumed key so it doesn't leak into the query string.
			for (const k of Object.keys(args)) {
				if (k !== 'path' && classifyPathSynonym(normKey(k)) !== null) delete args[k];
			}
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

			// A 404 means the requested resource isn't published/available — an
			// EXPECTED outcome, NOT a server failure. Return it as a NORMAL
			// (isError:false) result so downstream consumers (bt-servant-worker)
			// don't treat it as an outage and trip their health circuit, which is
			// what surfaced to users as "the translation-helps server is down"
			// (issue #30 / #12).
			if (response.status === 404) {
				const message =
					(errorBody && (errorBody.error || errorBody.message)) ||
					'The requested resource is not available.';
				const payload: Record<string, unknown> = {
					available: false,
					code: (errorBody && errorBody.code) || 'RESOURCE_NOT_AVAILABLE',
					status: 404,
					message
				};
				if (errorDetails && typeof errorDetails === 'object') {
					if (Object.keys(errorDetails).length > 0) payload.details = errorDetails;
					if (errorDetails.languageVariants)
						payload.languageVariants = errorDetails.languageVariants;
					if (errorDetails.requestedLanguage)
						payload.requestedLanguage = errorDetails.requestedLanguage;
				}
				console.log(
					`[UNIFIED HANDLER] Resource not available (404) for ${toolName} — returning non-error result:`,
					message
				);
				return {
					content: [{ type: 'text', text: JSON.stringify(payload) }],
					isError: false
				};
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
