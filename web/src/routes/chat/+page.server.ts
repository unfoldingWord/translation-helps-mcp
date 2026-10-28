import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** The chat moved to chat/ and is no longer part of this site; /try is its successor. */
export const load: PageServerLoad = () => {
	throw redirect(308, `${base}/try`);
};
