import { API_MANIFEST } from '$api/manifest.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { manifest: API_MANIFEST };
};
