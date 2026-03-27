import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EdgeXRayTracer } from '../../../../../src/functions/edge-xray.js';
import { normalizeReference } from '../../../../../src/utils/book-codes.js';

export const POST: RequestHandler = async ({ request, fetch: eventFetch }) => {
	const startTime = Date.now();
	const { promptName, parameters } = await request.json();
	let { reference } = parameters;
	const language = parameters.language ?? 'en';

	// Normalize reference to use 3-letter book codes
	// Converts "Tito 3:11-15" → "TIT 3:11-15", "Jonah 1:1" → "JON 1:1", etc.
	if (reference) {
		const originalRef = reference;
		reference = normalizeReference(reference);
		if (reference !== originalRef) {
			console.log(`[execute-prompt] Normalized reference: "${originalRef}" → "${reference}"`);
		}
	}

	// Create X-Ray tracer for this prompt execution
	const tracer = new EdgeXRayTracer(`execute-prompt:${promptName}`, `/api/execute-prompt`);

	// Create a tracked fetch wrapper that uses event.fetch (supports relative URLs)
	// This wrapper extracts X-Ray traces from responses and merges them into the main tracer
	const trackedFetchCall = async (url: string) => {
		const fetchStartTime =
			typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

		try {
			const response = await eventFetch(url);
			const now =
				typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
			const duration = Math.max(1, Math.round(now - fetchStartTime));

			// Extract X-Ray trace from response header if available
			const xrayTraceHeader = response.headers.get('X-XRay-Trace');
			if (xrayTraceHeader) {
				try {
					const cleaned = xrayTraceHeader.replace(/\s+/g, '');
					const nestedTrace = JSON.parse(atob(cleaned));

					// Merge only internal cache calls from the nested trace
					// HTTP calls to /api/fetch-* endpoints are just transport, not cache operations
					if (nestedTrace.apiCalls && Array.isArray(nestedTrace.apiCalls)) {
						for (const apiCall of nestedTrace.apiCalls) {
							// Only merge internal:// cache calls
							// Skip HTTP calls to /api/ endpoints as they're not cache operations
							if (apiCall.url && apiCall.url.startsWith('internal://')) {
								tracer.addApiCall({
									url: apiCall.url,
									duration: apiCall.duration || 0,
									status: apiCall.status || 200,
									size: apiCall.size || 0,
									cached: apiCall.cached === true // Only true if explicitly true
								});
							}
						}
					}
				} catch (e) {
					// If parsing fails, just log and continue
					console.warn('[execute-prompt] Failed to parse X-Ray trace from response:', e);
				}
			} else {
				// No X-Ray trace in response - add the HTTP call itself
				// Extract cache status from response headers
				const cacheStatus = response.headers.get('X-Cache-Status')?.toLowerCase();
				const isCached = cacheStatus === 'hit';

				tracer.addApiCall({
					url,
					duration,
					status: response.status,
					size: parseInt(response.headers.get('content-length') || '0', 10),
					cached: isCached
				});
			}

			return response;
		} catch (error) {
			const now =
				typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
			const duration = Math.max(1, Math.round(now - fetchStartTime));

			tracer.addApiCall({
				url,
				duration,
				status: 0, // Network error
				size: 0,
				cached: false
			});

			throw error;
		}
	};

	console.log(
		`[execute-prompt] Starting prompt execution: ${promptName} for ${reference} (${language})`
	);

	try {
		let result;
		switch (promptName) {
			case 'translation-helps-report':
				console.log('[execute-prompt] Executing translation-helps-report (CONDENSED)');
				result = await executeTranslationHelpsPrompt(
					reference,
					language,
					trackedFetchCall,
					tracer,
					true // condensed = true
				);
				break;

			case 'translation-helps-for-passage':
				console.log('[execute-prompt] Executing translation-helps-for-passage (FULL)');
				result = await executeTranslationHelpsPrompt(
					reference,
					language,
					trackedFetchCall,
					tracer,
					false // condensed = false (full content)
				);
				break;

			case 'get-translation-words-for-passage':
				console.log('[execute-prompt] Executing get-translation-words-for-passage');
				result = await executeWordsPrompt(reference, language, trackedFetchCall, tracer);
				break;

			case 'get-translation-academy-for-passage':
				console.log('[execute-prompt] Executing get-translation-academy-for-passage');
				result = await executeAcademyPrompt(reference, language, trackedFetchCall, tracer);
				break;

			default:
				console.error('[execute-prompt] Unknown prompt:', promptName);
				return json({ error: 'Unknown prompt' }, { status: 400 });
		}

		// Trace is finalized when getTrace() is called

		// Add response time header
		const responseTime = Date.now() - startTime;
		// Extract data from Response if needed, otherwise use result directly
		let data = result;
		if (result instanceof Response) {
			data = await result.json();
		}

		// Build trace data for headers
		const traceData = tracer.getTrace();
		const headers: Record<string, string> = {
			'X-Response-Time': `${responseTime}ms`
		};

		// Add X-Ray trace headers if available
		if (traceData) {
			// Calculate cache status based on internal cache calls only
			const apiCalls = traceData.apiCalls || [];
			const internalCalls = apiCalls.filter((call: any) => call.url?.startsWith('internal://'));

			// Calculate cache stats for internal calls only
			const internalHits = internalCalls.filter((call: any) => call.cached).length;
			const internalMisses = internalCalls.filter((call: any) => call.cached === false).length;
			const totalInternal = internalCalls.length;

			// Recalculate cacheStats to only include internal calls
			const recalculatedCacheStats = {
				hits: internalHits,
				misses: internalMisses,
				total: totalInternal
			};

			// Update traceData with recalculated cache stats
			const updatedTraceData = {
				...traceData,
				cacheStats: recalculatedCacheStats
			};

			let cacheStatus = 'miss';
			if (totalInternal === 0) {
				// No internal cache calls - check overall stats
				if (recalculatedCacheStats.hits > 0 && recalculatedCacheStats.misses === 0) {
					cacheStatus = 'hit';
				} else if (recalculatedCacheStats.hits > 0 && recalculatedCacheStats.misses > 0) {
					cacheStatus = 'partial';
				}
			} else if (internalHits > 0 && internalMisses === 0) {
				// All internal cache calls were hits
				cacheStatus = 'hit';
			} else if (internalHits > 0 && internalMisses > 0) {
				// Some internal cache hits, some misses
				cacheStatus = 'partial';
			} else if (internalHits === 0 && totalInternal > 0) {
				// All internal cache calls were misses
				cacheStatus = 'miss';
			}

			headers['X-Cache-Status'] = cacheStatus;
			headers['X-XRay-Trace'] = btoa(JSON.stringify(updatedTraceData));
			if (traceData.traceId) {
				headers['X-Trace-Id'] = traceData.traceId;
			}
		}

		// Create new response with headers
		return json(data, { headers });
	} catch (error) {
		console.error('[execute-prompt] Prompt execution error:', error);
		const responseTime = Date.now() - startTime;

		const headers: Record<string, string> = {
			'X-Response-Time': `${responseTime}ms`
		};

		// Add trace even on error
		const traceData = tracer.getTrace();
		if (traceData) {
			// Recalculate cacheStats to only include internal calls
			const apiCalls = traceData.apiCalls || [];
			const internalCalls = apiCalls.filter((call: any) => call.url?.startsWith('internal://'));
			const internalHits = internalCalls.filter((call: any) => call.cached).length;
			const internalMisses = internalCalls.filter((call: any) => call.cached === false).length;
			const totalInternal = internalCalls.length;

			const updatedTraceData = {
				...traceData,
				cacheStats: {
					hits: internalHits,
					misses: internalMisses,
					total: totalInternal
				}
			};

			headers['X-XRay-Trace'] = btoa(JSON.stringify(updatedTraceData));
			if (traceData.traceId) {
				headers['X-Trace-Id'] = traceData.traceId;
			}
		}

		// Check if error has structured recovery data (languageVariants, requestedLanguage, etc.)
		const errorDetails: any = (error as any)?.details;
		const errorResponse: any = {
			error: 'Failed to execute prompt',
			message: error instanceof Error ? error.message : String(error)
		};

		// Preserve structured error data for auto-retry mechanism
		if (errorDetails) {
			errorResponse.details = errorDetails;
			console.log(
				'[execute-prompt] Preserving error details for auto-retry:',
				Object.keys(errorDetails)
			);
		}

		// Determine appropriate status code
		let status = 500;
		if (errorDetails?.validBookCodes && errorDetails?.invalidCode) {
			status = 400; // Bad Request - invalid book code
			console.log('[execute-prompt] Setting status 400 (invalid book code)');
		} else if (errorDetails?.verseNotFound) {
			status = 404; // Verse not found
			console.log('[execute-prompt] Setting status 404 (verse not found)');
		} else if (errorDetails?.hasContextOnly) {
			status = 404; // No verse-specific notes
			console.log('[execute-prompt] Setting status 404 (context-only notes, no verse-specific)');
		} else if (errorDetails?.languageVariants) {
			status = 404; // Resource not found but alternatives exist
			console.log('[execute-prompt] Setting status 404 (language variants available)');
		} else if (errorDetails?.requestedLanguage) {
			status = 404; // Language not supported
			console.log('[execute-prompt] Setting status 404 (language not supported)');
		}

		return json(errorResponse, { status, headers });
	}
};

async function executeTranslationHelpsPrompt(
	reference: string,
	language: string,
	trackedFetchCall: (url: string) => Promise<Response>,
	tracer: EdgeXRayTracer,
	condensed: boolean = false // NEW: If true, strip full content from words/notes/academy
) {
	const results: any = {
		scripture: null,
		questions: null,
		words: [],
		notes: null,
		academyArticles: []
	};

	// Track language variant errors to propagate for auto-retry
	let languageVariantError: any = null;

	// Track invalid book code errors to provide helpful feedback
	let invalidBookCodeError: any = null;

	// Track verse not found errors to provide clear feedback
	let verseNotFoundError: any = null;

	// Step 1: Fetch scripture
	try {
		const scriptureRes = await trackedFetchCall(
			`/api/fetch-scripture?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (scriptureRes.ok) {
			const scriptureData = await scriptureRes.json();
			console.log('Scripture response keys:', Object.keys(scriptureData));

			// Extract scripture data with full citation preserved
			// Structure is: { scripture: [{text, translation, citation}] }
			if (scriptureData.scripture && Array.isArray(scriptureData.scripture)) {
				console.log(`Found ${scriptureData.scripture.length} translations`);
				if (scriptureData.scripture.length > 0) {
					// Preserve full scripture object including citation
					const scripture = scriptureData.scripture[0];
					results.scripture = {
						text: scripture.text,
						translation: scripture.translation,
						citation: scripture.citation // ✅ PRESERVE CITATION
					};
					console.log(`Extracted scripture with citation:`, scripture.citation);
				}
			} else if (scriptureData.versions) {
				const versions = Object.values(scriptureData.versions);
				if (versions.length > 0) {
					const firstVersion: any = versions[0];
					if (firstVersion.verses && firstVersion.verses.length > 0) {
						results.scripture = {
							text: firstVersion.verses.map((v: any) => v.text).join(' ')
						};
					}
				}
			} else {
				console.log('Unexpected scripture data format:', Object.keys(scriptureData));
			}
		} else {
			// Check if error response has verse not found, language variants, invalid book code, OR is a language not supported error
			const errorData = await scriptureRes.json().catch(() => ({}));
			console.log(
				'[execute-prompt] Scripture returned non-OK status:',
				scriptureRes.status,
				'errorData:',
				JSON.stringify(errorData)
			);
			if (errorData.details?.verseNotFound) {
				// Verse not found - capture for immediate error response
				console.log('[execute-prompt] Scripture error - verse not found:', {
					book: errorData.details.requestedBook,
					chapter: errorData.details.chapter,
					verse: errorData.details.verse
				});
				verseNotFoundError = errorData;
			} else if (errorData.details?.validBookCodes && errorData.details?.invalidCode) {
				// Invalid book code - capture for immediate error response
				console.log(
					'[execute-prompt] Scripture error - invalid book code:',
					errorData.details.invalidCode
				);
				invalidBookCodeError = errorData;
			} else if (errorData.details?.languageVariants) {
				console.log(
					'[execute-prompt] Scripture error has language variants:',
					errorData.details.languageVariants
				);
				languageVariantError = errorData;
			} else if (errorData.details?.requestedLanguage) {
				// Language not supported (no variants available)
				console.log(
					'[execute-prompt] Scripture error - language not supported:',
					errorData.details.requestedLanguage
				);
				languageVariantError = errorData;
			} else {
				console.log('[execute-prompt] Scripture error has no recovery data - will return empty');
			}
		}
	} catch (e) {
		console.error('Failed to fetch scripture:', e);
	}

	// Step 2: Fetch questions
	try {
		const questionsRes = await trackedFetchCall(
			`/api/fetch-translation-questions?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (questionsRes.ok) {
			const questionsData = await questionsRes.json();
			// Preserve full questions response including citations
			// Each item should have its own citation inline
			results.questions = {
				reference: questionsData.reference,
				citation: questionsData.citation, // ✅ Top-level citation for single-org requests
				citations: questionsData.citations, // ✅ Citations array for multi-org requests
				items: questionsData.items, // ✅ Items already have inline citations from core service
				count: questionsData.items?.length || questionsData.metadata?.totalCount || 0
			};
		} else {
			// Check if error response has language variants OR is a language not supported error
			const errorData = await questionsRes.json().catch(() => ({}));
			if (errorData.details?.languageVariants && !languageVariantError) {
				console.log(
					'[execute-prompt] Questions error has language variants:',
					errorData.details.languageVariants
				);
				languageVariantError = errorData;
			} else if (errorData.details?.requestedLanguage && !languageVariantError) {
				console.log(
					'[execute-prompt] Questions error - language not supported:',
					errorData.details.requestedLanguage
				);
				languageVariantError = errorData;
			}
		}
	} catch (e) {
		console.error('Failed to fetch questions:', e);
	}

	// Step 3: Fetch word links
	let wordLinks: any[] = [];
	try {
		const linksRes = await trackedFetchCall(
			`/api/fetch-translation-word-links?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (linksRes.ok) {
			const linksData = await linksRes.json();
			wordLinks = linksData.translationWordLinks || linksData.items || [];
			console.log(`Found ${wordLinks.length} word links for ${reference}`);
		} else {
			// Check if error response has language variants OR is a language not supported error
			const errorData = await linksRes.json().catch(() => ({}));
			if (errorData.details?.languageVariants && !languageVariantError) {
				console.log(
					'[execute-prompt] Word links error has language variants:',
					errorData.details.languageVariants
				);
				languageVariantError = errorData;
			} else if (errorData.details?.requestedLanguage && !languageVariantError) {
				console.log(
					'[execute-prompt] Word links error - language not supported:',
					errorData.details.requestedLanguage
				);
				languageVariantError = errorData;
			}
		}
	} catch (e) {
		console.error('Failed to fetch word links:', e);
	}

	// Step 4: Fetch word articles for each term (extract titles)
	console.log(`Fetching word articles for ${wordLinks.length} terms (limiting to 10)`);
	for (const link of wordLinks.slice(0, 10)) {
		// Limit to first 10
		try {
			// Extract path from externalReference structure
			const externalRef = link.externalReference;
			if (!externalRef || !externalRef.path) {
				console.warn(`Skipping word link - no externalReference.path:`, link);
				continue;
			}

			const path = externalRef.path;
			const category = externalRef.category;
			const term = link.quote || path.split('/').pop(); // Use quote or extract from path

			// Log the word link structure
			console.log(`Word link for "${term}":`, {
				term,
				path,
				category,
				quote: link.quote
			});

			// Use the path parameter from externalReference
			const url = `/api/fetch-translation-word?path=${encodeURIComponent(path)}&language=${language}`;
			console.log(`Fetching word article: ${url}`);
			const wordRes = await trackedFetchCall(url);
			if (wordRes.ok) {
				const wordData = await wordRes.json();

				// Check if it's an error response
				if (wordData.error) {
					console.error(`Word fetch with path returned error for "${term}"`);

					// Failed - add with term as title
					const errorWordEntry: any = {
						term: term,
						title: term,
						category: category,
						path: path,
						error: true
					};
					if (!condensed) {
						errorWordEntry.content = '';
					}
					results.words.push(errorWordEntry);
					continue;
				}

				// Extract title from markdown content (first H1)
				let title = term;

				// API now returns direct article format with title field
				if (wordData.title) {
					title = wordData.title;
					console.log(`✅ Extracted title from wordData.title: "${title}"`);
				} else if (wordData.content) {
					// Fallback to extracting from content
					const titleMatch = wordData.content.match(/^#\s+(.+)$/m);
					if (titleMatch) {
						title = titleMatch[1].trim();
						console.log(`✅ Extracted title from H1: "${title}"`);
					}
				}

				console.log(`Fetched word: "${term}" → title: "${title}"`);

				// For condensed mode, omit content field to reduce response size
				const wordEntry: any = {
					term: term,
					title: title,
					category: category,
					path: path
				};

				// Only include full content if NOT condensed
				if (!condensed) {
					wordEntry.content = wordData.content || '';
				}

				results.words.push(wordEntry);
			} else {
				// HTTP error - still add term
				const httpErrorWordEntry: any = {
					term: term,
					title: term,
					category: category,
					path: path,
					error: true
				};
				if (!condensed) {
					httpErrorWordEntry.content = '';
				}
				results.words.push(httpErrorWordEntry);
			}
		} catch (e) {
			const externalRef = link.externalReference;
			const term = link.quote || externalRef?.path?.split('/').pop() || 'unknown';
			console.error(`Failed to fetch word article for "${term}":`, e);
		}
	}
	console.log(`Total words fetched: ${results.words.length}`);

	// Step 5: Fetch notes
	try {
		const notesRes = await trackedFetchCall(
			`/api/fetch-translation-notes?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (notesRes.ok) {
			const notesData = await notesRes.json();
			// API returns verseNotes + contextNotes (not legacy `items`). Map into prompt shape
			// and optionally condense full Note text to notePreview for translation-helps-report.
			results.notes = shapeNotesForPrompt(notesData, condensed);
		} else {
			// Check for context-only error (no verse-specific notes)
			const errorData = await notesRes.json().catch(() => ({}));
			if (errorData.details?.hasContextOnly) {
				console.log('[execute-prompt] Notes error - context only (no verse-specific notes)');
				// Don't set results.notes at all - keep it undefined/null
				// This will be caught by verseNotFoundError check later
			}
		}
	} catch (e) {
		console.error('Failed to fetch notes:', e);
	}

	// Step 6: Fetch academy articles from externalReference paths
	const academyPaths = extractSupportReferences(results.notes);
	console.log(`Found ${academyPaths.length} academy reference paths (limiting to 5)`);
	for (const path of academyPaths.slice(0, 5)) {
		// Limit to first 5
		try {
			const academyRes = await trackedFetchCall(
				`/api/fetch-translation-academy?path=${encodeURIComponent(path)}&language=${language}`
			);
			if (academyRes.ok) {
				const academyData = await academyRes.json();

				// Check if it's an error response
				if (academyData.error) {
					console.error(`Academy fetch failed for path: ${path}`);

					// Extract module ID from path
					const moduleId = path.split('/').pop() || '';

					// Failed - add with error flag
					const errorAcademyEntry: any = {
						moduleId: moduleId,
						title: moduleId,
						path: path,
						category: path.split('/')[0] || '',
						error: true
					};
					if (!condensed) {
						errorAcademyEntry.content = '';
					}
					results.academyArticles.push(errorAcademyEntry);
					continue;
				}

				// API now returns direct article format with title field
				const moduleId = academyData.moduleId || path.split('/').pop() || '';
				let title = moduleId;

				if (academyData.title) {
					title = academyData.title;
					console.log(`✅ Extracted title from academyData.title: "${title}"`);
				} else if (academyData.content) {
					// Fallback to extracting from content
					const titleMatch = academyData.content.match(/^#\s+(.+)$/m);
					if (titleMatch) {
						title = titleMatch[1].trim();
						console.log(`✅ Extracted title from H1: "${title}"`);
					}
				}

				console.log(`Fetched academy article: ${path} → title: "${title}"`);

				// For condensed mode, omit content field to reduce response size
				const academyEntry: any = {
					moduleId: moduleId,
					title: title,
					path: academyData.path || path,
					category: academyData.category || path.split('/')[0] || ''
				};

				// Only include full content if NOT condensed
				if (!condensed) {
					academyEntry.content = academyData.content || '';
				}

				results.academyArticles.push(academyEntry);
			} else {
				// HTTP error - still add with moduleId from path
				const moduleId = path.split('/').pop() || '';
				const httpErrorAcademyEntry: any = {
					moduleId: moduleId,
					title: moduleId,
					path: path,
					category: path.split('/')[0] || '',
					error: true
				};
				if (!condensed) {
					httpErrorAcademyEntry.content = '';
				}
				results.academyArticles.push(httpErrorAcademyEntry);
			}
		} catch (e) {
			console.error(`Failed to fetch academy article for ${path}:`, e);
		}
	}
	console.log(`Total academy articles fetched: ${results.academyArticles.length}`);

	// Check for invalid book code errors FIRST - these should always be thrown
	// Invalid book code is a user error that needs immediate correction
	// Verse not found errors should be thrown immediately (verse doesn't exist in available resources)
	// BUT: Check if we have actual verse-specific data vs only intro/context notes
	if (verseNotFoundError) {
		// With new shape: verseNotes array contains ONLY verse-specific notes
		// contextNotes array contains ONLY book/chapter introductions
		const hasVerseSpecificNotes = results.notes?.verseNotes?.length > 0;
		const hasVerseSpecificQuestions = results.questions?.items?.length > 0;
		const hasVerseSpecificWords = results.words?.length > 0;

		// If we only have intro/context notes (no verse-specific data), throw the verse not found error
		if (!hasVerseSpecificNotes && !hasVerseSpecificQuestions && !hasVerseSpecificWords) {
			console.log(
				'[execute-prompt] Only intro/context notes found, no verse-specific data - propagating verse not found error'
			);

			// Build an explicit, LLM-friendly error message
			const book = verseNotFoundError.details?.requestedBook || 'Unknown';
			const chapter = verseNotFoundError.details?.chapter || '?';
			const verse = verseNotFoundError.details?.verse || '?';
			const language = verseNotFoundError.details?.language || 'unknown';

			const explicitMessage =
				`⚠️ VERSE DOES NOT EXIST: ${book} ${chapter}:${verse} is not a valid verse reference.\n\n` +
				`This verse was not found in the ${language} resources. This may be because:\n` +
				`- The verse number exceeds the chapter length\n` +
				`- The chapter doesn't have this many verses\n` +
				`- The reference is incorrect\n\n` +
				`DO NOT fabricate or make up scripture text for this verse. The verse does not exist.`;

			const error: any = new Error(explicitMessage);
			error.details = verseNotFoundError.details;
			error.details.explicitError = 'VERSE_DOES_NOT_EXIST';
			throw error;
		} else {
			console.log(
				'[execute-prompt] Verse not found but we have verse-specific notes/questions/words - returning partial data'
			);
		}
	}

	// Invalid book code errors should be thrown immediately
	if (invalidBookCodeError) {
		console.log('[execute-prompt] Propagating invalid book code error');
		const error: any = new Error(invalidBookCodeError.error || 'Invalid book code provided');
		error.details = invalidBookCodeError.details;
		throw error;
	}

	// Only throw language variant error if we have NO successful results
	// If some tools succeeded, return partial results instead
	const hasAnyData =
		results.scripture?.text ||
		results.questions?.items?.length > 0 ||
		results.words?.length > 0 ||
		results.notes?.verseNotes?.length > 0 || // ← NEW SHAPE: check verseNotes, not items
		results.academyArticles?.length > 0;

	if (languageVariantError && !hasAnyData) {
		console.log(
			'[execute-prompt] Propagating language variant error for auto-retry (no data found)'
		);
		const error: any = new Error(
			languageVariantError.error || 'Resources not found for requested language'
		);
		error.details = languageVariantError.details;
		throw error;
	} else if (languageVariantError && hasAnyData) {
		console.log('[execute-prompt] Returning partial results despite language variant error');
	}

	return json(results);
}

async function executeWordsPrompt(
	reference: string,
	language: string,
	trackedFetchCall: (url: string) => Promise<Response>,
	_tracer: EdgeXRayTracer
) {
	console.log('[executeWordsPrompt] Reusing translation-helps logic for word links and articles');

	const results: any = {
		words: []
	};

	// Track language variant errors to propagate for auto-retry
	let languageVariantError: any = null;

	// Track invalid book code errors to provide helpful feedback
	let invalidBookCodeError: any = null;

	// Step 1: Fetch word links (same as main prompt)
	let wordLinks: any[] = [];
	try {
		const linksRes = await trackedFetchCall(
			`/api/fetch-translation-word-links?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (linksRes.ok) {
			const linksData = await linksRes.json();
			wordLinks = linksData.translationWordLinks || linksData.items || [];
			console.log(`Found ${wordLinks.length} word links for ${reference}`);
		} else {
			// Check if error response has invalid book code or language variants
			const errorData = await linksRes.json().catch(() => ({}));
			if (errorData.details?.validBookCodes && errorData.details?.invalidCode) {
				console.log(
					'[execute-prompt] Word links error - invalid book code:',
					errorData.details.invalidCode
				);
				invalidBookCodeError = errorData;
			} else if (errorData.details?.languageVariants) {
				console.log(
					'[execute-prompt] Word links error has language variants:',
					errorData.details.languageVariants
				);
				languageVariantError = errorData;
			}
		}
	} catch (e) {
		console.error('Failed to fetch word links:', e);
	}

	// Step 2: Fetch word articles (same logic as main prompt)
	console.log(`Fetching word articles for ${wordLinks.length} terms (limiting to 10)`);
	for (const link of wordLinks.slice(0, 10)) {
		try {
			// Extract path from externalReference structure
			const externalRef = link.externalReference;
			if (!externalRef || !externalRef.path) {
				console.warn(`Skipping word link - no externalReference.path:`, link);
				continue;
			}

			const path = externalRef.path;
			const category = externalRef.category;
			const term = link.quote || path.split('/').pop();

			console.log(`Word link for "${term}":`, {
				term,
				path,
				category,
				quote: link.quote
			});

			const url = `/api/fetch-translation-word?path=${encodeURIComponent(path)}&language=${language}`;
			console.log(`Fetching word article: ${url}`);
			const wordRes = await trackedFetchCall(url);
			if (wordRes.ok) {
				const wordData = await wordRes.json();

				if (wordData.error) {
					console.error(`Word fetch failed for "${term}"`);
					results.words.push({
						term: term,
						title: term,
						category: category,
						content: '',
						path: path,
						error: true
					});
					continue;
				}

				let title = term;
				if (wordData.title) {
					title = wordData.title;
					console.log(`✅ Extracted title from wordData.title: "${title}"`);
				} else if (wordData.content) {
					const titleMatch = wordData.content.match(/^#\s+(.+)$/m);
					if (titleMatch) {
						title = titleMatch[1].trim();
						console.log(`✅ Extracted title from H1: "${title}"`);
					}
				}

				console.log(`Fetched word: "${term}" → title: "${title}"`);
				results.words.push({
					term: term,
					title: title,
					category: category,
					content: wordData.content || '',
					path: path
				});
			} else {
				results.words.push({
					term: term,
					title: term,
					category: category,
					content: '',
					path: path,
					error: true
				});
			}
		} catch (e) {
			const externalRef = link.externalReference;
			const term = link.quote || externalRef?.path?.split('/').pop() || 'unknown';
			console.error(`Failed to fetch word article for "${term}":`, e);
		}
	}
	console.log(`Total words fetched: ${results.words.length}`);

	// Check for invalid book code errors FIRST
	if (invalidBookCodeError) {
		console.log('[execute-prompt] Propagating invalid book code error (words prompt)');
		const error: any = new Error(invalidBookCodeError.error || 'Invalid book code provided');
		error.details = invalidBookCodeError.details;
		throw error;
	}

	// Only throw language variant error if we have NO successful results
	const hasAnyData = results.words?.length > 0;

	if (languageVariantError && !hasAnyData) {
		console.log(
			'[execute-prompt] Propagating language variant error for auto-retry (words prompt - no data found)'
		);
		const error: any = new Error(
			languageVariantError.error || 'Resources not found for requested language'
		);
		error.details = languageVariantError.details;
		throw error;
	} else if (languageVariantError && hasAnyData) {
		console.log('[execute-prompt] Returning partial word results despite language variant error');
	}

	return json(results);
}

async function executeAcademyPrompt(
	reference: string,
	language: string,
	trackedFetchCall: (url: string) => Promise<Response>,
	_tracer: EdgeXRayTracer
) {
	console.log(
		'[executeAcademyPrompt] Reusing translation-helps logic for notes and academy articles'
	);

	const results: any = {
		academyArticles: []
	};

	// Track language variant errors to propagate for auto-retry
	let languageVariantError: any = null;

	// Track invalid book code errors to provide helpful feedback
	let invalidBookCodeError: any = null;

	// Internal variable for fetching notes (not included in results)
	let notesData: any = null;

	// Step 1: Fetch notes (same as main prompt, but not included in results)
	try {
		const notesRes = await trackedFetchCall(
			`/api/fetch-translation-notes?reference=${encodeURIComponent(reference)}&language=${language}`
		);
		if (notesRes.ok) {
			notesData = await notesRes.json();
		} else {
			// Check if error response has invalid book code, language variants, OR is a language not supported error
			const errorData = await notesRes.json().catch(() => ({}));
			console.log(
				'[execute-prompt] Notes returned non-OK status:',
				notesRes.status,
				'errorData:',
				JSON.stringify(errorData)
			);
			if (errorData.details?.validBookCodes && errorData.details?.invalidCode) {
				console.log(
					'[execute-prompt] Notes error - invalid book code:',
					errorData.details.invalidCode
				);
				invalidBookCodeError = errorData;
			} else if (errorData.details?.languageVariants) {
				console.log(
					'[execute-prompt] Notes error has language variants:',
					errorData.details.languageVariants
				);
				languageVariantError = errorData;
			} else if (errorData.details?.requestedLanguage) {
				// Language not supported (no variants available)
				console.log(
					'[execute-prompt] Notes error - language not supported:',
					errorData.details.requestedLanguage
				);
				languageVariantError = errorData;
			} else if (errorData.details?.hasContextOnly) {
				console.log('[execute-prompt] Notes error - context only (no verse-specific notes)');
				// Don't set notesData - keep it null
				// This will be caught by verseNotFoundError check later
			} else {
				console.log('[execute-prompt] Notes error has no recovery data - will return empty');
			}
		}
	} catch (e) {
		console.error('Failed to fetch notes:', e);
	}

	// Step 2: Fetch academy articles from externalReference paths (same logic as main prompt)
	const academyPaths = extractSupportReferences(notesData);
	console.log(`Found ${academyPaths.length} academy reference paths (limiting to 5)`);
	for (const path of academyPaths.slice(0, 5)) {
		try {
			const academyRes = await trackedFetchCall(
				`/api/fetch-translation-academy?path=${encodeURIComponent(path)}&language=${language}`
			);
			if (academyRes.ok) {
				const academyData = await academyRes.json();

				if (academyData.error) {
					console.error(`Academy fetch failed for path: ${path}`);
					const moduleId = path.split('/').pop() || '';
					results.academyArticles.push({
						moduleId: moduleId,
						title: moduleId,
						content: '',
						path: path,
						category: path.split('/')[0] || '',
						error: true
					});
					continue;
				}

				const moduleId = academyData.moduleId || path.split('/').pop() || '';
				let title = moduleId;

				if (academyData.title) {
					title = academyData.title;
					console.log(`✅ Extracted title from academyData.title: "${title}"`);
				} else if (academyData.content) {
					const titleMatch = academyData.content.match(/^#\s+(.+)$/m);
					if (titleMatch) {
						title = titleMatch[1].trim();
						console.log(`✅ Extracted title from H1: "${title}"`);
					}
				}

				console.log(`Fetched academy article: ${path} → title: "${title}"`);
				results.academyArticles.push({
					moduleId: moduleId,
					title: title,
					content: academyData.content || '',
					path: academyData.path || path,
					category: academyData.category || path.split('/')[0] || ''
				});
			} else {
				const moduleId = path.split('/').pop() || '';
				results.academyArticles.push({
					moduleId: moduleId,
					title: moduleId,
					content: '',
					path: path,
					category: path.split('/')[0] || '',
					error: true
				});
			}
		} catch (e) {
			console.error(`Failed to fetch academy article for ${path}:`, e);
		}
	}
	console.log(`Total academy articles fetched: ${results.academyArticles.length}`);

	// Check for invalid book code errors FIRST
	if (invalidBookCodeError) {
		console.log('[execute-prompt] Propagating invalid book code error (academy prompt)');
		const error: any = new Error(invalidBookCodeError.error || 'Invalid book code provided');
		error.details = invalidBookCodeError.details;
		throw error;
	}

	// Only throw language variant error if we have NO successful results
	const hasAnyData = results.academyArticles?.length > 0;

	if (languageVariantError && !hasAnyData) {
		console.log(
			'[execute-prompt] Propagating language variant error for auto-retry (academy prompt - no data found)'
		);
		const error: any = new Error(
			languageVariantError.error || 'Resources not found for requested language'
		);
		error.details = languageVariantError.details;
		throw error;
	} else if (languageVariantError && hasAnyData) {
		console.log(
			'[execute-prompt] Returning partial academy results despite language variant error'
		);
	}

	return json(results);
}

/**
 * Build the notes object for prompt responses. Mirrors /api/fetch-translation-notes (verseNotes + contextNotes).
 * When condensed, omit full `Note` markdown and include a short `notePreview` instead.
 */
function shapeNotesForPrompt(notesData: any, condensed: boolean): any {
	const base: any = {
		reference: notesData.reference,
		...(notesData.citation && { citation: notesData.citation }),
		...(notesData.citations && { citations: notesData.citations }),
		...(notesData.counts && { counts: notesData.counts }),
		...(notesData.metadata && { metadata: notesData.metadata }),
		...(notesData.organizations && { organizations: notesData.organizations })
	};

	if (!condensed) {
		return {
			...base,
			verseNotes: notesData.verseNotes || [],
			contextNotes: notesData.contextNotes || []
		};
	}

	const NOTE_PREVIEW_MAX = 320;
	const mapCondensed = (n: any) => {
		const normalized = (n.Note || '').replace(/\s+/g, ' ').trim();
		const preview =
			normalized.length > NOTE_PREVIEW_MAX
				? `${normalized.slice(0, NOTE_PREVIEW_MAX)}…`
				: normalized;
		return {
			Reference: n.Reference,
			ID: n.ID,
			Quote: n.Quote,
			Occurrence: n.Occurrence,
			Occurrences: n.Occurrences,
			...(n.contextType && { contextType: n.contextType }),
			...(n.citation && { citation: n.citation }),
			...(n.externalReference && { externalReference: n.externalReference }),
			notePreview: preview
		};
	};

	return {
		...base,
		verseNotes: (notesData.verseNotes || []).map(mapCondensed),
		contextNotes: (notesData.contextNotes || []).map(mapCondensed)
	};
}

function extractSupportReferences(notesData: any): string[] {
	const paths = new Set<string>();

	if (!notesData) {
		console.log('No notes data provided');
		return [];
	}

	const hasSplitShape =
		Array.isArray(notesData.verseNotes) || Array.isArray(notesData.contextNotes);
	const notes = hasSplitShape
		? [...(notesData.verseNotes || []), ...(notesData.contextNotes || [])]
		: notesData.notes || notesData.items || [];
	console.log(`Checking ${notes.length} notes for external references`);

	// Log first note structure to debug
	if (notes.length > 0) {
		console.log('First note keys:', Object.keys(notes[0]));
		console.log('First note sample:', JSON.stringify(notes[0], null, 2).substring(0, 300));
	}

	for (const note of notes) {
		// Extract path from externalReference (new structure)
		const externalRef = note.externalReference;
		if (externalRef && externalRef.target === 'ta' && externalRef.path) {
			console.log(`Found academy reference path: ${externalRef.path}`);
			paths.add(externalRef.path);
		}
	}

	console.log(`Total academy reference paths found: ${paths.size}`);
	return Array.from(paths);
}
