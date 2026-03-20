/**
 * Server-side load function for API Explorer page
 * Fetches dynamic endpoint metadata from unified services
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
			endpoints: metadata.tools, // API Explorer calls them "endpoints"
			categories: metadata.categories,
			version: metadata.version,
			generatedAt: metadata.generatedAt
		};
	} catch (error) {
		console.error('[API EXPLORER PAGE] Failed to load metadata:', error);
		
		// Return empty data structure on error - page will show error state
		return {
			endpoints: [],
			categories: [],
			version: '0.0.0',
			generatedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
};
