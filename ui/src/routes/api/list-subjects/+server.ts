/**
 * List Subjects REST API Endpoint
 * Returns available resource subjects from Door43 catalog using /catalog/list/subjects
 * Uses standard endpoint patterns for consistency
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { handleListSubjects } from '$lib/../../../src/tools/listSubjects.js';

/**
 * Fetch subjects from catalog
 */
async function fetchSubjects(params: Record<string, any>, request: Request): Promise<any> {
	const { language, organization, stage } = params;

	// Call the tool handler
	const result = await handleListSubjects({
		language,
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
	name: 'list-subjects',

	// Parameters
	params: [
		COMMON_PARAMS.language,
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

	fetch: fetchSubjects,

	// Standard error handler
	onError: createStandardErrorHandler({
		'Failed to fetch subjects': {
			status: 500,
			message: 'Failed to retrieve subjects from catalog.',
		},
	}),
});

// CORS handler
export const OPTIONS = createCORSHandler();
