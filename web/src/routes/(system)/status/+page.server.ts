import { base } from '$app/paths';
import { buildMcpManifest } from '$mcp/manifest.js';
import { buildToolCatalog } from '$lib/catalog';
import { statusChecks } from '$lib/status';

// Runs when the page is prerendered, so the server's code never ships to the browser.
export const load = () => ({
	checks: statusChecks(buildToolCatalog(buildMcpManifest({ mcpEndpoint: `${base}/mcp` })))
});
