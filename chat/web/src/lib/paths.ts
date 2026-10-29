/**
 * Base-path helpers so the app can be served under `/v2` (or any kit.paths.base)
 * without hardcoding the prefix in every fetch/link.
 */
import { base } from '$app/paths';

/** Prefix an app-absolute path with the SvelteKit base (e.g. `/chat` → `/v2/chat`). */
export function withBase(path: string): string {
	if (!path.startsWith('/')) return path;
	if (path === '/') return base || '/';
	return `${base}${path}`;
}

/** Fetch a same-origin API/route under the configured base path. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(withBase(path), init);
}
