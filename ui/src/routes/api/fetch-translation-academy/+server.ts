/**
 * Fetch Translation Academy Endpoint v2
 *
 * ✅ PRODUCTION READY - Uses real DCS data via ZIP fetcher
 *
 * Returns a specific translation academy module by ID or path.
 * Academy articles are linked from Translation Notes via RC links.
 */

import { EdgeXRayTracer } from '$lib/../../../src/functions/edge-xray.js';
import { createStandardErrorHandler } from '$lib/commonErrorHandlers.js';
import { COMMON_PARAMS } from '$lib/commonValidators.js';
import { createCORSHandler, createSimpleEndpoint } from '$lib/simpleEndpoint.js';
import { UnifiedResourceFetcher } from '$lib/unifiedResourceFetcher.js';
import { parseTranslationAcademyRCLink, isTranslationAcademyRCLink } from '$lib/rcLinkParser.js';

/**
 * Fetch a specific translation academy module
 * Uses real markdown content from DCS ZIP archives
 * Supports moduleId, path, and rcLink parameters with priority: rcLink > path > moduleId
 */
async function fetchTranslationAcademy(
	params: Record<string, any>,
	request: Request
): Promise<any> {
	const { path, language = 'en', organization, topic } = params;

	// Check for deprecated parameters in the raw URL
	const url = new URL(request.url);
	const deprecatedParams = ['moduleId', 'rcLink', 'entryLink'];
	const usedDeprecated = deprecatedParams.find((param) => url.searchParams.has(param));
	if (usedDeprecated) {
		throw new Error(
			`Parameter "${usedDeprecated}" is no longer supported. Please use "path" instead. ` +
				`The path parameter accepts clean resource paths (e.g., "translate/figs-metaphor"). ` +
				`Extract the path from the externalReference field in translation notes responses.`
		);
	}

	// Create tracer for this request
	const tracer = new EdgeXRayTracer(`ta-${Date.now()}`, 'fetch-translation-academy');

	// Initialize fetcher with request headers
	const fetcher = new UnifiedResourceFetcher(tracer);
	fetcher.setRequestHeaders(Object.fromEntries(request.headers.entries()));

	// If no path provided, return 404 with Table of Contents for discovery
	if (!path) {
		const toc = {
			type: 'table-of-contents',
			title: 'Translation Academy',
			description: 'Translation training modules organized by category',
			categories: [
				{
					id: 'translate',
					name: 'Translation',
					description: 'Translation principles and techniques',
					exampleModules: ['figs-metaphor', 'figs-idiom', 'translate-names', 'translate-unknown'],
					examplePath: 'translate/figs-metaphor'
				},
				{
					id: 'checking',
					name: 'Checking',
					description: 'Quality assurance and verification',
					exampleModules: ['accuracy-check', 'important-term-check'],
					examplePath: 'checking/accuracy-check'
				},
				{
					id: 'process',
					name: 'Process',
					description: 'Translation workflow and management',
					exampleModules: ['setup-team', 'platforms'],
					examplePath: 'process/setup-team'
				},
				{
					id: 'intro',
					name: 'Introduction',
					description: 'Getting started with translation',
					exampleModules: ['ta-intro', 'translation-guidelines'],
					examplePath: 'intro/ta-intro'
				}
			],
			usage: {
				byPath: '?path=translate/figs-metaphor'
			},
			language,
			organization
		};
		const error = new Error('No path provided. Please specify a translation academy path (e.g., "translate/figs-metaphor").');
		(error as any).toc = toc;
		throw error;
	}

	try {
		// Fetch the specific TA module using the path
		// Path format: "translate/figs-metaphor" or "checking/accuracy-check"
		const result = await fetcher.fetchTranslationAcademy(language, organization, undefined, path, topic);

		// Check if we got content
	if (result.modules && result.modules.length > 0) {
		// Got specific module
		const module = result.modules[0];

		// Extract title from content
		const content = module.markdown || '';
		const titleMatch = content.match(/^#\s+(.+)$/m);
		const title = titleMatch ? titleMatch[1].trim() : path.split('/').pop() || path;

		// Return article directly (consistent with translation-word endpoint)
		return {
			title,
			path, // Clean path without extension (e.g., "translate/figs-metaphor")
			content: module.markdown || '',
			metadata: {
				resourceType: 'ta',
				subject: result.subject || 'Translation Academy', // ✅ FROM DCS CATALOG
				language,
				organization,
				license: 'CC BY-SA 4.0'
			}
		};
	} else {
		// Module not found - return 404 with TOC
		const toc = {
			type: 'table-of-contents',
			title: 'Translation Academy',
			description: 'Translation training modules organized by category',
			categories: [
				{
					id: 'translate',
					name: 'Translation',
					description: 'Translation principles and techniques',
					exampleModules: ['figs-metaphor', 'figs-idiom', 'translate-names', 'translate-unknown'],
					examplePath: 'translate/figs-metaphor'
				},
				{
					id: 'checking',
					name: 'Checking',
					description: 'Quality assurance and verification',
					exampleModules: ['accuracy-check', 'important-term-check'],
					examplePath: 'checking/accuracy-check'
				},
				{
					id: 'process',
					name: 'Process',
					description: 'Translation workflow and management',
					exampleModules: ['setup-team', 'platforms'],
					examplePath: 'process/setup-team'
				},
				{
					id: 'intro',
					name: 'Introduction',
					description: 'Getting started with translation',
					exampleModules: ['ta-intro', 'translation-guidelines'],
					examplePath: 'intro/ta-intro'
				}
			],
			usage: {
				byPath: '?path=translate/figs-metaphor'
			},
			language,
			organization
		};
		const error = new Error(
			`Translation Academy module not found: ${path}. See available modules in the table of contents.`
		);
		(error as any).toc = toc;
		throw error;
	}
	} catch (error) {
		// Add trace information and TOC to error context
		const trace = fetcher.getTrace();
		const errorMessage = error instanceof Error ? error.message : String(error);
		let tocInfo = (error as any)?.toc;

		// Preserve structured error data for automatic retry
		const languageVariants = (error as any)?.languageVariants;
		const requestedLanguage = (error as any)?.requestedLanguage;
		const requestedPath = (error as any)?.requestedPath;
		const requestedModule = (error as any)?.requestedModule;

		// If this is a "not found" error and no TOC was already attached, add one
		if (!tocInfo && (errorMessage.toLowerCase().includes('not found') || errorMessage.toLowerCase().includes('no path provided'))) {
			tocInfo = {
				type: 'table-of-contents',
				title: 'Translation Academy',
				description: 'Translation training modules organized by category',
				categories: [
					{
						id: 'translate',
						name: 'Translation',
						description: 'Translation principles and techniques',
						exampleModules: ['figs-metaphor', 'figs-idiom', 'translate-names', 'translate-unknown'],
						examplePath: 'translate/figs-metaphor'
					},
					{
						id: 'checking',
						name: 'Checking',
						description: 'Quality assurance and verification',
						exampleModules: ['accuracy-check', 'important-term-check'],
						examplePath: 'checking/accuracy-check'
					},
					{
						id: 'process',
						name: 'Process',
						description: 'Translation workflow and management',
						exampleModules: ['setup-team', 'platforms'],
						examplePath: 'process/setup-team'
					},
					{
						id: 'intro',
						name: 'Introduction',
						description: 'Getting started with translation',
						exampleModules: ['ta-intro', 'translation-guidelines'],
						examplePath: 'intro/ta-intro'
					}
				],
				usage: {
					byPath: '?path=translate/figs-metaphor'
				},
				language,
				organization
			};
		}

		const enhancedError = new Error(`${errorMessage} (Trace: ${JSON.stringify(trace)})`);
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
		// Always preserve requestedPath if present (for error reporting)
		if (requestedPath) {
			(enhancedError as any).requestedPath = requestedPath;
		}
		// Always preserve requestedModule if present (for error reporting)
		if (requestedModule) {
			(enhancedError as any).requestedModule = requestedModule;
		}
		
		throw enhancedError;
	}
}

// Create the endpoint with all our consistent utilities
export const GET = createSimpleEndpoint({
	name: 'fetch-translation-academy-v2',

	params: [
		COMMON_PARAMS.path, // ONLY identifier parameter - clean paths without extensions
		COMMON_PARAMS.language,
		COMMON_PARAMS.organization,
		COMMON_PARAMS.topic, // Topic filter for tc-ready resources
		COMMON_PARAMS.format
	],

	fetch: fetchTranslationAcademy,

	onError: createStandardErrorHandler({
		'No path provided': {
			status: 400,
			message: 'No path provided. Please specify a translation academy path (e.g., "translate/figs-metaphor"). Check the table of contents in the response details for available modules.'
		},
		'Translation Academy module not found': {
			status: 404,
			message: 'The requested translation academy module was not found. Check the table of contents in the response details for available modules.'
		},
		'no longer supported': {
			status: 400,
			message: 'Deprecated parameter used. Please use the "path" parameter instead.'
		}
	}),

	// Support passthrough for markdown
	supportsFormats: ['json', 'md', 'markdown']
});

// CORS handler
export const OPTIONS = createCORSHandler();
