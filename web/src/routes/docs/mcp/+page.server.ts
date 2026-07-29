import { buildMcpManifest } from '$mcp/manifest.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { manifest: buildMcpManifest({ mcpEndpoint: '/v2/mcp' }) };
};
