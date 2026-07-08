/**
 * OBS Translation Questions Endpoint (issue #32)
 *
 * Rows from tq_OBS.tsv filtered by an OBS story:frame reference.
 */

import { createCORSHandler } from '$lib/simpleEndpoint.js';
import { createOBSHelpsEndpoint } from '$lib/obsHelpsEndpoint.js';

export const GET = createOBSHelpsEndpoint('tq', 'obs-translation-questions');

// CORS handler
export const OPTIONS = createCORSHandler();
