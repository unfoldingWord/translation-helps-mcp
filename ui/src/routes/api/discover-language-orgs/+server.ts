/**
 * Language-Organization Discovery Endpoint
 * Returns available language-organization combinations from Door43 catalog
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { discoverLanguageOrgs } from '$lib/../../../src/functions/discover-language-orgs.js';

export const GET: RequestHandler = async () => {
	try {
		const result = await discoverLanguageOrgs();
		return json(result);
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'Failed to discover language-org combinations',
				options: [],
				metadata: {
					responseTime: 0,
					timestamp: new Date().toISOString(),
					totalLanguages: 0,
					totalOrganizations: 0
				}
			},
			{ status: 500 }
		);
	}
};

