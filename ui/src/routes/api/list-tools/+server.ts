/**
 * List Tools - REST Endpoint
 * 
 * GET /api/list-tools
 * 
 * Returns the list of all available MCP tools with their schemas.
 * This is the REST equivalent of the MCP protocol's tools/list method.
 * 
 * Response Format (MCP spec–aligned, with optional title):
 * {
 *   tools: [
 *     {
 *       name: "fetch_scripture",
 *       title: "Fetch Scripture",
 *       description: "Fetch Bible scripture text",
 *       inputSchema: { type: "object", properties: {...}, required: [...] }
 *     },
 *     ...
 *   ],
 *   count: number,
 *   metadata: { generatedAt, source }
 * }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMCPToolsList } from '$lib/mcp/tools-list.js';

/**
 * GET handler - returns all available tools
 */
export const GET: RequestHandler = async () => {
	try {
		// Use the same function as MCP protocol for consistency
		const toolsList = getMCPToolsList();

		return json(
			{
				tools: toolsList,
				count: toolsList.length,
				// Add metadata for consistency with other discovery endpoints
				metadata: {
					generatedAt: new Date().toISOString(),
					source: 'mcp-tools-registry'
				}
			},
			{
				headers: {
					'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
					'Content-Type': 'application/json'
				}
			}
		);
	} catch (error: any) {
		console.error('[LIST TOOLS API] Error:', error);
		return json(
			{
				error: 'Failed to list tools',
				message: error.message
			},
			{ status: 500 }
		);
	}
};
