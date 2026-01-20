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
		inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' })
	}));
}
