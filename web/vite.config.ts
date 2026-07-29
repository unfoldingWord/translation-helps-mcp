import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Workers SSR has no DOM — alias DOMPurify to a passthrough stub. */
function ssrSafeDompurify(): Plugin {
	const stub = path.resolve(__dirname, 'src/lib/dompurify-ssr-stub.ts');
	return {
		name: 'ssr-safe-dompurify',
		enforce: 'pre',
		resolveId(id, _importer, opts) {
			if (opts?.ssr && (id === 'isomorphic-dompurify' || id === 'dompurify')) {
				return stub;
			}
		}
	};
}

export default defineConfig({
	plugins: [ssrSafeDompurify(), tailwindcss(), sveltekit()],
	optimizeDeps: {
		exclude: ['@translation-helps/mcp-client']
	},
	resolve: {
		alias: {
			// Stub Node.js modules for Cloudflare Workers
			os: path.resolve(__dirname, 'src/lib/mcp/node-stubs.ts'),
			fs: path.resolve(__dirname, 'src/lib/mcp/node-stubs.ts'),
			'node:os': path.resolve(__dirname, 'src/lib/mcp/node-stubs.ts'),
			'node:fs': path.resolve(__dirname, 'src/lib/mcp/node-stubs.ts'),
			'node:path': path.resolve(__dirname, 'src/lib/mcp/node-stubs.ts')
		}
	},
	ssr: {
		external: ['zod', 'zod-to-json-schema', 'fflate']
	},
	build: {
		rollupOptions: {
			external: ['zod', 'zod-to-json-schema', 'fflate']
		}
	},
	server: {
		port: 8174,
		host: true,
		// Proxy /mcp to the wrangler worker in local dev
		// (In production both run as the same Cloudflare Worker)
		proxy: {
			'/mcp': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
				ws: true
			}
		},
		// Configure file watching to include parent src directory
		watch: {
			usePolling: true,
			ignored: [
				'**/node_modules/**',
				'**/.git/**',
				'**/build/**',
				'**/.svelte-kit/**',
				'**/tests/**'
			]
		},
		// Monitor changes in parent src directory
		fs: {
			allow: ['..'],
			strict: false
		}
	},
	preview: {
		port: 8175
	},
	// Vitest multi-project config — typed via assertion because Vite's
	// defineConfig omits Vitest's `test.projects` shape.
	test: {
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);
