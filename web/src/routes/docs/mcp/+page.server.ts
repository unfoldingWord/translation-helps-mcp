import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** The old MCP page: how to connect a client is now on /connect. */
export const load: PageServerLoad = () => {
	throw redirect(308, `${base}/connect`);
};
