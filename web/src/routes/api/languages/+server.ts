/**
 * GET /api/languages
 *
 * Returns tc-ready languages from the Door43 catalog
 * (`/catalog/list/languages?topic=tc-ready`), same source as GET /api/v1/languages.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listLanguages } from '@translation-helps/door43';

export const GET: RequestHandler = async ({ platform }) => {
	const kv = platform?.env?.TRANSLATION_HELPS_CACHE ?? null;
	const languages = await listLanguages(kv);
	return json({ languages });
};
