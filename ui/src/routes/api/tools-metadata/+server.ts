/**
 * Tools Metadata API Endpoint
 * 
 * Dynamically generates tool/endpoint metadata from the SINGLE SOURCE OF TRUTH:
 * - Tools: src/config/tools-registry.ts
 * - Prompts: src/mcp/prompts-registry.ts
 * 
 * This ensures UI pages (mcp-tools, api-explorer) stay in sync with actual implementations.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Import SINGLE SOURCE OF TRUTH
import { TOOLS_REGISTRY } from '../../../../../src/config/tools-registry.js';
import { MCP_PROMPTS } from '../../../../../src/mcp/prompts-registry.js';

export interface ToolMetadata {
	name: string;
	mcpName: string;
	endpoint: string;
	description: string;
	category: string;
	parameters: Array<{
		name: string;
		type: string;
		required: boolean;
		description: string;
		default?: any;
		options?: string[];
		example?: string;
	}>;
	examples: Array<{
		title: string;
		description?: string;
		parameters: Record<string, any>;
		expectedResponse?: string;
	}>;
}

export interface PromptMetadata {
	name: string;
	description: string;
	arguments: Array<{
		name: string;
		description: string;
		required: boolean;
	}>;
}

export interface MetadataResponse {
	tools: ToolMetadata[];
	prompts: PromptMetadata[];
	categories: string[];
	version: string;
	generatedAt: string;
}

/**
 * Generate tool metadata from the SINGLE SOURCE OF TRUTH (tools-registry.ts)
 */
function generateToolsMetadata(): ToolMetadata[] {
	return TOOLS_REGISTRY.map(tool => ({
		name: tool.displayName,
		mcpName: tool.mcpName,
		endpoint: `/api/${tool.endpoint}`,  // Add /api/ base path for REST endpoints
		description: tool.description,
		category: tool.category,
		parameters: tool.parameters.map(param => ({
			name: param.name,
			type: param.type,
			required: param.required || false,
			description: param.description,
			default: param.default,
			options: param.options,
			example: param.example
		})),
		examples: tool.examples
	}));
}

/**
 * Generate prompt metadata from MCP prompts registry
 */
function generatePromptsMetadata(): PromptMetadata[] {
	return MCP_PROMPTS.map(prompt => ({
		name: prompt.name,
		description: prompt.description || '',
		arguments: prompt.arguments?.map(arg => ({
			name: arg.name,
			description: arg.description || '',
			required: arg.required || false
		})) || []
	}));
}

/**
 * GET handler - returns all tools and prompts metadata
 */
export const GET: RequestHandler = async () => {
	try {
		const tools = generateToolsMetadata();
		const prompts = generatePromptsMetadata();
		
		// Extract unique categories
		const categories = [...new Set(tools.map(t => t.category))].sort();

		const response: MetadataResponse = {
			tools,
			prompts,
			categories,
			version: '1.0.0',
			generatedAt: new Date().toISOString()
		};

		return json(response, {
			headers: {
				'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
				'Content-Type': 'application/json'
			}
		});
	} catch (error: any) {
		console.error('[METADATA API] Error generating metadata:', error);
		return json(
			{ 
				error: 'Failed to generate metadata',
				message: error.message 
			},
			{ status: 500 }
		);
	}
};
