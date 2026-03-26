/**
 * Fetch Scripture Endpoint v2
 *
 * The golden standard endpoint - fetches scripture text for any Bible reference.
 * Supports multiple translations and formats.
 */

import { EdgeXRayTracer } from '$lib/../../../src/functions/edge-xray.js';
import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { createScriptureResponse } from '$lib/standardResponses.js';
import { UnifiedResourceFetcher } from '$lib/unifiedResourceFetcher.js';

/**
 * Parse resource parameter
 * Returns null for 'all' to trigger dynamic catalog discovery
 * Returns specific resource list when comma-separated values provided
 */
function parseResources(resourceParam: string | undefined): string[] | null {
	// When 'all' or undefined, return null to trigger dynamic discovery from catalog
	// This allows the tc-ready topic filter to determine available resources
	if (!resourceParam || resourceParam === 'all') {
		return null;
	}

	// Handle comma-separated resources - no validation needed
	// Let the catalog determine if these resources exist
	return resourceParam
		.split(',')
		.map((r) => r.trim())
		.filter(Boolean);
}

/**
 * Fetch scripture for a reference
 */
async function fetchScripture(params: Record<string, any>, request: Request): Promise<any> {
	const { reference, language, resource: resourceParam } = params;

	// Organization filter removed from public API; discovery searches all orgs.
	const organization = undefined;

	// Create tracer for this request
	const tracer = new EdgeXRayTracer(`scripture-${Date.now()}`, 'fetch-scripture');

	// Initialize fetcher with request headers
	const fetcher = new UnifiedResourceFetcher(tracer);
	fetcher.setRequestHeaders(Object.fromEntries(request.headers.entries()));

	// Get requested resources
	const requestedResources = parseResources(resourceParam);

	// Fetch using unified fetcher
	const results = await fetcher.fetchScripture(
		reference,
		language,
		organization,
		requestedResources
	);

	if (!results || results.length === 0) {
		throw new Error(`Scripture not found for reference: ${reference}`);
	}

	// Log for debugging - verify all versions are being returned
	console.log(
		`[fetch-scripture-v2] Fetched ${results.length} scripture versions:`,
		results.map((s: any) => s.translation || 'Unknown')
	);

	const orgFallback = fetcher.getOrganizationFallback();

	// Return in standard format with trace data
	const response = {
		...createScriptureResponse(results, {
			reference,
			requestedResources,
			foundResources: results.map((s: any) => s.translation?.split(' ')[0]?.toLowerCase()),
			...(orgFallback && { organizationFallback: orgFallback })
		}),
		_trace: fetcher.getTrace()
	};

	// Log the response structure to verify all scriptures are included
	console.log(
		`[fetch-scripture-v2] Response contains ${response.scripture?.length || 0} scriptures in response.scripture array`
	);

	return response;
}

// Create the endpoint with format support
export const GET = createSimpleEndpoint({
	name: 'fetch-scripture-v2',

	params: [
		COMMON_PARAMS.reference,
		COMMON_PARAMS.language,
		{
			name: 'resource',
			default: 'all'
			// No validation - let the catalog determine which resources exist
			// This makes the system fully dynamic based on tc-ready topic filter
		}
	],

	// Enable format support - format parameter will be added automatically
	supportsFormats: true,

	fetch: fetchScripture,

	onError: createStandardErrorHandler({
		'Scripture not found for reference': {
			status: 404,
			message: 'No scripture available for the specified reference.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
