import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server';

const ORIGIN = 'https://example.com';

function createHandleArgs(path: string, method = 'GET', platform?: any) {
	const url = new URL(path, ORIGIN);
	const request = new Request(url, { method });
	const resolve = vi.fn(async () => new Response('resolved', { status: 200 }));

	return {
		event: { url, request, platform } as any,
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
			['/docs/BUILD_CLIENT_FOR_REMOTE_SERVER?format=md', '/v2/docs?format=md']
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
		const { event, resolve } = createHandleArgs('/about?lang=en', 'POST');
		const response = await handle({ event, resolve } as any);

		expect(response.status).toBe(200);
		expect(response.headers.get('location')).toBeNull();
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('does not redirect API, MCP, Svelte internals, and static files', async () => {
		const passthroughPaths = [
			'/api/mcp',
			'/api/fetch-scripture?reference=John%203%3A16',
			'/mcp',
			'/_app/immutable/chunks/main.js',
			'/robots.txt'
		];

		for (const path of passthroughPaths) {
			const { event, resolve } = createHandleArgs(path);
			const response = await handle({ event, resolve } as any);

			expect(response.status).toBe(200);
			expect(response.headers.get('location')).toBeNull();
			expect(resolve).toHaveBeenCalledOnce();
		}
	});

	it('keeps proxy behavior for /v2 routes', async () => {
		const v2Fetch = vi.fn(async () => new Response('proxied-v2', { status: 200 }));
		const { event, resolve } = createHandleArgs('/v2/docs?topic=overview', 'GET', {
			env: { V2: { fetch: v2Fetch } }
		});
		const response = await handle({ event, resolve } as any);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('proxied-v2');
		expect(v2Fetch).toHaveBeenCalledOnce();
		expect(resolve).not.toHaveBeenCalled();
	});
});
