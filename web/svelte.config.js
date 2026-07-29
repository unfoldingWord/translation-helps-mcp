import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Production side-by-side deploy lives under /v2 so Pages v1 stays at the domain root.
 *  Local dev: set BASE_PATH= (empty) or omit — default is /v2 for Cloudflare builds.
 *  Override: BASE_PATH=/v2 or BASE_PATH= for root. */
const rawBase = process.env.BASE_PATH;
const BASE_PATH = rawBase === undefined ? '/v2' : rawBase === '/' ? '' : rawBase.replace(/\/$/, '');
if (BASE_PATH && !BASE_PATH.startsWith('/')) {
	throw new Error(`kit.paths.base must start with '/': got ${JSON.stringify(BASE_PATH)}`);
}

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
			base: BASE_PATH,
			relative: false
		},
		// Prevent Node.js modules from being bundled for Cloudflare
		alias: {
			$lib: './src/lib',
			$core: '../src/core',
			$mcp: '../src/mcp',
			$api: '../src/api',
			'@translation-helps/door43': '../packages/door43/src/index.ts'
		}
	}
};

export default config;
