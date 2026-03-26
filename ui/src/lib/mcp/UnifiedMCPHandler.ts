/**
 * Unified MCP Handler
 * Single source of truth for all MCP tool calls
 */

import { ToolRegistry, type MCPToolResponse } from '../../../../src/contracts/ToolContracts';

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
	 * Handle any MCP tool call consistently
	 */
	async handleToolCall(toolName: string, args: any): Promise<MCPToolResponse> {
		const tool = ToolRegistry[toolName as keyof typeof ToolRegistry];

		if (!tool) {
			throw new Error(`Unknown tool: ${toolName}`);
		}

		// Log received parameters (before defaults are applied)
		console.log(
			`[UNIFIED HANDLER] Received parameters for ${toolName}:`,
			JSON.stringify(args, null, 2)
		);

		// Validate required parameters
		for (const param of tool.requiredParams) {
			if (!args[param]) {
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
