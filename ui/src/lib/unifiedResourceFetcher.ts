/**
 * Unified Resource Fetcher
 *
 * KISS: One class, one way to fetch everything
 * DRY: Reuses the battle-tested ZipResourceFetcher2
 * Consistent: Same patterns for all resources
 * Antifragile: Real data or real errors, no fake fallbacks
 */

import { EdgeXRayTracer } from '../../../src/functions/edge-xray.js';
import { parseReference } from '../../../src/parsers/referenceParser.js';
import { ZipResourceFetcher2 } from '../../../src/services/ZipResourceFetcher2.js';
import { getBookCodesForError } from '../../../src/utils/book-codes.js';
import { edgeLogger as logger } from './edgeLogger.js';

/**
 * Convert a 3-letter book code to full book name
 */
function getBookNameFromCode(code: string): string | null {
	const bookMap: Record<string, string> = {
		'GEN': 'Genesis', 'EXO': 'Exodus', 'LEV': 'Leviticus', 'NUM': 'Numbers', 'DEU': 'Deuteronomy',
		'JOS': 'Joshua', 'JDG': 'Judges', 'RUT': 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
		'1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
		'EZR': 'Ezra', 'NEH': 'Nehemiah', 'EST': 'Esther', 'JOB': 'Job', 'PSA': 'Psalms',
		'PRO': 'Proverbs', 'ECC': 'Ecclesiastes', 'SNG': 'Song of Solomon', 'ISA': 'Isaiah',
		'JER': 'Jeremiah', 'LAM': 'Lamentations', 'EZK': 'Ezekiel', 'DAN': 'Daniel',
		'HOS': 'Hosea', 'JOL': 'Joel', 'AMO': 'Amos', 'OBA': 'Obadiah', 'JON': 'Jonah',
		'MIC': 'Micah', 'NAM': 'Nahum', 'HAB': 'Habakkuk', 'ZEP': 'Zephaniah', 'HAG': 'Haggai',
		'ZEC': 'Zechariah', 'MAL': 'Malachi',
		'MAT': 'Matthew', 'MRK': 'Mark', 'LUK': 'Luke', 'JHN': 'John', 'ACT': 'Acts',
		'ROM': 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians', 'GAL': 'Galatians',
		'EPH': 'Ephesians', 'PHP': 'Philippians', 'COL': 'Colossians', '1TH': '1 Thessalonians',
		'2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy', 'TIT': 'Titus',
		'PHM': 'Philemon', 'HEB': 'Hebrews', 'JAS': 'James', '1PE': '1 Peter', '2PE': '2 Peter',
		'1JN': '1 John', '2JN': '2 John', '3JN': '3 John', 'JUD': 'Jude', 'REV': 'Revelation'
	};
	return bookMap[code.toUpperCase()] || null;
}

export interface ScriptureResult {
	text: string;
	translation: string;
	actualOrganization?: string;
	citation?: {
		resource: string;
		title?: string; // Dynamic title from DCS catalog
		organization: string;
		language: string;
		version: string;
		url?: string;
	};
	metadata?: {
		resourceType: string;
		subject?: string;
		license: string;
	};
}

export interface TSVRow {
	[key: string]: string;
}

export interface TSVResult {
	data: TSVRow[];
	subject?: string; // From DCS catalog (e.g., "TSV Translation Notes")
	version?: string; // Release tag from catalog (e.g., "v88")
}

export interface TWResult {
	articles: Array<{
		term: string;
		path: string;
		markdown: string;
	}>;
}

export interface TWArticleResult {
	content: string;
	path: string;
	term: string;
	subject?: string; // From DCS catalog (e.g., "Translation Words")
}

export interface TAResult {
	modules?: Array<{
		id: string;
		path: string;
		markdown?: string;
	}>;
	categories?: string[];
	subject?: string; // From DCS catalog (e.g., "Translation Academy")
}

/**
 * Unified fetcher that wraps ZipResourceFetcher2
 * All resources go through here for consistency
 */
export class UnifiedResourceFetcher {
	private zipFetcher: ZipResourceFetcher2;

	constructor(tracer?: EdgeXRayTracer) {
		this.zipFetcher = new ZipResourceFetcher2(tracer);
	}

	/**
	 * Set request headers for passthrough to DCS
	 */
	setRequestHeaders(headers: Record<string, string>): void {
		this.zipFetcher.setRequestHeaders(headers);
	}

	/**
	 * Fetch scripture - supports single org, multiple orgs, or all orgs
	 * When resources is null/undefined, discovers available resources from catalog dynamically
	 */
	async fetchScripture(
		reference: string,
		language: string,
		organization: string | string[] | undefined,
		resources?: string[] | null
	): Promise<ScriptureResult[]> {
		const parsed = parseReference(reference);
		const results: ScriptureResult[] = [];

		if (!parsed) {
			throw new Error(`Invalid reference format: ${reference}`);
		}
		
		logger.debug('[fetchScripture] Parsed reference:', { 
			input: reference, 
			parsed: { 
				book: parsed.book, 
				chapter: parsed.chapter, 
				verse: parsed.verse,
				endVerse: parsed.endVerse 
			}
		});

		// Handle multiple organizations
		// When organization is undefined, search all orgs (single call without owner param)
		// When organization is array, make parallel calls for each org
		const organizations =
			organization === undefined
				? [undefined] // Search all orgs - pass undefined to ZipResourceFetcher2
				: Array.isArray(organization)
					? organization
					: [organization]; // Single org as array for uniform handling

		// Dynamic resource discovery when resources is null/undefined
		// This allows the catalog (filtered by topic=tc-ready) to determine available resources
		if (!resources || resources.length === 0) {
			logger.info(
				`🔍 Dynamic discovery mode: fetching all tc-ready resources from catalog for ${language}`
			);

			// Query catalog once to discover available resources
			for (const org of organizations) {
				try {
					const orgParam = org || 'all';
					// Pass undefined as version to let getScripture discover all available
					const data = await this.zipFetcher.getScripture(
						parsed,
						language,
						orgParam,
						undefined // No specific version = return all from catalog
					);
					results.push(...data);
				} catch (error: any) {
					// If this is a "verse not found" error, propagate it immediately
					if (error?.verseNotFound) {
						throw error;
					}
					logger.warn(`Failed to discover resources for ${reference} from ${org || 'all orgs'}`, {
						error
					});
				}
			}
		} else {
			// Specific resources requested - fetch each one
			for (const org of organizations) {
				for (const resource of resources) {
					try {
						const orgParam = org || 'all';
						const data = await this.zipFetcher.getScripture(parsed, language, orgParam, resource);
						results.push(...data);
					} catch (error: any) {
						// If this is a "verse not found" error, propagate it immediately
						if (error?.verseNotFound) {
							throw error;
						}
						logger.warn(`Failed to fetch ${resource} for ${reference} from ${org || 'all orgs'}`, {
							error
						});
						// Continue with other resources instead of failing completely
					}
				}
			}
		}

		if (results.length === 0) {
			// Try to find language variants AND available books for better error messages
			let languageVariants: string[] = [];
			const availableBooks: Array<{ code: string; name: string }> = [];
			
			try {
				const baseLanguage = language.split('-')[0];
				logger.info(`No resources found for language=${language}, searching for variants of base=${baseLanguage}`);

				// Use the centralized findLanguageVariants function from resource-detector
				// This ensures consistent catalog querying across the application
				// IMPORTANT: Search ALL organizations for variants when org is unfoldingWord
				// because unfoldingWord may not have resources in all language variants
			const { findLanguageVariants: findVariants } = await import('../../../src/functions/resource-detector.js');
			languageVariants = await findVariants(
				baseLanguage, 
				organization, // Pass through as-is - respect explicit organization choice
				'tc-ready'
			);

				logger.info(`Found ${languageVariants.length} language variants for base=${baseLanguage}:`, languageVariants);
			} catch (variantError) {
				logger.error(`Failed to discover language variants`, { error: variantError });
			}
			
			// Query catalog directly to get available books for this language
			try {
				const catalogUrl = `https://git.door43.org/api/v1/catalog/search?lang=${language}&subject=Bible,Aligned+Bible&metadataType=rc&includeMetadata=true&topic=tc-ready&stage=prod&type=text`;
				logger.info(`Fetching catalog to find available books: ${catalogUrl}`);
				
				const response = await fetch(catalogUrl);
				if (response.ok) {
					const catalogData = await response.json();
					const catalogResources = catalogData.data || [];
					
					logger.info(`Found ${catalogResources.length} catalog resources for ${language}`);
					
					// Extract available books from catalog
					for (const resource of catalogResources) {
						const ingredients = resource.ingredients || 
							(resource as any).door43_metadata?.ingredients || [];
						
					for (const ing of ingredients) {
						const bookCode = (ing.identifier || '').toLowerCase();
						if (bookCode && bookCode.length >= 2) {
							const bookName = getBookNameFromCode(bookCode.toUpperCase());
							const normalizedCode = bookCode.toUpperCase();
							if (bookName && !availableBooks.some(b => b.code === normalizedCode)) {
								availableBooks.push({ 
									code: normalizedCode, 
									name: bookName 
								});
							}
						}
					}
					}
					
					// Sort books alphabetically by name
					availableBooks.sort((a, b) => a.name.localeCompare(b.name));
					logger.info(`Extracted ${availableBooks.length} available books from catalog`);
				}
			} catch (catalogError) {
				logger.warn('Failed to fetch catalog for available books', { error: catalogError });
			}

		// Determine root cause: language not found OR book not available in this language
		let errorMessage: string;
		const error: any = new Error('');
		const requestedBook = reference.split(/\s+/)[0]; // Extract book part from original reference
		
		// Check if the requested book is actually available
		const requestedBookCode = parsed.book.toUpperCase();
		const isBookAvailable = availableBooks.some(b => b.code === requestedBookCode);
		
		// DEBUG: Log the comparison to diagnose the issue
		logger.info('Book availability check', {
			requestedBookCode,
			availableBookCodes: availableBooks.map(b => b.code),
			isBookAvailable,
			parsedBook: parsed.book
		});
		
		if (languageVariants.length > 0 && availableBooks.length === 0) {
			// ROOT CAUSE: Language not found - suggest variants
			errorMessage = `No scripture resources found for language '${language}'.\n\nAvailable language variants: ${languageVariants.join(', ')}\n\nPlease try one of these language codes instead.`;
			
			error.languageVariants = languageVariants;
			error.requestedLanguage = language;
			
			logger.info('Throwing language variant error', {
				requestedLanguage: language,
				availableVariants: languageVariants
			});
		} else if (availableBooks.length > 0 && !isBookAvailable) {
			// ROOT CAUSE: Book not found, but we have other books available in this language
			errorMessage = `The book of ${parsed.book} is not available in ${language}.\n\n` +
				`However, ${availableBooks.length} other books are available: ${availableBooks.map(b => b.name).join(', ')}.\n\n` +
				`Would you like to see one of these instead?`;
			
			error.availableBooks = availableBooks;
			error.requestedBook = parsed.book;
			error.language = language;
			
			logger.info('Throwing book not available error', {
				requestedBook: parsed.book,
				language,
				availableBooksCount: availableBooks.length,
				isBookAvailable: false
			});
		} else if (availableBooks.length > 0 && isBookAvailable) {
			// Book IS available but we got 0 results - likely a verse that doesn't exist
			const verseInfo = parsed.verse 
				? (parsed.endVerse ? `verses ${parsed.verse}-${parsed.endVerse}` : `verse ${parsed.verse}`)
				: 'this verse';
			
			logger.warn('Book is available but verse extraction returned 0 results', {
				requestedBook: parsed.book,
				chapter: parsed.chapter,
				verse: parsed.verse,
				endVerse: parsed.endVerse,
				language,
				availableBooks: availableBooks.map(b => b.code)
			});
			
			errorMessage = `Unable to find ${verseInfo} in ${parsed.book} chapter ${parsed.chapter} (${language}).\n\n` +
				`The book of ${parsed.book} is available, but the requested verse(s) could not be found. ` +
				`This verse may not exist in this chapter, or there may be a verse numbering difference.\n\n` +
				`Please verify the verse reference is correct.`;
			
			error.requestedBook = parsed.book;
			error.chapter = parsed.chapter;
			error.verse = parsed.verse;
			error.endVerse = parsed.endVerse;
			error.language = language;
		} else {
			// No books or variants available - determine if it's the language or the book code
			// Check if the book code itself is valid
			const bookCode3Letter = requestedBook.toUpperCase().substring(0, 3);
			const isValidBookCode = getBookNameFromCode(bookCode3Letter) !== null;
			
			if (isValidBookCode) {
				// Book code is valid, but language has no resources at all
				errorMessage = `No scripture resources available for language '${language}'.\n\n` +
					`The requested book (${parsed.book}) exists, but we don't have any resources in this language.\n\n` +
					`Try a different language code or check which languages are available.`;
				
				error.requestedLanguage = language;
				error.requestedBook = parsed.book;
				
				logger.info('Throwing language not supported error', {
					language,
					requestedBook: parsed.book,
					validBookCode: true
				});
			} else {
				// Book code itself is invalid
				const validCodes = getBookCodesForError();
				errorMessage = `Invalid book reference '${requestedBook}'.\n\n` +
					`Please use standard 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew).`;
				
				error.validBookCodes = validCodes;
				error.invalidCode = requestedBook;
				error.parsedBook = parsed.book;
				
				logger.info('Throwing invalid book code error', {
					requestedBook,
					parsedBook: parsed.book,
					language,
					validCodesCount: validCodes.length
				});
			}
		}
			
			error.message = errorMessage;
			throw error;
		}

		// Remove duplicates based on translation name
		const uniqueResults = new Map<string, ScriptureResult>();
		for (const result of results) {
			const key = result.translation;
			if (!uniqueResults.has(key)) {
				uniqueResults.set(key, result);
			}
		}

		return Array.from(uniqueResults.values());
	}

	/**
	 * Fetch Translation Notes (TSV)
	 */
	async fetchTranslationNotes(
		reference: string,
		language: string,
		organization: string
	): Promise<TSVResult> {
		const parsed = parseReference(reference);

		if (!parsed) {
			throw new Error(`Invalid reference format: ${reference}`);
		}

		const result = await this.zipFetcher.getTSVData(parsed, language, organization, 'tn');

		if (!result.data || result.data.length === 0) {
			throw new Error(`No translation notes found for ${reference}`);
		}

		return result;
	}

	/**
	 * Fetch Translation Questions (TSV)
	 */
	async fetchTranslationQuestions(
		reference: string,
		language: string,
		organization: string
	): Promise<TSVResult> {
		const parsed = parseReference(reference);

		if (!parsed) {
			throw new Error(`Invalid reference format: ${reference}`);
		}

		const result = await this.zipFetcher.getTSVData(parsed, language, organization, 'tq');

		if (!result.data || result.data.length === 0) {
			// Try to find language variants to help the user
		const { findLanguageVariants } = await import('../../../src/functions/resource-detector.js');
		const baseLanguage = language.split('-')[0];
		// For translation questions, search the correct subject
		const languageVariants = await findLanguageVariants(baseLanguage, organization, 'tc-ready', ['TSV Translation Questions']);
			
			// Filter out the current language to prevent infinite retry loops
			const filteredVariants = languageVariants.filter(v => v !== language);
			
			// Create structured error with recovery data
			const enhancedError: any = new Error(
				filteredVariants.length > 0
					? `No translation questions found for language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
					: `No translation questions available for language '${language}'.`
			);
			
			// Attach structured data for automatic retry
			if (filteredVariants.length > 0) {
				enhancedError.languageVariants = filteredVariants;
				enhancedError.requestedLanguage = language;
				logger.info('Throwing language variant error for translation questions', {
					language,
					variants: filteredVariants
				});
			} else {
				enhancedError.requestedLanguage = language;
				logger.info('Throwing language not supported error for translation questions', {
					language
				});
			}
			
			throw enhancedError;
		}

		return result;
	}

	/**
	 * Fetch Translation Word Links (TSV) - CRITICAL FUNCTIONALITY
	 */
	async fetchTranslationWordLinks(
		reference: string,
		language: string,
		organization: string
	): Promise<TSVResult> {
		const parsed = parseReference(reference);

		if (!parsed) {
			throw new Error(`Invalid reference format: ${reference}`);
		}

		const result = await this.zipFetcher.getTSVData(parsed, language, organization, 'twl');

		if (!result.data || result.data.length === 0) {
			// Try to find language variants to help the user
			const { findLanguageVariants } = await import('../../../src/functions/resource-detector.js');
			const baseLanguage = language.split('-')[0];
			// For translation word links, search the correct subject
			const languageVariants = await findLanguageVariants(baseLanguage, organization, 'tc-ready', ['TSV Translation Words Links']);
			
			// Filter out the current language to prevent infinite retry loops
			const filteredVariants = languageVariants.filter(v => v !== language);
			
			// Create structured error with recovery data
			const enhancedError: any = new Error(
				filteredVariants.length > 0
					? `No translation word links found for language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
					: `No translation word links available for language '${language}'.`
			);
			
			// Attach structured data for automatic retry
			if (filteredVariants.length > 0) {
				enhancedError.languageVariants = filteredVariants;
				enhancedError.requestedLanguage = language;
				logger.info('Throwing language variant error for translation word links', {
					language,
					variants: filteredVariants
				});
			} else {
				enhancedError.requestedLanguage = language;
				logger.info('Throwing language not supported error for translation word links', {
					language
				});
			}
			
			throw enhancedError;
		}

		return result;
	}

	/**
	 * Fetch Translation Word article (Markdown) - CRITICAL FUNCTIONALITY
	 */
	async fetchTranslationWord(
		term: string,
		language: string,
		organization: string,
		path?: string,
		topic?: string
	): Promise<TWArticleResult> {
		const identifier = path || term;
		const result = await this.zipFetcher.getMarkdownContent(
			language,
			organization,
			'tw',
			identifier,
			false, // forceRefresh
			topic // Pass topic filter
		);

		if (!result || typeof result !== 'object') {
			throw new Error(`Translation word not found: ${term}`);
		}

		// getMarkdownContent returns { articles: [{ term, markdown, path }], subject }
		const twResult = result as {
			articles: Array<{ term: string; markdown: string; path: string }>;
			subject?: string;
			debug?: any;
		};

		if (!twResult.articles || twResult.articles.length === 0) {
			// Try to find language variants to help the user
			const { findLanguageVariants } = await import('../../../src/functions/resource-detector.js');
			const baseLanguage = language.split('-')[0];
			// For translation words, search the correct subject
			const languageVariants = await findLanguageVariants(baseLanguage, organization, topic || 'tc-ready', ['Translation Words']);
			
			// Filter out the current language to prevent infinite retry loops
			const filteredVariants = languageVariants.filter(v => v !== language);
			
			// Create structured error with recovery data
			const enhancedError: any = new Error(
				filteredVariants.length > 0
					? `Translation word '${term}' not found in language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
					: `Translation word '${term}' not available in language '${language}'.`
			);
			
			// Attach structured data for automatic retry
			if (filteredVariants.length > 0) {
				enhancedError.languageVariants = filteredVariants;
				enhancedError.requestedLanguage = language;
				enhancedError.requestedTerm = term;
				logger.info('Throwing language variant error for translation word', {
					term,
					language,
					variants: filteredVariants
				});
			} else {
				enhancedError.requestedLanguage = language;
				enhancedError.requestedTerm = term;
				logger.info('Throwing language not supported error for translation word', {
					term,
					language
				});
			}
			
			// If we have debug info, include it in the error
			if (twResult.debug) {
				enhancedError.debug = twResult.debug;
			}
			
			throw enhancedError;
		}

		// Return the first article's content with subject from catalog
		const article = twResult.articles[0];
		return {
			content: article.markdown,
			path: article.path,
			term: article.term,
			subject: twResult.subject // From DCS catalog
		};
	}

	/**
	 * Fetch Translation Academy module (Markdown) - CRITICAL FUNCTIONALITY
	 *
	 * @param path - Path to module. Can be:
	 *               - Directory path (e.g., 'translate/figs-metaphor') - returns all .md files concatenated
	 *               - File path (e.g., 'translate/figs-metaphor/01.md') - returns single file
	 *               If not provided and moduleId is given, searches in order:
	 *               translate/{moduleId}, process/{moduleId}, checking/{moduleId}, intro/{moduleId}
	 */
	async fetchTranslationAcademy(
		language: string,
		organization: string,
		moduleId?: string,
		path?: string,
		topic?: string
	): Promise<TAResult> {
		// If path is provided (directory or file), use it directly
		if (path) {
			const result = await this.zipFetcher.getMarkdownContent(
				language,
				organization,
				'ta',
				path,
				false, // forceRefresh
				topic // Pass topic filter
			);

			// Check if result is null/undefined or has empty modules
			const taResult = result as TAResult | null;
			if (!result || !taResult?.modules || taResult.modules.length === 0) {
				// Try to find language variants to help the user
				const { findLanguageVariants } = await import('../../../src/functions/resource-detector.js');
				const baseLanguage = language.split('-')[0];
				// For translation academy, search the correct subject
				const languageVariants = await findLanguageVariants(baseLanguage, organization, topic || 'tc-ready', ['Translation Academy']);
				
				// Filter out the current language to prevent infinite retry loops
				const filteredVariants = languageVariants.filter(v => v !== language);
				
				// Create structured error with recovery data
				const enhancedError: any = new Error(
					filteredVariants.length > 0
						? `Translation Academy article '${path}' not found in language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
						: `Translation Academy article '${path}' not available in language '${language}'.`
				);
				
				// Attach structured data for automatic retry
				if (filteredVariants.length > 0) {
					enhancedError.languageVariants = filteredVariants;
					enhancedError.requestedLanguage = language;
					enhancedError.requestedPath = path;
					logger.info('Throwing language variant error for translation academy (path)', {
						path,
						language,
						variants: filteredVariants
					});
				} else {
					enhancedError.requestedLanguage = language;
					enhancedError.requestedPath = path;
					logger.info('Throwing language not supported error for translation academy (path)', {
						path,
						language
					});
				}
				
				throw enhancedError;
			}
			return result as TAResult;
		}

		// If only moduleId is provided, search with category fallback
		if (moduleId) {
			const categories = ['translate', 'process', 'checking', 'intro'];
			const errors: string[] = [];

			try {
				logger.info(
					`Searching for TA module "${moduleId}" in categories: ${categories.join(', ')}`
				);
			} catch {
				// Ignore logger errors
			}

			for (const category of categories) {
				const searchPath = `${category}/${moduleId}`;
				try {
					const result = await this.zipFetcher.getMarkdownContent(
						language,
						organization,
						'ta',
						searchPath,
						false, // forceRefresh
						topic // Pass topic filter
					);

					try {
						logger.debug(`Category "${category}" search result:`, {
							hasResult: !!result,
							hasModules: !!(result as any)?.modules,
							moduleCount: (result as any)?.modules?.length || 0
						});
					} catch {
						// Ignore logger errors
					}

					if (result && (result as any).modules && (result as any).modules.length > 0) {
						try {
							logger.info(`✓ Found TA module "${moduleId}" in category "${category}"`);
						} catch {
							// Ignore logger errors
						}
						return result as TAResult;
					} else {
						const detail = !result
							? 'null result'
							: !(result as any).modules
								? 'no modules property'
								: 'empty modules array';
						errors.push(`${category}: ${detail}`);
					}
				} catch (error) {
					// Try next category
					const errorMsg = error instanceof Error ? error.message : String(error);
					errors.push(`${category}: ${errorMsg}`);
					try {
						logger.debug(`✗ TA module "${moduleId}" not found in "${category}": ${errorMsg}`);
					} catch {
						// Ignore logger errors
					}
				}
		}

		// If we get here, module wasn't found in any category
		// Try to find language variants to help the user
		const { findLanguageVariants } = await import('../../../src/functions/resource-detector.js');
		const baseLanguage = language.split('-')[0];
		// For translation academy, search the correct subject
		const languageVariants = await findLanguageVariants(baseLanguage, organization, topic || 'tc-ready', ['Translation Academy']);
		
		// Filter out the current language to prevent infinite retry loops
		const filteredVariants = languageVariants.filter(v => v !== language);
		
		// Create structured error with recovery data
		const errorMessage = filteredVariants.length > 0
			? `Translation Academy module "${moduleId}" not found in language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
			: `Translation Academy module "${moduleId}" not available in language '${language}'.\n\nSearched categories: ${categories.join(', ')}. Details: ${errors.join('; ')}`;
		
		const enhancedError: any = new Error(errorMessage);
		
		// Attach structured data for automatic retry
		if (filteredVariants.length > 0) {
			enhancedError.languageVariants = filteredVariants;
			enhancedError.requestedLanguage = language;
			enhancedError.requestedModule = moduleId;
			try {
				logger.info('Throwing language variant error for translation academy (moduleId)', {
					moduleId,
					language,
					variants: filteredVariants
				});
			} catch {
				// Ignore logger errors
			}
		} else {
			enhancedError.requestedLanguage = language;
			enhancedError.requestedModule = moduleId;
			try {
				logger.error(`Category search exhausted for "${moduleId}":`, { errors });
			} catch {
				// Ignore logger errors
			}
		}

		throw enhancedError;
	}

		// No moduleId or dirPath - return TOC
		const result = await this.zipFetcher.getMarkdownContent(language, organization, 'ta');
		if (!result) {
			throw new Error('Translation Academy not found');
		}

		return result as TAResult;
	}

	/**
	 * Browse Translation Words - Returns list of available words
	 * NOTE: This requires adding a new method to ZipResourceFetcher2
	 * to scan ZIP contents for available words
	 */
	async browseTranslationWords(
		_language: string,
		_organization: string,
		_category?: string
	): Promise<{ words: any[]; categories: string[]; totalWords: number }> {
		// TODO: Implement ZIP scanning in ZipResourceFetcher2
		// For now, throw honest error instead of returning mock data
		throw new Error('Browse Translation Words not yet implemented - needs ZIP scanning capability');
	}

	/**
	 * Browse Translation Academy - Returns TOC
	 */
	async browseTranslationAcademy(
		language: string,
		organization: string,
		category?: string
	): Promise<TAResult> {
		// Get TOC - no moduleId means browse mode
		const result = await this.zipFetcher.getMarkdownContent(language, organization, 'ta');

		if (!result) {
			throw new Error('Translation Academy catalog not found');
		}

		// Filter by category if provided
		if (category && (result as TAResult).modules) {
			(result as TAResult).modules = (result as TAResult).modules!.filter((m) =>
				m.path.toLowerCase().includes(`/${category}/`)
			);
		}

		return result as TAResult;
	}

	/**
	 * Get trace information for debugging
	 */
	getTrace(): unknown {
		return this.zipFetcher.getTrace();
	}

	/**
	 * Check if a resource type supports passthrough format
	 */
	static supportsPassThrough(resourceType: string, format: string): boolean {
		// TSV resources can pass through as TSV
		if (['tn', 'tq', 'twl'].includes(resourceType) && format === 'tsv') {
			return true;
		}
		// Markdown resources can pass through as MD
		if (['tw', 'ta'].includes(resourceType) && ['md', 'markdown'].includes(format)) {
			return true;
		}
		return false;
	}
}
