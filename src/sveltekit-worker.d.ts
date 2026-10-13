/**
 * The worker that SvelteKit's Cloudflare adapter generates at build time
 * (`web/.svelte-kit/cloudflare/_worker.js`), which `src/worker.ts` hands every
 * request it does not answer itself.
 *
 * The file has no types of its own and does not exist before the web build, so
 * a type check that runs without building (CI's Typecheck job) could not
 * resolve the import. It is declared here by what it is: a module worker with a
 * fetch handler.
 */
declare module "*/.svelte-kit/cloudflare/_worker.js" {
  const worker: {
    fetch(
      request: Request,
      env: unknown,
      ctx: ExecutionContext,
    ): Response | Promise<Response>;
  };
  export default worker;
}
