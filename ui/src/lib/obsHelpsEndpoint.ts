/**
 * Shared factory for the four OBS helps endpoints (issue #32):
 * fetch-obs-translation-notes / -translation-questions / -study-notes /
 * -study-questions. They differ only by resource type — same OBS story:frame
 * reference handling, same error mapping.
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS, OBS_REFERENCE_PARAM } from '$lib/commonValidators.js';
import { createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { fetchOBSHelps, type OBSHelpsType } from '$lib/../../../src/functions/obs-helps-service.js';

export function createOBSHelpsEndpoint(resourceType: OBSHelpsType, name: string) {
	return createSimpleEndpoint({
		name,

		params: [OBS_REFERENCE_PARAM, COMMON_PARAMS.language],

		supportsFormats: true,

		fetch: async (params: Record<string, any>, _request: Request): Promise<any> => {
			const { reference, language } = params;
			return await fetchOBSHelps({
				resourceType,
				reference,
				language: language || 'en'
			});
		},

		// Coded RESOURCE_NOT_AVAILABLE errors (unpublished language, no rows for
		// the reference) carry requestedLanguage and fall through to the common
		// handlers, which keep their detailed message on the 404 (issue #30).
		onError: createStandardErrorHandler({
			'Invalid OBS reference': {
				status: 400,
				message:
					'Invalid OBS reference. Use story:frame — e.g. "1:1" (story 1, frame 1), "1:0" (story title), "1" (whole story), "1:1-8" (frame range), or "front" (front matter). Stories run 1-50; this is not a Bible book chapter:verse reference.'
			}
		})
	});
}
