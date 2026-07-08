/**
 * Open Bible Stories Endpoint (issue #32)
 *
 * Fetches OBS story text: title + implicit image/paragraph frames, or front
 * matter. References use the OBS story:frame scheme ("1:1", "1:0" for a story
 * title, "front", "1:1-8", or a bare story number), NOT Bible book/chapter/verse.
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS, OBS_REFERENCE_PARAM } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { fetchOBSStory } from '$lib/../../../src/functions/obs-service.js';

async function fetchOBSEndpoint(params: Record<string, any>, _request: Request): Promise<any> {
	const { reference, language } = params;
	return await fetchOBSStory({
		reference,
		language: language || 'en'
	});
}

export const GET = createSimpleEndpoint({
	name: 'obs',

	params: [OBS_REFERENCE_PARAM, COMMON_PARAMS.language],

	supportsFormats: true,

	fetch: fetchOBSEndpoint,

	// Coded RESOURCE_NOT_AVAILABLE errors (unpublished language, nonexistent
	// frame) carry requestedLanguage and fall through to the common handlers,
	// which keep their detailed message on the 404 (issue #30 behavior).
	onError: createStandardErrorHandler({
		'Invalid OBS reference': {
			status: 400,
			message:
				'Invalid OBS reference. Use story:frame — e.g. "1:1" (story 1, frame 1), "1:0" (story title), "1" (whole story), "1:1-8" (frame range), or "front" (front matter). Stories run 1-50; this is not a Bible book chapter:verse reference.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
