import { defineConfig } from '@playwright/test';

// Browser tests of the built site against local Workers. `npm run test:e2e` builds the site first:
// the MCP worker serves web/.svelte-kit/cloudflare as its assets.
// The Workers start from the repo root: web/node_modules has an older wrangler (3.x, pulled in by the
// SvelteKit adapter) that cannot load the MCP worker, so `npx wrangler` must resolve the root one (4.x).
// Ports 8796 (REST API) and 8797 (MCP + site) avoid the defaults 8787/8788 that other
// sessions use. reuseExistingServer is off so a busy port fails loudly instead of testing
// someone else's server. The tests call the real Door43 (staging data) through the API worker.
const API_PORT = 8796;
const MCP_PORT = 8797;

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	outputDir: 'test-results',
	use: {
		// The trailing slash matters: Playwright resolves paths with new URL(), so tests use relative
		// paths ("try", "docs/limits") and "" for the home page. A leading "/" would drop "/v2".
		baseURL: `http://localhost:${MCP_PORT}/v2/`,
		trace: 'retain-on-failure'
	},
	webServer: [
		{
			command: `npx wrangler dev --config wrangler.api.toml --port ${API_PORT}`,
			url: `http://localhost:${API_PORT}/health`,
			cwd: '..',
			reuseExistingServer: false,
			timeout: 300_000,
			stdout: 'ignore',
			stderr: 'pipe'
		},
		{
			command: `npx wrangler dev --config wrangler.toml --port ${MCP_PORT} --var API_BASE_URL:http://localhost:${API_PORT}`,
			url: `http://localhost:${MCP_PORT}/v2/`,
			cwd: '..',
			reuseExistingServer: false,
			timeout: 300_000,
			stdout: 'ignore',
			stderr: 'pipe'
		}
	]
});
