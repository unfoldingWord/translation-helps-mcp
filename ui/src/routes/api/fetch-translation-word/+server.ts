/**
 * Get Translation Word Endpoint v2
 *
 * ✅ PRODUCTION READY - Uses real DCS data via ZIP fetcher
 *
 * Retrieves detailed information about a specific translation word/term.
 * Supports RC links from TWL, direct terms, and paths.
 * Provides Table of Contents when no specific term is requested.
 */

import { EdgeXRayTracer } from '$lib/../../../src/functions/edge-xray.js';
import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { createTranslationHelpsResponse } from '$lib/standardResponses.js';
import { UnifiedResourceFetcher, type TWArticleResult } from '$lib/unifiedResourceFetcher.js';
import { parseRCLink, extractTerm, isRCLink } from '$lib/rcLinkParser.js';

/**
 * Generate Table of Contents when no specific term is requested
 */
function generateTableOfContents(language: string, organization: string) {
	return {
		type: 'table-of-contents',
		title: 'Translation Words',
		description: 'Biblical terms and concepts with detailed explanations',
		categories: [
			{
				id: 'kt',
				name: 'Key Terms',
				description: 'Central theological concepts (God, salvation, covenant, righteousness)',
				exampleTerms: ['love', 'grace', 'faith', 'covenant', 'salvation'],
				exampleRCLink: `rc://${language}/tw/dict/bible/kt/love`
			},
			{
				id: 'names',
				name: 'Names',
				description: 'People, places, and proper nouns (Abraham, Jerusalem, Pharaoh)',
				exampleTerms: ['abraham', 'david', 'jerusalem', 'egypt', 'israel'],
				exampleRCLink: `rc://${language}/tw/dict/bible/names/abraham`
			},
			{
				id: 'other',
				name: 'Other Terms',
				description: 'Cultural, historical, and general concepts (Sabbath, temple, sacrifice)',
				exampleTerms: ['sabbath', 'temple', 'sacrifice', 'priest', 'altar'],
				exampleRCLink: `rc://${language}/tw/dict/bible/other/sabbath`
			}
		],
		usage: {
			byRCLink: `?rcLink=rc://${language}/tw/dict/bible/kt/love`,
			byTerm: '?term=love',
			byPath: '?path=bible/kt/love.md'
		},
		language,
		organization
	};
}

async function getTranslationWord(params: Record<string, any>, request: Request): Promise<any> {
	const { path, language = 'en', organization, topic } = params;

	// Check for deprecated parameters in the raw URL and provide helpful error
	const url = new URL(request.url);
	const deprecatedParams = ['term', 'rcLink', 'entryLink'];
	const usedDeprecated = deprecatedParams.find((param) => url.searchParams.has(param));
	if (usedDeprecated) {
		throw new Error(
			`Parameter "${usedDeprecated}" is no longer supported. Please use "path" instead. ` +
				`The path parameter accepts clean resource paths (e.g., "bible/kt/love"). ` +
				`Extract the path from the externalReference field in translation word links responses.`
		);
	}

	// Create tracer for this request (moved up for debug use)
	const tracer = new EdgeXRayTracer(`tw-${Date.now()}`, 'fetch-translation-word');

	// If no path provided, return 404 with Table of Contents for discovery
	if (!path) {
		const toc = generateTableOfContents(language, organization);
		const error = new Error('No path provided. Please specify a translation word path (e.g., "bible/kt/love").');
		(error as any).toc = toc;
		throw error;
	}

	// TEMPORARY DEBUG - show what's happening
	if (path === 'debug-info') {
		return {
			debug: true,
			message: 'Debug mode active - returning diagnostic info',
			params: { path, language, organization, topic },
			timestamp: new Date().toISOString()
		};
	}

	// SUPER DEBUG MODE - trace the entire flow
	if (path === 'bible/kt/love-debug') {
		const debugTrace: any[] = [];
		debugTrace.push({ step: 1, message: 'Starting debug trace for love term' });

		try {
			debugTrace.push({ step: 2, message: 'Creating fetcher' });
			const fetcher = new UnifiedResourceFetcher(tracer);

			debugTrace.push({
				step: 3,
				message: 'Calling fetchTranslationWord',
				params: { path: 'bible/kt/love', language, organization }
			});
			const result = await fetcher.fetchTranslationWord('love', language, organization, 'bible/kt/love.md', topic);

			debugTrace.push({ step: 4, message: 'Success!', result });
			return {
				debug: true,
				success: true,
				trace: debugTrace,
				result
			};
		} catch (error: any) {
			debugTrace.push({ step: 'error', message: error.message, debug: error.debug });
			return {
				debug: true,
				success: false,
				trace: debugTrace,
				error: error.message,
				errorDebug: error.debug
			};
		}
	}

	// No-path case is already handled above with 404 + TOC

	// Initialize fetcher with request headers
	const fetcher = new UnifiedResourceFetcher(tracer);
	fetcher.setRequestHeaders(Object.fromEntries(request.headers.entries()));

	// Parse path to extract term and category
	// Path format: "bible/kt/love" or "bible/names/abraham"
	const pathParts = path.split('/');
	const wordKey = pathParts[pathParts.length - 1]; // Last segment is the term
	const searchCategory = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : undefined;

	if (!wordKey) {
		throw new Error('Could not determine term from path');
	}

	try {
		// Use the existing fetchTranslationWord method from UnifiedResourceFetcher
		// Pass the path directly (without .md) as the identifier
		const result = await fetcher.fetchTranslationWord(wordKey, language, organization, path, topic);

		if (!result || !result.content) {
			const toc = generateTableOfContents(language, organization);
			const error = new Error(`Translation word not found: ${wordKey}. See available terms in the table of contents.`);
			(error as any).toc = toc;
			throw error;
		}

		// Parse markdown content for better structure
		const mdContent = result.content;
		const titleMatch = mdContent.match(/^#\s+(.+)$/m);
		const termTitle = titleMatch ? titleMatch[1].trim() : wordKey;

		// Extract definition from markdown - look for Definition section or first paragraph
		let definition = '';
		const defMatch = mdContent.match(/##\s*Definition:?\s*\n\n([\s\S]+?)(?=\n##|$)/i);
		if (defMatch) {
			definition = defMatch[1].trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
		} else {
			// Fallback: extract first paragraph after title
			const lines = mdContent.split('\n');
			let foundTitle = false;
			for (const line of lines) {
				if (line.startsWith('#') && !foundTitle) {
					foundTitle = true;
					continue;
				}
				if (foundTitle && line.trim() && !line.startsWith('#')) {
					definition = line.trim();
					break;
				}
			}
		}

		// Extract category from path or use search category
		const categoryMatch = result.path?.match(/bible\/(kt|names|other)\//);
		const categoryKey = categoryMatch ? categoryMatch[1] : searchCategory || 'other';

		const categoryNames: Record<string, string> = {
			kt: 'Key Terms',
			names: 'Names',
			other: 'Other'
		};

		// Return single article directly (not wrapped in items array)
		// This makes it consistent with translation-academy endpoint
		const article = {
			title: termTitle,
			path: `bible/${categoryKey}/${wordKey}`, // Clean path without .md extension
			definition,
			content: mdContent,
			reference: params.reference || null, // Include if provided
			metadata: {
				resourceType: 'tw',
				subject: result.subject || 'Translation Words', // ✅ FROM DCS CATALOG
				language,
				organization,
				license: 'CC BY-SA 4.0'
			}
		};

		return article;
	} catch (error) {
		// Add trace information to error context
		const trace = fetcher.getTrace();
		const errorMessage = error instanceof Error ? error.message : String(error);
		const debugInfo = (error as any)?.debug;
		let tocInfo = (error as any)?.toc;

		// Preserve structured error data for automatic retry
		const languageVariants = (error as any)?.languageVariants;
		const requestedLanguage = (error as any)?.requestedLanguage;
		const requestedTerm = (error as any)?.requestedTerm;

		// If this is a "not found" error and no TOC was already attached, add one
		if (!tocInfo && (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('no path provided'))) {
			tocInfo = generateTableOfContents(language, organization);
		}

		const enhancedError = new Error(`${errorMessage} (Trace: ${JSON.stringify(trace)})`);
		if (debugInfo) {
			(enhancedError as any).debug = debugInfo;
		}
		if (tocInfo) {
			(enhancedError as any).toc = tocInfo;
		}
		
		// Re-attach structured data for automatic retry (CRITICAL!)
		// Always preserve languageVariants if present (for retry)
		if (languageVariants && languageVariants.length > 0) {
			(enhancedError as any).languageVariants = languageVariants;
		}
		// Always preserve requestedLanguage if present (for error reporting)
		if (requestedLanguage) {
			(enhancedError as any).requestedLanguage = requestedLanguage;
		}
		// Always preserve requestedTerm if present (for error reporting)
		if (requestedTerm) {
			(enhancedError as any).requestedTerm = requestedTerm;
		}
		
		throw enhancedError;
	}
}

export const GET = createSimpleEndpoint({
	name: 'fetch-translation-word-v2',

	params: [
		COMMON_PARAMS.path, // ONLY identifier parameter - clean paths without .md
		COMMON_PARAMS.language,
		COMMON_PARAMS.organization,
		COMMON_PARAMS.category, // Filter by category (kt, names, other)
		COMMON_PARAMS.topic, // Topic filter for tc-ready resources
		COMMON_PARAMS.format
	],

	fetch: getTranslationWord,

	onError: createStandardErrorHandler({
		'No path provided': {
			status: 400,
			message: 'No path provided. Please specify a translation word path (e.g., "bible/kt/love"). Check the table of contents in the response details for available terms.'
		},
		'Translation word not found': {
			status: 404,
			message: 'The requested translation word was not found. Check the table of contents in the response details for available terms.'
		},
		'no longer supported': {
			status: 400,
			message: 'Deprecated parameter used. Please use the "path" parameter instead.'
		},
		'No translation words catalog found': {
			status: 404,
			message: 'No Translation Words catalog available for the requested language/organization.'
		}
	}),

	supportsFormats: true
});

// CORS handler
export const OPTIONS = createCORSHandler();
