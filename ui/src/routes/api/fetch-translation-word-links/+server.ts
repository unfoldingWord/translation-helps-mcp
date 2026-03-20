/**
 * Fetch Translation Word Links Endpoint v2
 *
 * ✅ PRODUCTION READY - Uses real DCS data via ZIP fetcher
 *
 * Returns links between Bible text and translation word entries.
 * These help identify which words in a verse have dictionary entries.
 */

import { EdgeXRayTracer } from '$lib/../../../src/functions/edge-xray.js';
import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { createTranslationHelpsResponse } from '$lib/standardResponses.js';
import { UnifiedResourceFetcher } from '$lib/unifiedResourceFetcher.js';

/**
 * Fetch translation word links for a reference
 * Uses real TSV data from DCS ZIP archives
 */
async function fetchTranslationWordLinks(
	params: Record<string, any>,
	request: Request
): Promise<any> {
	const { reference, language, organization } = params;

	// Create tracer for this request
	const tracer = new EdgeXRayTracer(`twl-${Date.now()}`, 'fetch-translation-word-links');

	// Initialize fetcher with request headers
	const fetcher = new UnifiedResourceFetcher(tracer);
	fetcher.setRequestHeaders(Object.fromEntries(request.headers.entries()));

	// Fetch real TWL data from TSV (now includes subject)
	const tsvResult = await fetcher.fetchTranslationWordLinks(reference, language, organization);

	// Transform TSV rows to expected format with externalReference
	const links = tsvResult.data.map((row, index) => {
		const rcLink = row.TWLink || '';

		// Parse RC link to extract category, term, and path
		// Format: rc://*/tw/dict/bible/{category}/{term}
		let externalReference: { target: string; path: string; category?: string } | null = null;

		if (rcLink) {
			// Extract everything after /dict/ (without .md extension)
			const pathMatch = rcLink.match(/rc:\/\/\*\/tw\/dict\/(.+)/);
			if (pathMatch) {
				const extractedPath = pathMatch[1]; // e.g., "bible/kt/love"
				
				// Extract category from path
				const categoryMatch = extractedPath.match(/bible\/([^/]+)\//);
				const category = categoryMatch ? categoryMatch[1] : undefined; // e.g., "kt", "names", "other"

				externalReference = {
					target: 'tw',
					path: extractedPath, // e.g., "bible/kt/love"
					...(category && { category })
				};
			}
		}

		return {
			id: `twl${index + 1}`,
			reference: row.Reference || reference,
			occurrence: parseInt(row.Occurrence || '1', 10),
			quote: row.Quote || '',
			strongsId: row.StrongsId || '',
			...(externalReference && { externalReference })
		};
	});

	// Return response with standardized metadata
	return {
		reference,
		items: links,
		counts: {
			linksFound: links.length
		},
		metadata: {
			resourceType: 'twl',
			subject: tsvResult.subject || 'TSV Translation Words Links', // ✅ Dynamic or fallback
			language: language || 'en',
			organization: organization || 'unfoldingWord',
			license: 'CC BY-SA 4.0'
		},
		_trace: fetcher.getTrace()
	};
}

// Create the endpoint
export const GET = createSimpleEndpoint({
	name: 'fetch-translation-word-links-v2',

	params: [COMMON_PARAMS.reference, COMMON_PARAMS.language, COMMON_PARAMS.organization],

	fetch: fetchTranslationWordLinks,

	onError: createStandardErrorHandler(),

	// Support passthrough for TSV and markdown for LLMs
	supportsFormats: ['json', 'tsv', 'md', 'markdown']
});

// CORS handler
export const OPTIONS = createCORSHandler();
