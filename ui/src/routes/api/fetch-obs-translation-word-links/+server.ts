/**
 * OBS Translation Word Links Endpoint (issue #35)
 *
 * Rows from twl_OBS.tsv filtered by an OBS story:frame reference: the key
 * terms of those frames, each with the translationWord article it points to.
 */

import { createCORSHandler } from '$lib/simpleEndpoint.js';
import { createOBSHelpsEndpoint } from '$lib/obsHelpsEndpoint.js';

export const GET = createOBSHelpsEndpoint('twl', 'obs-translation-word-links');

// CORS handler
export const OPTIONS = createCORSHandler();
