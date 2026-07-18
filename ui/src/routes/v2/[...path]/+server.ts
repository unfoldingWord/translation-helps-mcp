/**
 * Fallback reverse proxy for /v2/* (kept for direct hits that bypass hooks).
 *
 * Prefer hooks.server.ts — it also covers SvelteKit `__data.json` requests
 * that never reach this route handler.
 */
import type { RequestHandler } from './$types';

const V2_FALLBACK_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev';

export const trailingSlash = 'ignore';

const proxy: RequestHandler = async ({ request, platform }) => {
	const binding = platform?.env?.V2;
	if (binding) {
		return binding.fetch(request);
	}

	const url = new URL(request.url);
	const target = new URL(url.pathname + url.search, V2_FALLBACK_ORIGIN);
	return fetch(new Request(target, request));
};

export const fallback = proxy;
