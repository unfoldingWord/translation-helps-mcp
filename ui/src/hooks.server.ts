/**
 * Proxy /v2/* to the v2 worker before SvelteKit route matching.
 *
 * A route-level proxy at routes/v2/[...path]/+server.ts is not enough:
 * SvelteKit intercepts `__data.json` client-navigation requests itself and
 * 404s when there is no matching page — never reaching the +server handler.
 * Running the proxy in `handle` catches HTML, __data.json, MCP, and assets.
 */
import type { Handle } from '@sveltejs/kit';

const V2_FALLBACK_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev';

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
	return resolve(event);
};
