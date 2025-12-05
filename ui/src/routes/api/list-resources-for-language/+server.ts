/**
 * List Resources for Language REST API Endpoint
 * Returns all resources available for a specific language
 * Uses standard endpoint patterns for consistency
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { handleListResourcesForLanguage } from '$lib/../../../src/tools/listResourcesForLanguage.js';

/**
 * Fetch resources for a specific language
 */
async function fetchResourcesForLanguage(params: Record<string, any>, request: Request): Promise<any> {
	const { language, organization, stage, subject, limit, topic } = params;

	// Ensure limit is a number - if not provided, use undefined to get all resources
	let finalLimit: number | undefined;
	if (limit) {
		const limitNum = typeof limit === 'string' ? parseInt(limit, 10) : limit;
		finalLimit = isNaN(limitNum) || limitNum < 1 || limitNum > 10000 ? undefined : limitNum;
	}
	
	try {
		const result = await handleListResourcesForLanguage({
			language,
			organization,
			stage: stage || 'prod',
			subject,
			limit: finalLimit,
			topic,
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
	} catch (error) {
		// Log the actual error for debugging
		console.error('Error in fetchResourcesForLanguage:', error);
		throw error;
	}
}

// Create the endpoint using standard pattern
export const GET = createSimpleEndpoint({
	name: 'list-resources-for-language',

	// Parameters
	params: [
		{
			name: 'language',
			required: true,
			type: 'string',
			validate: (value: string) => {
				if (!value || value.length < 2) {
					return false;
				}
				return true;
			},
		},
		COMMON_PARAMS.organization,
		{
			name: 'stage',
			required: false,
			type: 'string',
			default: 'prod',
			validate: (value: string) => ['prod', 'preprod', 'draft'].includes(value),
		},
		{
			name: 'subject',
			required: false,
			type: 'string',
		},
		{
			name: 'limit',
			required: false,
			type: 'string',
			validate: (value: string) => {
				if (!value) return true; // Allow empty/undefined
				const num = parseInt(value, 10);
				return !isNaN(num) && num >= 1 && num <= 10000;
			},
		},
		{
			name: 'topic',
			required: false,
			type: 'string',
		},
	],

	// Enable format support
	supportsFormats: true,

	fetch: fetchResourcesForLanguage,

	// Standard error handler
	onError: createStandardErrorHandler({
		'Failed to fetch resources for language': {
			status: 500,
			message: 'Failed to retrieve resources for the specified language.',
		},
	}),
});

// CORS handler
export const OPTIONS = createCORSHandler();

