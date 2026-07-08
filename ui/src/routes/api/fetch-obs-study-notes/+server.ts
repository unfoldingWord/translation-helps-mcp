/**
 * OBS Study Notes Endpoint (issue #32)
 *
 * Rows from sn_OBS.tsv filtered by an OBS story:frame reference.
 */

import { createCORSHandler } from '$lib/simpleEndpoint.js';
import { createOBSHelpsEndpoint } from '$lib/obsHelpsEndpoint.js';

export const GET = createOBSHelpsEndpoint('sn', 'obs-study-notes');

// CORS handler
export const OPTIONS = createCORSHandler();
