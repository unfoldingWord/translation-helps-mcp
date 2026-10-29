/**
 * Proxy /v2/* to the v2 worker before SvelteKit route matching.
 *
 * A route-level proxy at routes/v2/[...path]/+server.ts is not enough:
 * SvelteKit intercepts `__data.json` client-navigation requests itself and
 * 404s when there is no matching page — never reaching the +server handler.
 * Running the proxy in `handle` catches HTML, __data.json, MCP, and assets.
 */
import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
// Also read by scripts/check-routing.js, the post-build routing check in CI.
import V1_PAGE_REDIRECTS from '$lib/v1-page-redirects.json';

const V2_FALLBACK_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev';

function getV1RedirectTarget(pathname: string): string | undefined {
	const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

	for (const [source, target] of V1_PAGE_REDIRECTS) {
		if (source.endsWith('/*')) {
			const base = source.slice(0, -2);
			if (path === base || path.startsWith(`${base}/`)) {
				return target;
			}
			continue;
		}

		if (path === source) {
			return target;
		}
	}

	return undefined;
}

async function proxyToV2(request: Request, platform: App.Platform | undefined): Promise<Response> {
	const binding = platform?.env?.V2;
	if (binding) {
		return binding.fetch(request);
	}

	const url = new URL(request.url);
	const target = new URL(url.pathname + url.search, V2_FALLBACK_ORIGIN);
	return fetch(new Request(target, request));
}

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/v2' || event.url.pathname.startsWith('/v2/')) {
		return proxyToV2(event.request, event.platform);
	}

	if (
		!building &&
		!event.isDataRequest &&
		(event.request.method === 'GET' || event.request.method === 'HEAD')
	) {
		const redirectTarget = getV1RedirectTarget(event.url.pathname);
		if (redirectTarget) {
			const requestUrl = new URL(event.request.url);
			const location = `${redirectTarget}${requestUrl.search}`;
			return new Response(null, {
				status: 302,
				headers: { location }
			});
		}
	}

	return resolve(event);
};
