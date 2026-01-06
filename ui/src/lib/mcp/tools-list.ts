/**
 * Dynamic Tools List Generator for MCP
 * Generates the tools list from the actual tool registry to ensure discovery matches implementation
 * 
 * This ensures the tools/list response matches what tools/call can actually execute,
 * fixing the issue where discovery was stale and didn't match actual supported tools.
 * 
 * Uses the shared tools registry from src/mcp/tools-registry.ts to maintain DRY compliance.
 */

import { getMCPToolDefinitions } from '../../../../src/mcp/tools-registry.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Get the list of all available MCP tools with their schemas
 * This matches what tools/call can actually execute
 * 
 * Converts Zod schemas to JSON Schema format for MCP protocol compliance
 */
export function getMCPToolsList() {
	// Get tool definitions from shared registry (single source of truth)
	const toolDefinitions = getMCPToolDefinitions();
	
	// Convert Zod schemas to JSON Schema format
	return toolDefinitions.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: "none" }),
	}));
		{
			name: 'fetch_scripture',
			description: 'Fetch Bible scripture text for a specific reference',
			inputSchema: {
				type: 'object',
				properties: {
					reference: {
						type: 'string',
						description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					includeVerseNumbers: {
						type: 'boolean',
						default: true,
						description: 'Include verse numbers in the text (default: true)'
					},
					format: {
						type: 'string',
						enum: ['text', 'usfm', 'json', 'md', 'markdown'],
						default: 'json',
						description: 'Output format (default: "json")'
					},
					resource: {
						type: 'string',
						default: 'all',
						description: 'Scripture resource type(s) - single resource (ult, ust, t4t, ueb), comma-separated (ult,ust), or "all" for all available'
					},
					includeAlignment: {
						type: 'boolean',
						default: false,
						description: 'Include word alignment data (only available with USFM format)'
					}
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
					reference: {
						type: 'string',
						description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					includeIntro: {
						type: 'boolean',
						default: true,
						description: 'Include book and chapter introduction notes for context (default: true)'
					},
					includeContext: {
						type: 'boolean',
						default: true,
						description: 'Include contextual notes from related passages (default: true)'
					},
					format: {
						type: 'string',
						enum: ['text', 'usfm', 'json', 'md', 'markdown'],
						default: 'json',
						description: 'Output format (default: "json")'
					}
				},
				required: ['reference']
			}
		},
		{
			name: 'fetch_translation_questions',
			description: 'Fetch translation questions for a specific Bible reference',
			inputSchema: {
				type: 'object',
				properties: {
					reference: {
						type: 'string',
						description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					format: {
						type: 'string',
						enum: ['text', 'usfm', 'json', 'md', 'markdown'],
						default: 'json',
						description: 'Output format (default: "json")'
					}
				},
				required: ['reference']
			}
		},
		{
			name: 'fetch_translation_word_links',
			description: 'Fetch translation word links (TWL) for a specific Bible reference',
			inputSchema: {
				type: 'object',
				properties: {
					reference: {
						type: 'string',
						description: 'Bible reference (e.g., "John 3:16", "Genesis 1:1-3", "Matthew 5")'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					format: {
						type: 'string',
						enum: ['text', 'usfm', 'json', 'md', 'markdown'],
						default: 'json',
						description: 'Output format (default: "json")'
					}
				},
				required: ['reference']
			}
		},
		{
			name: 'fetch_translation_word',
			description: 'Fetch translation word articles for biblical terms. Can search by term name (e.g., \'grace\', \'paul\', \'god\', \'faith\'), path, rcLink, or Bible reference. Use term parameter for questions like \'Who is Paul?\' or \'What is grace?\'',
			inputSchema: {
				type: 'object',
				properties: {
					term: {
						type: 'string',
						description: 'Translation word term to lookup (e.g., "love", "grace", "salvation", "paul", "god", "faith")'
					},
					path: {
						type: 'string',
						description: 'Explicit path to the resource file (e.g., bible/kt/love.md)'
					},
					rcLink: {
						type: 'string',
						description: 'RC link to the resource (e.g., "rc://*/tw/dict/bible/kt/love")'
					},
					reference: {
						type: 'string',
						minLength: 3,
						maxLength: 50,
						description: 'Bible reference (e.g., "John 3:16") - use term instead for term lookups'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					category: {
						type: 'string',
						description: 'Filter by category (kt, names, other) - only used with reference'
					}
				},
				required: []
			}
		},
		{
			name: 'fetch_translation_academy',
			description: 'Fetch translation academy (tA) modules and training content',
			inputSchema: {
				type: 'object',
				properties: {
					moduleId: {
						type: 'string',
						description: 'Academy module ID (e.g., "figs-metaphor"). Searches in order: translate, process, checking, intro'
					},
					path: {
						type: 'string',
						description: 'Explicit path to the resource file (e.g., bible/kt/love.md)'
					},
					rcLink: {
						type: 'string',
						description: 'RC link to the resource (e.g., "rc://*/tw/dict/bible/kt/love")'
					},
					language: {
						type: 'string',
						default: 'en',
						description: 'Language code (default: "en")'
					},
					organization: {
						type: 'string',
						default: 'unfoldingWord',
						description: 'Organization (default: "unfoldingWord")'
					},
					format: {
						type: 'string',
						enum: ['text', 'usfm', 'json', 'md', 'markdown'],
						default: 'json',
						description: 'Output format (default: "json")'
					}
				},
				required: []
			}
		},
		{
			name: 'list_languages',
			description: 'List all available languages from the Door43 catalog. Returns structured language data (codes, names, display names) that can be directly reused as language parameters in other tools.',
			inputSchema: {
				type: 'object',
				properties: {
					organization: {
						type: 'string',
						description: 'Filter languages by organization (e.g., "unfoldingWord"). If not provided, returns all languages from all organizations.'
					},
					stage: {
						type: 'string',
						default: 'prod',
						description: 'Resource stage (default: "prod")'
					}
				},
				required: []
			}
		},
		{
			name: 'list_subjects',
			description: 'List all available resource subjects (resource types) from the Door43 catalog. Returns structured subject data (names, descriptions, resource types) that can be used to discover what resource types are available.',
			inputSchema: {
				type: 'object',
				properties: {
					language: {
						type: 'string',
						description: 'Filter subjects by language code (e.g., "en", "es-419"). If not provided, returns all subjects.'
					},
					organization: {
						type: 'string',
						description: 'Filter subjects by organization (e.g., "unfoldingWord"). If not provided, returns all subjects from all organizations.'
					},
					stage: {
						type: 'string',
						default: 'prod',
						description: 'Resource stage (default: "prod")'
					}
				},
				required: []
			}
		},
		{
			name: 'list_resources_for_language',
			description: 'RECOMMENDED: List all available resources for a specific language. Fast single API call (~1-2 seconds). Given a language code (e.g., \'en\', \'fr\', \'es-419\'), returns all resources available in that language organized by subject/resource type. Suggested workflow: 1) Use list_languages to discover available languages (~1s), 2) Use this tool to see what resources exist for a chosen language (~1-2s), 3) Use specific fetch tools to get the actual content.',
			inputSchema: {
				type: 'object',
				properties: {
					language: {
						type: 'string',
						minLength: 2,
						description: 'Language code (e.g., "en", "es", "fr", "es-419"). Required.'
					},
					organization: {
						oneOf: [
							{ type: 'string' },
							{ type: 'array', items: { type: 'string' } }
						],
						description: 'Organization(s) to filter by. Can be a single organization (string), multiple organizations (array), or omitted to search all organizations.'
					},
					stage: {
						type: 'string',
						default: 'prod',
						description: 'Resource stage (default: "prod")'
					},
					subject: {
						oneOf: [
							{ type: 'string' },
							{ type: 'array', items: { type: 'string' } }
						],
						description: 'Comma-separated list or array of subjects to search for (e.g., "Bible", "Translation Words,Translation Academy"). If not provided, searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.'
					},
					limit: {
						type: 'number',
						minimum: 1,
						maximum: 10000,
						description: 'Maximum number of resources to return per request. If not specified, fetches all available resources (up to 10000).'
					},
					topic: {
						type: 'string',
						default: 'tc-ready',
						description: 'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Defaults to "tc-ready". Topics are metadata tags that indicate resource status or readiness.'
					}
				},
				required: ['language']
			}
		}
	];

	return tools;
}
