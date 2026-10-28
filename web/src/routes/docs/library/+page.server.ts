import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** The old library page: the packages are now on the SDKs page. */
export const load: PageServerLoad = () => {
	throw redirect(308, `${base}/docs/sdks`);
};
