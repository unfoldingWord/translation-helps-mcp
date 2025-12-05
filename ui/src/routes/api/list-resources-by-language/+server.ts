/**
 * List Resources by Language REST API Endpoint
 * Returns available resources organized by language
 * Uses standard endpoint patterns for consistency
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { handleListResourcesByLanguage } from '$lib/../../../src/tools/listResourcesByLanguage.js';

/**
 * Fetch resources organized by language
 */
async function fetchResourcesByLanguage(
	params: Record<string, any>,
	request: Request
): Promise<any> {
	const { subjects, organization, stage, limit, topic } = params;

	// Parse subjects if it's a string (comma-separated)
	let subjectsParam: string | string[] | undefined = subjects;
	if (typeof subjects === 'string' && subjects.includes(',')) {
		subjectsParam = subjects.split(',').map((s) => s.trim());
	}

	// Ensure limit is a number (not NaN)
	// limit comes as string from URL params, convert to number
	const limitNum = limit ? (typeof limit === 'string' ? parseInt(limit, 10) : limit) : 100;
	const finalLimit = isNaN(limitNum) || limitNum < 1 || limitNum > 1000 ? 100 : limitNum;

	try {
		const result = await handleListResourcesByLanguage({
			subjects: subjectsParam,
			organization,
			stage: stage || 'prod',
			limit: finalLimit,
			topic
		});

		// Extract the JSON text from MCP response format
		if (result.content && result.content[0]?.text) {
			const data = JSON.parse(result.content[0].text);

			// Extract X-Ray trace from metadata if available
			const xrayTrace = data.metadata?.serviceMetadata?.xrayTrace || null;

			return {
				...data,
				_trace: xrayTrace // Include trace for header extraction
			};
		}

		return result;
	} catch (error) {
		// Log the actual error for debugging
		console.error('Error in fetchResourcesByLanguage:', error);
		throw error;
	}
}

// Create the endpoint using standard pattern
export const GET = createSimpleEndpoint({
	name: 'list-resources-by-language',

	// Parameters
	params: [
		{
			name: 'subjects',
			required: false,
			type: 'string',
			validate: (value: string) => {
				if (!value) return true;
				// Can be comma-separated list
				return true;
			}
		},
		COMMON_PARAMS.organization,
		{
			name: 'stage',
			required: false,
			type: 'string',
			default: 'prod',
			validate: (value: string) => ['prod', 'preprod', 'draft'].includes(value)
		},
		{
			name: 'limit',
			required: false,
			type: 'string',
			default: '100',
			validate: (value: string) => {
				const num = parseInt(value, 10);
				return !isNaN(num) && num >= 1 && num <= 1000;
			}
		},
		{
			name: 'topic',
			required: false,
			type: 'string'
		}
	],

	// Enable format support
	supportsFormats: true,

	fetch: fetchResourcesByLanguage,

	// Standard error handler
	onError: createStandardErrorHandler({
		'Failed to fetch resources by language': {
			status: 500,
			message: 'Failed to retrieve resources organized by language.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
