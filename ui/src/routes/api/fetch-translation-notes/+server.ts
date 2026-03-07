/**
 * Translation Notes Endpoint v2
 *
 * Another example of consistent endpoint implementation.
 * Same patterns, same utilities, predictable behavior!
 */

import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { fetchTranslationNotes } from '$lib/../../../src/functions/translation-notes-service.js';

/**
 * Fetch translation notes for a reference
 */
async function fetchTranslationNotesEndpoint(params: Record<string, any>, _request: Request): Promise<any> {
	const { reference, language, organization, includeIntro, includeContext, topic } = params;

	// Use the core service which now supports multi-organization fetching
	const result = await fetchTranslationNotes({
		reference,
		language: language || 'en',
		organization, // Undefined by default = fetch from all organizations
		includeIntro: includeIntro !== false,
		includeContext: includeContext !== false,
		topic: topic || 'tc-ready'
	});

	// Format response
	return {
		reference,
		language: language || 'en',
		...(organization && { organization }), // Only include if specified
		...(result.citations && { citations: result.citations }), // Multi-organization response
		...(result.citation && !result.citations && { citation: result.citation }), // Single organization response
		...(result.metadata.organizations && { organizations: result.metadata.organizations }),
		items: [
			...result.verseNotes.map((note) => ({
				Reference: note.reference,
				ID: note.id,
				Note: note.note,
				Quote: note.quote || '',
				Occurrence: note.occurrence?.toString() || '0',
				Occurrences: note.occurrences?.toString() || '0',
				SupportReference: note.supportReference || '',
				...(note.citation && { citation: note.citation })
			})),
			...result.contextNotes.map((note) => ({
				Reference: note.reference,
				ID: note.id,
				Note: note.note,
				Quote: note.quote || '',
				Occurrence: note.occurrence?.toString() || '0',
				Occurrences: note.occurrences?.toString() || '0',
				SupportReference: note.supportReference || '',
				...(note.citation && { citation: note.citation })
			}))
		],
		metadata: {
			totalCount: result.metadata.sourceNotesCount,
			verseNotesCount: result.metadata.verseNotesCount,
			contextNotesCount: result.metadata.contextNotesCount,
			...(result.metadata.totalResources && { totalResources: result.metadata.totalResources })
		}
	};
}

// Create the endpoint
export const GET = createSimpleEndpoint({
	name: 'translation-notes-v3',

	// Parameter validators - organization now optional
	params: [COMMON_PARAMS.reference, COMMON_PARAMS.language, COMMON_PARAMS.organization],

	// Enable format support
	supportsFormats: true,

	fetch: fetchTranslationNotesEndpoint,

	// Error handler
	onError: createStandardErrorHandler({
		'No translation notes found': {
			status: 404,
			message: 'No translation notes available for this reference.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
