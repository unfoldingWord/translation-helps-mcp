/**
 * OBS Study Questions Endpoint (issue #32)
 *
 * Rows from sq_OBS.tsv filtered by an OBS story:frame reference. This
 * resource carries `front` rows and frame-range references like "1:1-8".
 */

import { createCORSHandler } from '$lib/simpleEndpoint.js';
import { createOBSHelpsEndpoint } from '$lib/obsHelpsEndpoint.js';

export const GET = createOBSHelpsEndpoint('sq', 'obs-study-questions');

// CORS handler
export const OPTIONS = createCORSHandler();
