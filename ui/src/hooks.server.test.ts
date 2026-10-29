import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server';

const ORIGIN = 'https://example.com';

function createHandleArgs(path: string, method = 'GET', platform?: any, isDataRequest = false) {
	const url = new URL(path, ORIGIN);
	const request = new Request(url, { method });
	const resolve = vi.fn(async () => new Response('resolved', { status: 200 }));

	return {
		event: { url, request, platform, isDataRequest } as any,
		resolve
	};
}

describe('hooks.server handle', () => {
	it('redirects v1 pages to the expected v2 routes and keeps query strings', async () => {
		const redirects = [
			['/?lang=es&stage=prod', '/v2/?lang=es&stage=prod'],
			['/about?lang=es', '/v2/?lang=es'],
			['/changelog?format=md', '/v2/?format=md'],
			['/performance?debug=true', '/v2/?debug=true'],
			['/rag-manifesto?mode=full', '/v2/?mode=full'],
			['/whitepaper?download=1', '/v2/?download=1'],
			['/getting-started?lang=es', '/v2/connect?lang=es'],
			['/mcp-tools?subject=ta', '/v2/tools?subject=ta'],
			['/api-explorer?reference=Titus%201%3A1', '/v2/try?reference=Titus%201%3A1'],
			['/api-explorer-v2?reference=John%203%3A16', '/v2/try?reference=John%203%3A16'],
			['/chat?topic=notes', '/v2/docs?topic=notes'],
			['/chat/sdk-integration?sdk=js', '/v2/docs?sdk=js'],
			['/docs/BUILD_CLIENT_FOR_REMOTE_SERVER?format=md', '/v2/docs?format=md'],
			['/docs', '/v2/docs'],
			['/docs/', '/v2/docs'],
			['/mcp-tools/', '/v2/tools'],
			['/about/?lang=es', '/v2/?lang=es']
		] as const;

		for (const [source, target] of redirects) {
			const { event, resolve } = createHandleArgs(source);
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(302);
			expect(response.headers.get('location')).toBe(target);
			expect(resolve).not.toHaveBeenCalled();
		}
	});

	it('redirects HEAD requests the same as GET', async () => {
		const { event, resolve } = createHandleArgs('/about?lang=en', 'HEAD');
		const response = await handle({ event, resolve } as any);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/v2/?lang=en');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('never redirects non-GET and non-HEAD methods', async () => {
		const requests = [
			['/about?lang=en', 'POST'],
			['/', 'POST'],
			['/', 'OPTIONS'],
			['/mcp-tools', 'PUT'],
			['/chat', 'DELETE']
		] as const;

		for (const [path, method] of requests) {
			const { event, resolve } = createHandleArgs(path, method);
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(response.headers.get('location')).toBeNull();
			expect(resolve).toHaveBeenCalledOnce();
		}
	});

	it('does not redirect __data.json requests', async () => {
		for (const path of ['/chat?x-sveltekit-invalidated=01', '/mcp-tools', '/']) {
			const { event, resolve } = createHandleArgs(path, 'GET', undefined, true);
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(response.headers.get('location')).toBeNull();
			expect(resolve).toHaveBeenCalledOnce();
		}
	});

	it('does not redirect API, MCP, Svelte internals, static files, or unlisted subpaths', async () => {
		const passthrough = [
			['/api/mcp', 'GET'],
			['/api/mcp', 'HEAD'],
			['/api/fetch-scripture?reference=John%203%3A16', 'GET'],
			['/mcp', 'GET'],
			['/mcp', 'HEAD'],
			['/_app/immutable/chunks/main.js', 'GET'],
			['/robots.txt', 'GET'],
			['/WHITEPAPER.md', 'GET'],
			['/api-explorer/x', 'GET'],
			['/chatter', 'GET'],
			['/docsx', 'GET']
		] as const;

		for (const [path, method] of passthrough) {
			const { event, resolve } = createHandleArgs(path, method);
			const response = await handle({ event, resolve } as any);

			expect(response.status, `${method} ${path}`).toBe(200);
			expect(response.headers.get('location')).toBeNull();
			expect(resolve).toHaveBeenCalledOnce();
		}
	});

	it('does not prerender pages, so every page request reaches the hook', async () => {
		const pageModules = import.meta.glob<{ prerender?: unknown }>('./routes/**/+page.{ts,js}', {
			eager: true
		});

		expect(Object.keys(pageModules).length).toBeGreaterThan(0);
		for (const [file, module] of Object.entries(pageModules)) {
			expect(module.prerender, file).not.toBe(true);
		}
	});

	it('keeps proxy behavior for /v2 routes', async () => {
		for (const path of ['/v2/docs?topic=overview', '/v2', '/v2/']) {
			const v2Fetch = vi.fn(async () => new Response('proxied-v2', { status: 200 }));
			const { event, resolve } = createHandleArgs(path, 'GET', {
				env: { V2: { fetch: v2Fetch } }
			});
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe('proxied-v2');
			expect(v2Fetch).toHaveBeenCalledOnce();
			expect(resolve).not.toHaveBeenCalled();
		}
	});
});
