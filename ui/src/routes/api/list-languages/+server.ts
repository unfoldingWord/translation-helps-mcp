/**
 * List Languages REST API Endpoint
 * Returns available languages from Door43 catalog using /catalog/list/languages
 * Uses standard endpoint patterns for consistency
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { handleListLanguages } from '$lib/../../../src/tools/listLanguages.js';

/**
 * Fetch languages from catalog
 */
async function fetchLanguages(params: Record<string, any>, request: Request): Promise<any> {
	const { organization, stage } = params;

	// Call the tool handler
	const result = await handleListLanguages({
		organization,
		stage: stage || 'prod',
	});

	// Extract the JSON text from MCP response format
	if (result.content && result.content[0]?.text) {
		const data = JSON.parse(result.content[0].text);
		
		// Extract X-Ray trace from metadata if available
		const xrayTrace = data.metadata?.serviceMetadata?.xrayTrace || null;
		
		return {
			...data,
			_trace: xrayTrace, // Include trace for header extraction
		};
	}

	return result;
}

// Create the endpoint using standard pattern
export const GET = createSimpleEndpoint({
	name: 'list-languages',

	// Parameters
	params: [
		COMMON_PARAMS.organization,
		{
			name: 'stage',
			required: false,
			type: 'string',
			default: 'prod',
			validate: (value: string) => ['prod', 'preprod', 'draft'].includes(value),
		},
	],

	// Enable format support
	supportsFormats: true,

	fetch: fetchLanguages,

	// Standard error handler
	onError: createStandardErrorHandler({
		'Failed to fetch languages': {
			status: 500,
			message: 'Failed to retrieve languages from catalog.',
		},
	}),
});

// CORS handler
export const OPTIONS = createCORSHandler();
