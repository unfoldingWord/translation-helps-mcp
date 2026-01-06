// Using node runtime instead of edge for better OPTIONS/CORS support
// export const config = {
// 	runtime: 'edge'
// };

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { VERSION } from '$lib/version.js';
import { getMCPToolsList } from '$lib/mcp/tools-list.js';
const getVersion = () => VERSION;

// Import our existing tool handlers
// TEMPORARILY COMMENTED OUT - These imports require dependencies not available in UI build
// import { handleBrowseTranslationWords } from '../../../../../src/tools/browseTranslationWords.js';
// import { handleExtractReferences } from '../../../../../src/tools/extractReferences.js';
// import { handleFetchResources } from '../../../../../src/tools/fetchResources.js';
// import { handleFetchScripture } from '../../../../../src/tools/fetchScripture.js';
// import { handleFetchTranslationNotes } from '../../../../../src/tools/fetchTranslationNotes.js';
// import { handleFetchTranslationQuestions } from '../../../../../src/tools/fetchTranslationQuestions.js';
// import { handleGetContext } from '../../../../../src/tools/getContext.js';
// import { handleGetLanguages } from '../../../../../src/tools/getLanguages.js';
// import { handleGetTranslationWord } from '../../../../../src/tools/getTranslationWord.js';
// import { handleGetWordsForReference } from '../../../../../src/tools/getWordsForReference.js';
// import { handleSearchResources } from '../../../../../src/tools/searchResources.js';

// CORS headers for MCP endpoint
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
	'Access-Control-Max-Age': '86400'
};

// Handle CORS preflight requests
export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 200,
		headers: corsHeaders
	});
};

// MCP-over-HTTP Bridge
export const POST: RequestHandler = async ({ request, url, fetch: eventFetch }) => {
	try {
		// Parse request body - handle both JSON-RPC 2.0 and simple format
		let body: any = {};
		try {
			const text = await request.text();
			if (text) {
				body = JSON.parse(text);
			}
		} catch (parseError) {
			// Body might be empty or invalid JSON - use empty object
			console.warn('[MCP ENDPOINT] Body parse error:', parseError);
		}

		// Extract method and parameters
		const jsonrpc = body.jsonrpc;
		const method = body.method || url.searchParams.get('method');
		// For JSON-RPC 2.0, id is required. For simple format, use null or 0
		const id = body.id !== undefined ? body.id : jsonrpc === '2.0' ? 0 : null;
		const params = body.params || {};

		// Handle different MCP methods
		switch (method) {
			case 'initialize': {
				const initResult = {
					protocolVersion: '2024-11-05',
					capabilities: {
						tools: {},
						prompts: {}
					},
					serverInfo: {
						name: 'translation-helps-mcp',
						version: getVersion()
					}
				};
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				// Ensure id is always present (use 0 if not provided)
				return json(
					{ jsonrpc: '2.0', result: initResult, id: id ?? 0 },
					{
						headers: corsHeaders
					}
				);
			}

		case 'tools/list': {
			// Generate tools list dynamically from actual tool registry
			// This ensures discovery matches what tools/call can actually execute
			const toolsList = getMCPToolsList();
			// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
			return json(
				{ jsonrpc: '2.0', result: { tools: toolsList }, id: id ?? 0 },
				{
					headers: corsHeaders
				}
			);
		}
					{
						name: 'fetch_scripture',
						description: 'Fetch Bible scripture text for a specific reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: "Bible reference (e.g., 'John 3:16')" },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' }
							},
							required: ['reference']
						}
					},
					{
						name: 'fetch_translation_notes',
						description: 'Fetch translation notes for a specific Bible reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: 'Bible reference' },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' }
							},
							required: ['reference']
						}
					},
					{
						name: 'get_languages',
						description: 'Get available languages for translation resources',
						inputSchema: {
							type: 'object',
							properties: {}
						}
					},
					{
						name: 'fetch_translation_questions',
						description: 'Fetch translation questions for a specific Bible reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: 'Bible reference' },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' }
							},
							required: ['reference']
						}
					},
					{
						name: 'browse_translation_words',
						description: 'Browse and search translation words by category or term',
						inputSchema: {
							type: 'object',
							properties: {
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' },
								category: {
									type: 'string',
									description: 'Filter by category (kt, names, other)'
								},
								search: { type: 'string', description: 'Search term to filter words' },
								limit: { type: 'number', default: 50, description: 'Maximum number of results' }
							}
						}
					},
					{
						name: 'get_context',
						description: 'Get contextual information for a Bible reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: 'Bible reference' },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' }
							},
							required: ['reference']
						}
					},
					{
						name: 'extract_references',
						description: 'Extract and parse Bible references from text',
						inputSchema: {
							type: 'object',
							properties: {
								text: { type: 'string', description: 'Text containing Bible references' },
								includeContext: {
									type: 'boolean',
									default: false,
									description: 'Include context around references'
								}
							},
							required: ['text']
						}
					},
					{
						name: 'fetch_resources',
						description: 'Fetch multiple types of translation resources for a reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: 'Bible reference' },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' },
								resources: {
									type: 'array',
									items: { type: 'string' },
									default: ['scripture', 'notes', 'questions', 'words']
								}
							},
							required: ['reference']
						}
					},
					{
						name: 'get_words_for_reference',
						description: 'Get translation words specifically linked to a Bible reference',
						inputSchema: {
							type: 'object',
							properties: {
								reference: { type: 'string', description: 'Bible reference' },
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' }
							},
							required: ['reference']
						}
					},
					{
						name: 'search_resources',
						description: 'Search across multiple resource types for content',
						inputSchema: {
							type: 'object',
							properties: {
								query: { type: 'string', description: 'Search query' },
								resourceTypes: {
									type: 'array',
									items: { type: 'string' },
									default: ['notes', 'questions', 'words']
								},
								language: { type: 'string', default: 'en' },
								organization: { type: 'string', default: 'unfoldingWord' },
								limit: { type: 'number', default: 50, description: 'Maximum number of results' }
							},
							required: ['query']
						}
					},
					{
						name: 'list_languages',
						description:
							'List all available languages from the Door43 catalog. Returns structured language data that can be directly reused as language parameters in other tools.',
						inputSchema: {
							type: 'object',
							properties: {
								organization: {
									type: 'string',
									description:
										'Filter languages by organization (e.g., "unfoldingWord"). If not provided, returns all languages.'
								},
								stage: {
									type: 'string',
									default: 'prod',
									description: 'Resource stage (default: "prod")'
								}
							}
						}
					},
					{
						name: 'list_subjects',
						description:
							'List all available resource subjects (resource types) from the Door43 catalog. Returns structured subject data that can be used to discover what resource types are available.',
						inputSchema: {
							type: 'object',
							properties: {
								language: {
									type: 'string',
									description:
										'Filter subjects by language code (e.g., "en", "es-419"). If not provided, returns all subjects.'
								},
								organization: {
									type: 'string',
									description:
										'Filter subjects by organization (e.g., "unfoldingWord"). If not provided, returns all subjects.'
								},
								stage: {
									type: 'string',
									default: 'prod',
									description: 'Resource stage (default: "prod")'
								}
							}
						}
					}
				];
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json(
					{ jsonrpc: '2.0', result: { tools: toolsList }, id: id ?? 0 },
					{
						headers: corsHeaders
					}
				);
			}

			case 'tools/call': {
				const toolName = params?.name || params?.tool || body.params?.name;
				const args = params?.arguments || params?.args || body.params?.arguments || {};

				// Import the unified handler with proper base URL
				// FORCE REBUILD: All tools now use UnifiedMCPHandler (no duplicate formatting)
				console.log('[MCP ENDPOINT] Tool call:', toolName, 'Args:', JSON.stringify(args));

				const { UnifiedMCPHandler } = await import('$lib/mcp/UnifiedMCPHandler');
				// Use event.fetch for SvelteKit compatibility (allows relative URLs)
				// eventFetch is the fetch function from the RequestEvent that supports relative URLs
				const handler = new UnifiedMCPHandler('', eventFetch);

				try {
					console.log('[MCP ENDPOINT] Using UnifiedMCPHandler for:', toolName);
					const result = await handler.handleToolCall(toolName, args);
					console.log('[MCP ENDPOINT] Result preview:', JSON.stringify(result).substring(0, 300));

					// Extract metadata from result if present
					const metadata = (result as any).metadata;
					console.log('[MCP ENDPOINT] Result metadata:', metadata);

					// Format result for MCP protocol
					// UnifiedMCPHandler already returns { content: [...] } format
					const mcpResult =
						result && typeof result === 'object' && 'content' in result
							? result
							: {
									content: Array.isArray(result)
										? result
										: [
												{
													type: 'text',
													text: typeof result === 'string' ? result : JSON.stringify(result)
												}
											]
								};

					// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
					const response = json(
						{ jsonrpc: '2.0', result: mcpResult, id: id ?? 0 },
						{
							headers: corsHeaders
						}
					);

					// Forward diagnostic headers from internal endpoint if available
					if (metadata) {
						if (metadata.cacheStatus) {
							response.headers.set('X-Cache-Status', metadata.cacheStatus);
						}
						if (metadata.responseTime) {
							response.headers.set('X-Response-Time', `${metadata.responseTime}ms`);
						}
						if (metadata.traceId) {
							response.headers.set('X-Trace-Id', metadata.traceId);
						}
						if (metadata.xrayTrace) {
							response.headers.set('X-XRay-Trace', btoa(JSON.stringify(metadata.xrayTrace)));
						}
						console.log('[MCP ENDPOINT] Forwarded headers:', {
							cacheStatus: metadata.cacheStatus,
							responseTime: metadata.responseTime,
							traceId: metadata.traceId,
							hasXrayTrace: !!metadata.xrayTrace
						});
					}

					return response;
				} catch (error) {
					console.error(`[MCP ENDPOINT] Tool error for ${toolName}:`, error);
					// Special logging for translation notes
					if (toolName === 'fetch_translation_notes') {
						console.error('[MCP ENDPOINT] Translation notes error details:', {
							errorMessage: error instanceof Error ? error.message : 'Unknown error',
							errorStack: error instanceof Error ? error.stack : 'No stack',
							args: args
						});
					}
					// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
					return json(
						{
							jsonrpc: '2.0',
							error: {
								code: -32000,
								message: error instanceof Error ? error.message : 'Tool execution failed'
							},
							id: id ?? 0
						},
						{
							headers: corsHeaders
						}
					);
				}

				// The code below is unreachable - all tools are handled by UnifiedMCPHandler above
				/*
				if (toolName === 'fetch_scripture') {
					const params = new URLSearchParams({
						reference: args.reference,
						language: args.language || 'en',
						organization: args.organization || 'unfoldingWord',
						includeVerseNumbers: 'true',
						format: 'text'
					});
					
					try {
						// Call the underlying endpoint handler directly
						const endpoint = await import('../fetch-scripture/+server.js');
						const mockRequest = new Request(`http://localhost/api/fetch-scripture?${params}`);
						const response = await endpoint.GET({ url: new URL(mockRequest.url), request: mockRequest });
						
						if (response.ok) {
							const data = await response.json();
							
							// Extract scripture text from the response
							let scriptureText = 'Scripture not found';
							
							if (data.scriptures && data.scriptures.length > 0) {
								// Find ULT or UST translation
								const ult = data.scriptures.find(s => s.translation === "unfoldingWord® Literal Text");
								const ust = data.scriptures.find(s => s.translation === "unfoldingWord® Simplified Text");
								
								scriptureText = (ult?.text || ust?.text || data.scriptures[0]?.text || 'Scripture not found');
							}
							
							return json({
								content: [{
									type: 'text',
									text: scriptureText
								}]
							});
						} else {
							throw new Error('Failed to fetch scripture');
						}
					} catch (error) {
						console.error('Scripture fetch error:', error);
						return json({
							content: [{
								type: 'text',
								text: 'Error fetching scripture. Please try again.'
							}]
						});
					}
				}
				else if (toolName === 'fetch_translation_notes') {
					console.log('[MCP] fetch_translation_notes called with args:', args);
					
					// Ensure all parameters are strings
					const reference = String(args.reference || '');
					const language = String(args.language || 'en');
					const organization = String(args.organization || 'unfoldingWord');
					
					if (!reference) {
						return json({
							content: [{
								type: 'text',
								text: 'Error: Bible reference is required for translation notes.'
							}]
						});
					}
					
					const params = new URLSearchParams({
						reference,
						language,
						organization
					});
					
					console.log('[MCP] Translation notes params:', params.toString());
					
					try {
						// Call the underlying endpoint handler directly
						const endpoint = await import('../fetch-translation-notes/+server.js');
						const mockUrl = new URL(`http://localhost/api/fetch-translation-notes?${params}`);
						const mockRequest = new Request(mockUrl.toString());
						
						// Create proper context for the endpoint
						const context = {
							url: mockUrl,
							request: mockRequest,
							params: {},
							route: { id: '' },
							platform: undefined
						};
						
						const response = await endpoint.GET(context);
						
						console.log('[MCP] Translation notes response status:', response.status);
						
						if (response.ok) {
							const data = await response.json();
							
							// Format translation notes
							let notesText = '';
							// Check for both 'notes' and 'verseNotes' fields (API response structure varies)
							const notes = data.notes || data.verseNotes || [];
							
							if (notes.length > 0) {
								notesText = `Translation Notes for ${args.reference}:\n\n`;
								notes.forEach((note, index) => {
									const noteContent = note.Note || note.note || note.text || note.content || '';
									notesText += `${index + 1}. ${noteContent}\n\n`;
								});
							} else {
								notesText = 'No translation notes found for this reference.';
							}
							
							return json({
								content: [{
									type: 'text',
									text: notesText
								}]
							});
						} else {
							const errorData = await response.json();
							console.error('[MCP] Translation notes error response:', errorData);
							throw new Error(`Failed to fetch translation notes: ${response.status} - ${errorData.error || 'Unknown error'}`);
						}
					} catch (error) {
						console.error('Translation notes fetch error:', error);
						return json({
							content: [{
								type: 'text',
								text: `Error fetching translation notes: ${error.message || 'Unknown error'}`
							}]
						});
					}
				}
				else if (toolName === 'fetch_translation_questions') {
					const params = new URLSearchParams({
						reference: args.reference,
						language: args.language || 'en',
						organization: args.organization || 'unfoldingWord'
					});
					
					try {
						const endpoint = await import('../fetch-translation-questions/+server.js');
						const mockRequest = new Request(`http://localhost/api/fetch-translation-questions?${params}`);
						const response = await endpoint.GET({ url: new URL(mockRequest.url), request: mockRequest });
						
						if (response.ok) {
							const data = await response.json();
							let questionsText = '';
							if (data.questions && data.questions.length > 0) {
								data.questions.forEach((q, index) => {
									questionsText += `Q${index + 1}: ${q.question}\nA: ${q.answer}\n\n`;
								});
							} else {
								questionsText = 'No translation questions found for this reference.';
							}
							
							return json({
								content: [{
									type: 'text',
									text: questionsText
								}]
							});
						}
					} catch (error) {
						console.error('Translation questions fetch error:', error);
						return json({
							content: [{
								type: 'text',
								text: 'Error fetching translation questions.'
							}]
						});
					}
				}
				else if (toolName === 'fetch_translation_word') {
					const params = new URLSearchParams({
						term: args.term || args.reference || '',
						language: args.language || 'en',
						organization: args.organization || 'unfoldingWord'
					});
					
					try {
						const endpoint = await import('../fetch-translation-word/+server.js');
						const mockRequest = new Request(`http://localhost/api/fetch-translation-word?${params}`);
						const response = await endpoint.GET({ url: new URL(mockRequest.url), request: mockRequest });
						
						if (response.ok) {
							const data = await response.json();
							let wordsText = '';
							if (data.words && data.words.length > 0) {
								data.words.forEach(word => {
									wordsText += `**${word.term}**\n${word.definition}\n\n`;
								});
							} else if (data.term) {
								wordsText = `**${data.term}**\n${data.definition}`;
							} else {
								wordsText = 'No translation words found.';
							}
							
							return json({
								content: [{
									type: 'text',
									text: wordsText
								}]
							});
						}
					} catch (error) {
						console.error('Translation words fetch error:', error);
						return json({
							content: [{
								type: 'text',
								text: 'Error fetching translation words.'
							}]
						});
					}
				}
				else if (toolName === 'get_system_prompt') {
					const response = {
						systemPrompt: SACRED_TEXT_SYSTEM_PROMPT,
						constraints: {
							scriptureHandling: 'VERBATIM - Quote scripture character for character',
							interpretation: 'FORBIDDEN - No theological interpretation allowed',
							citations: 'REQUIRED - All resources must be cited',
							transparency: 'FULL - All decisions and sources visible'
						},
						version: '1.0.0',
						lastUpdated: '2025-07-25'
					};
					
					if (args.includeImplementationDetails) {
						response.implementationDetails = {
							validationFunctions: [
								'validateScriptureQuote - Ensures quotes are verbatim',
								'extractCitations - Extracts all resource citations',
								'checkForInterpretation - Flags interpretation attempts'
							],
							enforcementMechanisms: [
								'Pre-response validation',
								'Citation extraction and display',
								'Interpretation detection and blocking'
							]
						};
					}
					
					return json({
						content: [{
							type: 'text',
							text: JSON.stringify(response, null, 2)
						}]
					});
				}

				// Temporary response for other tools
				return json({
					content: [{
						type: 'text',
						text: 'Tool temporarily unavailable during refactoring. Please check back soon!'
					}]
				});
				*/
			}

			case 'prompts/list': {
				const promptsList = [
					{
						name: 'translation-helps-for-passage',
						description:
							'Get comprehensive translation help for a Bible passage: scripture text, questions, word definitions (with titles), notes, and related academy articles',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					},
					{
						name: 'get-translation-words-for-passage',
						description:
							'Get all translation word definitions for a passage, showing dictionary entry titles (not technical term IDs)',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					},
					{
						name: 'get-translation-academy-for-passage',
						description:
							'Get Translation Academy training articles referenced in the translation notes for a passage',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					}
				];
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json(
					{ jsonrpc: '2.0', result: { prompts: promptsList }, id: id ?? 0 },
					{
						headers: corsHeaders
					}
				);
			}

			case 'prompts/get': {
				const promptParams = params?.name ? params : body.params || {};
				const name = promptParams.name;
				const args = promptParams.arguments || promptParams.args || {};

				if (!name) {
					return json(
						{
							error: {
								code: ErrorCode.InvalidParams,
								message: 'Prompt name is required'
							}
						},
						{ status: 400 }
					);
				}

				const language = (args?.language as string) || 'en';
				const reference = (args?.reference as string) || '';

				switch (name) {
					case 'translation-helps-for-passage': {
						const prompt1Result = {
							messages: [
								{
									role: 'user',
									content: {
										type: 'text',
										text: `Please provide comprehensive translation help for ${reference} in ${language}.

Follow these steps to gather all relevant information:

1. **Get the Scripture Text:**
   - Use fetch_scripture tool with reference="${reference}" and language="${language}"
   - This provides the actual Bible text to work with

2. **Get Translation Questions:**
   - Use fetch_translation_questions with reference="${reference}" and language="${language}"
   - These help check comprehension and guide translation decisions

3. **Get Translation Word Links and Fetch Titles:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - This returns a list of terms (e.g., [{term: "love", category: "kt", path: "..."}])
   - For EACH term in the response, use fetch_translation_word tool with term=<term_value> to get the full article
   - Extract the TITLE from each article (found in the first H1 heading or title field)
   - Show the user these dictionary entry TITLES, not the technical term IDs
   - Example: Show "Love, Beloved" not "love"; show "Son of God, Son" not "sonofgod"

4. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - Notes contain supportReference fields that link to Translation Academy articles

5. **Get Related Translation Academy Articles:**
   - From the translation notes response, extract all supportReference values
   - These are RC links like "rc://*/ta/man/translate/figs-metaphor"
   - For each supportReference, use fetch_translation_academy tool with rcLink=<supportReference_value>
   - Extract the TITLE from each academy article
   - Show these training article titles to help the user understand translation concepts

6. **Organize the Response:**
   Present everything in a clear, structured way:
   - Scripture text at the top
   - List of translation word titles (dictionary entries)
   - Translation questions for comprehension
   - Translation notes with guidance
   - Related academy article titles for deeper learning

The goal is to provide EVERYTHING a translator needs for this passage in one comprehensive response.`
									}
								}
							]
						};
						// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
						return json(
							{ jsonrpc: '2.0', result: prompt1Result, id: id ?? 0 },
							{
								headers: corsHeaders
							}
						);
					}

					case 'get-translation-words-for-passage': {
						const prompt2Result = {
							messages: [
								{
									role: 'user',
									content: {
										type: 'text',
										text: `Please show me all the translation word definitions for ${reference} in ${language}.

Follow these steps:

1. **Get Translation Word Links:**
   - Use fetch_translation_word_links with reference="${reference}" and language="${language}"
   - This returns links like: [{term: "love", category: "kt", ...}, {term: "god", ...}]

2. **Fetch Full Articles and Extract Titles:**
   - For EACH term in the links result, call fetch_translation_word with term=<term_value>
   - From each article response, extract the TITLE (not the term ID)
   - The title is usually in the first H1 heading or a dedicated title field
   - Example: The term "love" might have title "Love, Beloved"
   - Example: The term "sonofgod" might have title "Son of God, Son"

3. **Present to User:**
   - Show the dictionary entry TITLES in a clear list
   - These are human-readable names, not technical IDs
   - Optionally group by category (Key Terms, Names, Other Terms)
   - Let the user know they can ask for the full definition of any term

Focus on making the translation words accessible by showing their proper titles.`
									}
								}
							]
						};
						// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
						return json(
							{ jsonrpc: '2.0', result: prompt2Result, id: id ?? 0 },
							{
								headers: corsHeaders
							}
						);
					}

					case 'get-translation-academy-for-passage': {
						const prompt3Result = {
							messages: [
								{
									role: 'user',
									content: {
										type: 'text',
										text: `Please find all the Translation Academy training articles related to ${reference} in ${language}.

Follow these steps:

1. **Get Translation Notes:**
   - Use fetch_translation_notes with reference="${reference}" and language="${language}"
   - Translation notes contain supportReference fields that link to academy articles

2. **Extract Support References:**
   - From the notes response, find all supportReference values
   - These are RC links in format: "rc://*/ta/man/translate/figs-metaphor"
   - Or they might be moduleIds like: "figs-metaphor", "translate-names"
   - Collect all unique support references

3. **Fetch Academy Articles:**
   - For each supportReference, use fetch_translation_academy tool
   - If it's an RC link: use rcLink=<supportReference_value>
   - If it's a moduleId: use moduleId=<supportReference_value>
   - Each call returns an academy article with training content

4. **Extract Titles:**
   - From each academy article response, extract the TITLE
   - The title is in the first H1 heading or dedicated title field

5. **Present to User:**
   - Show the academy article titles
   - Brief description of what each article teaches
   - Let the user know they can request the full content of any article
   
The goal is to show what translation concepts and training materials are relevant to understanding this passage.`
									}
								}
							]
						};
						// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
						return json(
							{ jsonrpc: '2.0', result: prompt3Result, id: id ?? 0 },
							{
								headers: corsHeaders
							}
						);
					}

					default:
						// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
						return json(
							{
								jsonrpc: '2.0',
								error: {
									code: -32601,
									message: `Unknown prompt: ${name}`
								},
								id: id ?? 0
							},
							{ status: 400, headers: corsHeaders }
						);
				}
			}

			case 'ping': {
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json({ jsonrpc: '2.0', result: {}, id: id ?? 0 }, { headers: corsHeaders });
			}

			default: {
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json(
					{
						jsonrpc: '2.0',
						error: {
							code: -32601,
							message: `Unknown method: ${method}`
						},
						id: id ?? 0
					},
					{ status: 400, headers: corsHeaders }
				);
			}
		}
	} catch (error) {
		console.error('MCP Bridge Error:', error);
		// Try to get request body, but don't fail if it's already consumed
		let requestBody: any = {};
		try {
			const clonedRequest = request.clone();
			requestBody = await clonedRequest.json();
		} catch {
			// Request body already consumed or not available
		}
		const id = requestBody.id || null;

		// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
		return json(
			{
				jsonrpc: '2.0',
				error: {
					code: error instanceof McpError ? error.code : -32603,
					message: error instanceof Error ? error.message : 'Unknown error'
				},
				id: id ?? 0
			},
			{ status: 500, headers: corsHeaders }
		);
	}
};

// Also support GET for simple queries
export const GET: RequestHandler = async ({ url }) => {
	const method = url.searchParams.get('method');

	// Handle prompts/list directly
	if (method === 'prompts/list') {
		return json(
			{
				prompts: [
					{
						name: 'translation-helps-for-passage',
						description:
							'Get comprehensive translation help for a Bible passage: scripture text, questions, word definitions (with titles), notes, and related academy articles',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					},
					{
						name: 'get-translation-words-for-passage',
						description:
							'Get all translation word definitions for a passage, showing dictionary entry titles (not technical term IDs)',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					},
					{
						name: 'get-translation-academy-for-passage',
						description:
							'Get Translation Academy training articles referenced in the translation notes for a passage',
						arguments: [
							{
								name: 'reference',
								description: 'Bible reference (e.g., "John 3:16")',
								required: true
							},
							{
								name: 'language',
								description: 'Language code (default: "en")',
								required: false
							}
						]
					}
				]
			},
			{
				headers: corsHeaders
			}
		);
	}

	// For tools/list, delegate to POST handler
	if (method === 'tools/list') {
		const mockRequest = new Request(url, {
			method: 'POST',
			body: JSON.stringify({ method })
		});
		return POST({
			request: mockRequest,
			url,
			cookies: {} as any,
			fetch,
			getClientAddress: () => '',
			locals: {} as any,
			params: {},
			platform: undefined,
			route: { id: '/api/mcp' },
			setHeaders: () => {},
			isDataRequest: false,
			isSubRequest: false,
			tracing: { enabled: false, root: {} as any, current: {} as any },
			isRemoteRequest: false
		} as any);
	}

	return json(
		{
			name: 'translation-helps-mcp',
			version: getVersion(),
			methods: ['initialize', 'tools/list', 'tools/call', 'prompts/list', 'prompts/get', 'ping']
		},
		{
			headers: corsHeaders
		}
	);
};
