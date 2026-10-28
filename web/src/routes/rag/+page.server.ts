import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** Old link: the page moved to /try. */
export const load: PageServerLoad = () => {
	throw redirect(308, `${base}/try`);
};
