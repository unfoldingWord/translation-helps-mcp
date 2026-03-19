// Using node runtime instead of edge for better OPTIONS/CORS support
// export const config = {
// 	runtime: 'edge'
// };

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { VERSION } from '$lib/version.js';
import { getMCPToolsList } from '$lib/mcp/tools-list.js';
import { MCP_PROMPTS, getPromptTemplate } from '../../../../../src/mcp/prompts-registry.js';
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

// Supported MCP protocol versions (Streamable HTTP)
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-11-25'] as const;
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';

// CORS headers for MCP endpoint (Streamable HTTP)
const corsHeaders: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version, MCP-Protocol-Version, MCP-Session-Id',
	'Access-Control-Expose-Headers': 'MCP-Session-Id',
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
		// For JSON-RPC 2.0, id is required for requests; notifications have no id
		const id = body.id !== undefined ? body.id : jsonrpc === '2.0' ? 0 : null;
		const params = body.params || {};

		// Streamable HTTP: only known notification methods get 202 with no body.
		// Do NOT treat "initialize" or "tools/list" without id as notifications — many clients (e.g. SDK) omit id and expect a JSON response.
		const isNotification = body.method === 'notifications/initialized';
		if (isNotification) {
			return new Response(null, { status: 202, headers: { ...corsHeaders } });
		}

		// Handle different MCP methods
		switch (method) {
			case 'initialize': {
				// Protocol version negotiation (Streamable HTTP)
				const requestedVersion = params?.protocolVersion as string | undefined;
				const protocolVersion =
					requestedVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion as any)
						? requestedVersion
						: DEFAULT_PROTOCOL_VERSION;
				const initResult = {
					protocolVersion,
					capabilities: {
						tools: {},
						prompts: {}
					},
					serverInfo: {
						name: 'translation-helps-mcp',
						version: getVersion()
					}
				};
				// Session ID per Streamable HTTP spec (stateless: we don't store sessions)
				const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
					? crypto.randomUUID()
					: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
				const headers = { ...corsHeaders, 'MCP-Session-Id': sessionId };
				return json(
					{ jsonrpc: '2.0', result: initResult, id: id ?? 0 },
					{ headers }
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

			case 'tools/call': {
				const toolName = params?.name || params?.tool || body.params?.name;
				const args = params?.arguments || params?.args || body.params?.arguments || {};

				// Import the unified handler with proper base URL
				// FORCE REBUILD: All tools now use UnifiedMCPHandler (no duplicate formatting)
				console.log('[MCP ENDPOINT] Tool call:', toolName, 'Args:', JSON.stringify(args));

				const { UnifiedMCPHandler } = await import('$lib/mcp/UnifiedMCPHandler');
				// Use event.fetch for SvelteKit compatibility (allows relative URLs)
				// eventFetch is the fetch function from the RequestEvent that supports relative URLs
				// Base path '/api/' is added to relative endpoint paths from tools-registry
				const handler = new UnifiedMCPHandler('/api/', eventFetch);

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
					
					// Build error response with helpful details for AI agents
					const errorData: any = {
						code: -32000,
						message: error instanceof Error ? error.message : 'Tool execution failed'
					};
					
					// Include structured recovery data for AI agents
					const errorObj = error as any;
					
					// Check for validBookCodes (direct on error or in details)
					if (errorObj?.validBookCodes) {
						errorData.data = {
							validBookCodes: errorObj.validBookCodes,
							invalidCode: errorObj.invalidCode
						};
						console.log(`[MCP ENDPOINT] Including ${errorObj.validBookCodes.length} valid book codes in error response`);
					} else if (errorObj?.details?.validBookCodes) {
						errorData.data = {
							validBookCodes: errorObj.details.validBookCodes,
							invalidCode: errorObj.details.invalidCode
						};
						console.log(`[MCP ENDPOINT] Including ${errorObj.details.validBookCodes.length} valid book codes from error.details`);
					}
					
					// Check for languageVariants (direct on error or in details)
					if (errorObj?.languageVariants) {
						if (!errorData.data) errorData.data = {};
						errorData.data.languageVariants = errorObj.languageVariants;
						errorData.data.requestedLanguage = errorObj.requestedLanguage;
						console.log(`[MCP ENDPOINT] ✅ Including ${errorObj.languageVariants.length} language variants in error response:`, errorObj.languageVariants);
					} else if (errorObj?.details?.languageVariants) {
						if (!errorData.data) errorData.data = {};
						errorData.data.languageVariants = errorObj.details.languageVariants;
						errorData.data.requestedLanguage = errorObj.details.requestedLanguage;
						console.log(`[MCP ENDPOINT] ✅ Including ${errorObj.details.languageVariants.length} language variants from error.details:`, errorObj.details.languageVariants);
					}
					
				// Check for availableBooks (when book not found but language is valid)
				if (errorObj?.availableBooks) {
					if (!errorData.data) errorData.data = {};
					errorData.data.availableBooks = errorObj.availableBooks;
					errorData.data.requestedBook = errorObj.requestedBook;
					errorData.data.language = errorObj.language;
					console.log(`[MCP ENDPOINT] ✅ Including ${errorObj.availableBooks.length} available books in error response`);
				} else if (errorObj?.details?.availableBooks) {
					if (!errorData.data) errorData.data = {};
					errorData.data.availableBooks = errorObj.details.availableBooks;
					errorData.data.requestedBook = errorObj.details.requestedBook;
					errorData.data.language = errorObj.details.language;
					console.log(`[MCP ENDPOINT] ✅ Including ${errorObj.details.availableBooks.length} available books from error.details`);
				}
				
				// Check for verseNotFound (when verse doesn't exist)
				if (errorObj?.verseNotFound || errorObj?.details?.verseNotFound) {
					if (!errorData.data) errorData.data = {};
					errorData.data.verseNotFound = true;
					errorData.data.requestedBook = errorObj.requestedBook || errorObj?.details?.requestedBook;
					errorData.data.chapter = errorObj.chapter || errorObj?.details?.chapter;
					errorData.data.verse = errorObj.verse || errorObj?.details?.verse;
					errorData.data.language = errorObj.language || errorObj?.details?.language;
					errorData.data.explicitError = 'VERSE_DOES_NOT_EXIST';
					console.log(`[MCP ENDPOINT] ✅ Including verseNotFound details: ${errorData.data.requestedBook} ${errorData.data.chapter}:${errorData.data.verse}`);
				}
				
				// Check for hasContextOnly (when only contextual notes available)
				if (errorObj?.hasContextOnly || errorObj?.details?.hasContextOnly) {
					if (!errorData.data) errorData.data = {};
					errorData.data.hasContextOnly = true;
					errorData.data.contextNotesCount = errorObj.contextNotesCount || errorObj?.details?.contextNotesCount;
					console.log(`[MCP ENDPOINT] ✅ Including hasContextOnly flag with ${errorData.data.contextNotesCount} context notes`);
				}
				
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
					return json(
						{
							jsonrpc: '2.0',
							error: errorData,
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
				// Use shared prompts registry - single source of truth
				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json(
					{ jsonrpc: '2.0', result: { prompts: MCP_PROMPTS }, id: id ?? 0 },
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

				// Check if prompt exists in registry
				const prompt = MCP_PROMPTS.find((p) => p.name === name);
				if (!prompt) {
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

				// Get prompt template from registry
				const templateText = getPromptTemplate(name, args);

				const promptResult = {
					messages: [
						{
							role: 'user',
							content: {
								type: 'text',
								text: templateText
							}
						}
					]
				};

				// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
				return json(
					{ jsonrpc: '2.0', result: promptResult, id: id ?? 0 },
					{
						headers: corsHeaders
					}
				);
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

		// Determine appropriate HTTP status code based on MCP error code
		let httpStatus = 500; // Default to Internal Server Error
		const mcpErrorCode = error instanceof McpError ? error.code : -32603;
		
		// Map MCP error codes to HTTP status codes for better semantic correctness
		switch (mcpErrorCode) {
			case ErrorCode.MethodNotFound: // -32601
				httpStatus = 404; // Not Found
				break;
			case ErrorCode.InvalidParams: // -32602
			case ErrorCode.InvalidRequest: // -32600
			case ErrorCode.ParseError: // -32700
				httpStatus = 400; // Bad Request
				break;
			case ErrorCode.InternalError: // -32603
			default:
				httpStatus = 500; // Internal Server Error
				break;
		}

		// Always return JSON-RPC 2.0 format for MCP Inspector compatibility
		return json(
			{
				jsonrpc: '2.0',
				error: {
					code: mcpErrorCode,
					message: error instanceof Error ? error.message : 'Unknown error'
				},
				id: id ?? 0
			},
			{ status: httpStatus, headers: corsHeaders }
		);
	}
};

// GET: Streamable HTTP — return 200 + minimal SSE stream (or legacy ?method= JSON).
export const GET: RequestHandler = async ({ request, url }) => {
	const method = url.searchParams.get('method');

	// Legacy convenience: GET ?method=tools/list or ?method=prompts/list (return JSON)
	// Handle prompts/list directly
	if (method === 'prompts/list') {
		// Use shared prompts registry - single source of truth
		return json(
			{
				prompts: MCP_PROMPTS
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

	// Streamable HTTP: Inspector expects GET to return 200 + SSE. We don't push server messages;
	// return a minimal SSE stream so the client stays connected and doesn't treat GET as failed.
	const stream = new ReadableStream({
		start(controller) {
			// Single comment event so the stream is valid; client can keep connection open
			controller.enqueue(new TextEncoder().encode(': mcp\n\n'));
		}
	});
	return new Response(stream, {
		status: 200,
		headers: {
			...corsHeaders,
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

// DELETE: Streamable HTTP optional session teardown. We are stateless; accept and return 200.
export const DELETE: RequestHandler = async () => {
	return new Response(null, {
		status: 200,
		headers: corsHeaders
	});
};
