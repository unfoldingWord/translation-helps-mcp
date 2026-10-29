/**
 * Stand-in for web/.svelte-kit/cloudflare/_worker.js during Vitest.
 * The real file is produced by the SvelteKit build and is not imported by the
 * MCP contract tests.
 */
export default {
  fetch(): Response {
    return new Response("sveltekit stub", { status: 404 });
  },
};
