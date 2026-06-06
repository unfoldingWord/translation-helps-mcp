import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			platformProxy: {
				// Simulate Cloudflare bindings (KV, R2) in vite dev so
				// platform.env is populated without running wrangler dev.
				enabled: true,
				configPath: '../wrangler.toml',
				// Persist local KV/R2 state across dev-server restarts
				persist: { path: '../.wrangler/state/v3' }
			}
		}),
		paths: {
			relative: false
		},
		// Prevent Node.js modules from being bundled for Cloudflare
		alias: {
			$lib: './src/lib',
			$core: '../src/core',
			$mcp: '../src/mcp'
		}
	}
};

export default config;
