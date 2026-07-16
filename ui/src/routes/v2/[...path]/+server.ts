/**
 * Reverse proxy for the v2 app.
 *
 * Everything under /v2 (website, /v2/mcp, /v2/api/*) is served by the
 * translation-helps-mcp-v2 worker. This route forwards the request over the
 * `V2` service binding (configured in the Pages project settings), keeping a
 * single public entry point on the v1 domain.
 *
 * Falls back to the public workers.dev URL when the binding is missing
 * (local dev, or preview environments without the binding configured).
 */
import type { RequestHandler } from './$types';

const V2_FALLBACK_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev';

// Don't normalize trailing slashes: the v2 app serves its root at /v2/ and
// redirects /v2 → /v2/, so v1's default 308 /v2/ → /v2 would cause a loop.
export const trailingSlash = 'ignore';

const proxy: RequestHandler = async ({ request, platform }) => {
	const binding = platform?.env?.V2;
	if (binding) {
		// Service binding: same-thread call, preserves streaming/SSE and body.
		return binding.fetch(request);
	}

	const url = new URL(request.url);
	const target = new URL(url.pathname + url.search, V2_FALLBACK_ORIGIN);
	return fetch(new Request(target, request));
};

// A lone `fallback` export handles every HTTP method for this route.
export const fallback = proxy;
