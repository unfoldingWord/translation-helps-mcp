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
 * Parse RC link (SupportReference) to externalReference format
 * Examples:
 *   rc://star/ta/man/translate/figs-metaphor => { target: 'ta', path: 'translate/figs-metaphor' }
 *   rc://star/tw/dict/bible/kt/love => { target: 'tw', path: 'bible/kt/love', category: 'kt' }
 */
function parseRCLinkToExternalReference(rcLink: string): { target: string; path: string; category?: string } | null {
	if (!rcLink || !rcLink.startsWith('rc://')) {
		return null;
	}

	// Match TA pattern: rc://*/ta/man/{path}
	const taMatch = rcLink.match(/rc:\/\/\*\/ta\/man\/(.+)/);
	if (taMatch) {
		return {
			target: 'ta',
			path: taMatch[1] // e.g., "translate/figs-metaphor"
		};
	}

	// Match TW pattern: rc://*/tw/dict/{path}
	const twMatch = rcLink.match(/rc:\/\/\*\/tw\/dict\/(.+)/);
	if (twMatch) {
		const path = twMatch[1]; // e.g., "bible/kt/love"
		
		// Extract category from path
		const categoryMatch = path.match(/bible\/([^/]+)\//);
		const category = categoryMatch ? categoryMatch[1] : undefined;

		return {
			target: 'tw',
			path,
			...(category && { category })
		};
	}

	return null;
}

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

	// Check if we have any verse-specific notes (not just intro/context)
	// If we only have context notes, this means the verse doesn't have any specific notes
	const verseNotesCount = result.metadata.verseNotesCount || 0;
	const contextNotesCount = result.metadata.contextNotesCount || 0;

	if (verseNotesCount === 0 && contextNotesCount > 0) {
		// Only intro/context notes available - verse doesn't exist or has no specific notes
		// Context notes should NOT be returned in error responses
		const error: any = new Error(`No verse-specific notes found for ${reference}. Only general context available.`);
		error.hasContextOnly = true;
		error.contextNotesCount = contextNotesCount;
		error.reference = reference;
		error.language = language;
		throw error;
	} else if (verseNotesCount === 0 && contextNotesCount === 0) {
		// No notes at all
		throw new Error(`No translation notes found for ${reference}.`);
	}

	// Format response with SEPARATE arrays for verse-specific and contextual notes
	// This prevents LLM confusion between reference-specific notes and general background
	return {
		reference,
		...(result.citations && { citations: result.citations }), // Multi-organization response
		...(result.citation && !result.citations && { citation: result.citation }), // Single organization response
		...(result.metadata.organizations && { organizations: result.metadata.organizations }),
		
		// VERSE-SPECIFIC NOTES (for the exact reference requested)
		verseNotes: result.verseNotes.map((note) => {
			const externalRef = note.supportReference 
				? parseRCLinkToExternalReference(note.supportReference)
				: null;
			
			return {
				Reference: note.reference,
				ID: note.id,
				Note: note.note,
				Quote: note.quote || '',
				Occurrence: note.occurrence?.toString() || '0',
				Occurrences: note.occurrences?.toString() || '0',
				...(externalRef && { externalReference: externalRef }),
				...(note.citation && { citation: note.citation })
			};
		}),
		
		// CONTEXTUAL NOTES (general book/chapter background)
		contextNotes: result.contextNotes.map((note) => {
			const externalRef = note.supportReference 
				? parseRCLinkToExternalReference(note.supportReference)
				: null;
			
			// Determine context type from reference
			const contextType = note.reference === 'front:intro' ? 'book' : 'chapter';
			
			return {
				Reference: note.reference,
				ID: note.id,
				Note: note.note,
				Quote: note.quote || '',
				Occurrence: note.occurrence?.toString() || '0',
				Occurrences: note.occurrences?.toString() || '0',
				contextType, // Explicitly mark as "book" or "chapter" context
				...(externalRef && { externalReference: externalRef }),
				...(note.citation && { citation: note.citation })
			};
		}),
		
		counts: {
			totalCount: result.metadata.sourceNotesCount,
			verseNotesCount: result.metadata.verseNotesCount,
			contextNotesCount: result.metadata.contextNotesCount,
			...(result.metadata.totalResources && { totalResources: result.metadata.totalResources })
		},
		metadata: {
			resourceType: 'tn',
			subject: result.metadata.subject || 'TSV Translation Notes', // ✅ Dynamic or fallback
			language: language || 'en',
			organization: organization || 'all',
			license: 'CC BY-SA 4.0'
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
		},
		'No verse-specific notes found': {
			status: 404,
			message: 'No verse-specific translation notes found. Only general book/chapter context is available.'
		}
	})
});

// CORS handler
export const OPTIONS = createCORSHandler();
