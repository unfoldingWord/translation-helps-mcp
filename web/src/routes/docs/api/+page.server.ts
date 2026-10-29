import { API_MANIFEST } from '$api/manifest.js';

// The endpoint list comes from the API's own manifest (also served at GET /api/v1/_manifest).
export const load = () => ({ manifest: API_MANIFEST });
