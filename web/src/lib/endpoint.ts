import { endpointFor } from './site';

/** The staging site. It stands in for the page's own origin when there is no page (prerender). */
export const DEFAULT_ORIGIN = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev';

/**
 * The MCP endpoint of the site being viewed. In the browser it comes from the
 * page's own origin each time it is called, so a preview or a local dev server
 * talks to itself. On the server (prerender) it is the staging URL.
 */
export function endpoint(): string {
	if (typeof window !== 'undefined') return endpointFor(window.location.origin);
	return endpointFor(DEFAULT_ORIGIN);
}
