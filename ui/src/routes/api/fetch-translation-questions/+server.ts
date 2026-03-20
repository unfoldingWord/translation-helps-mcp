/**
 * Translation Questions Endpoint v2
 *
 * Demonstrates using all our consistent utilities:
 * - Common validators
 * - Standard error handlers
 * - Consistent response shapes
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { fetchTranslationQuestions } from '$lib/../../../src/functions/translation-questions-service.js';

/**
 * Fetch translation questions for a reference
 */
async function fetchTranslationQuestionsEndpoint(
	params: Record<string, any>,
	_request: Request
): Promise<any> {
	const { reference, language, organization, topic } = params;

	// Use the core service which now supports multi-organization fetching
	const result = await fetchTranslationQuestions({
		reference,
		language: language || 'en',
		organization, // Undefined by default = fetch from all organizations
		topic: topic || 'tc-ready'
	});

	// Format response with standardized metadata
	return {
		reference,
		...(result.citations && { citations: result.citations }), // Multi-organization response
		...(result.citation && !result.citations && { citation: result.citation }), // Single organization response
		...(result.metadata.organizations && { organizations: result.metadata.organizations }),
		items: result.translationQuestions.map((q) => ({
			ID: q.id,
			Reference: q.reference,
			Question: q.question,
			Response: q.response,
			Tags: q.tags?.join(', ') || '',
			...(q.citation && { citation: q.citation })
		})),
		counts: {
			totalCount: result.metadata.questionsFound,
			cached: result.metadata.cached,
			responseTime: result.metadata.responseTime,
			...(result.metadata.totalResources && { totalResources: result.metadata.totalResources })
		},
		metadata: {
			resourceType: 'tq',
			subject: result.metadata.subject || 'TSV Translation Questions', // ✅ Dynamic or fallback
			language: language || 'en',
			organization: organization || 'all',
			license: 'CC BY-SA 4.0'
		}
	};
}

// Create the endpoint
export const GET = createSimpleEndpoint({
	name: 'translation-questions-v3',

	// Use common parameter validators - organization now optional
	params: [COMMON_PARAMS.reference, COMMON_PARAMS.language, COMMON_PARAMS.organization],

	fetch: fetchTranslationQuestionsEndpoint,

	supportsFormats: true,

	// Use standard error handler
	onError: createStandardErrorHandler({
		'No translation questions found': {
			status: 404,
			message: 'No translation questions available for this reference.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
