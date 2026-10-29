import { dev } from '$app/environment';

// we don't need any JS on this page, though we'll load
// it in dev so that we get hot module replacement
export const csr = dev;

// Not prerendered: a static asset would bypass the /v2 redirect in hooks.server.ts
export const prerender = false;
