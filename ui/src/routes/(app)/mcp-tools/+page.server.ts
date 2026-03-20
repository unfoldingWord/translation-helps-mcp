/**
 * Server-side load function for MCP Tools page
 * Fetches dynamic tool metadata from unified services
 */

import type { PageServerLoad } from './$types';
import type { MetadataResponse } from '$lib/types/tools-metadata';

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		// Fetch metadata from our dynamic API
		const response = await fetch('/api/tools-metadata');
		
		if (!response.ok) {
			throw new Error(`Failed to fetch metadata: ${response.statusText}`);
		}
		
		const metadata: MetadataResponse = await response.json();
		
		return {
			tools: metadata.tools,
			prompts: metadata.prompts,
			categories: metadata.categories,
			version: metadata.version,
			generatedAt: metadata.generatedAt
		};
	} catch (error) {
		console.error('[MCP TOOLS PAGE] Failed to load metadata:', error);
		
		// Return empty data structure on error - page will show error state
		return {
			tools: [],
			prompts: [],
			categories: [],
			version: '0.0.0',
			generatedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};
