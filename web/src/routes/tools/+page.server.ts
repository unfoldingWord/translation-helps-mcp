import { base } from '$app/paths';
import { buildMcpManifest } from '$mcp/manifest.js';
import { buildToolCatalog } from '$lib/catalog';

// Runs when the page is prerendered, so the server's code never ships to the browser.
export const load = () => ({
	tools: buildToolCatalog(buildMcpManifest({ mcpEndpoint: `${base}/mcp` }))
});
