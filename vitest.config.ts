import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// src/worker.ts imports the SvelteKit Cloudflare build. That bundle needs
// Worker globals (`caches`) and may be absent before `npm run build`. MCP
// contract tests call worker.fetch and never reach the site, so Vitest
// resolves the import — and the `cloudflare:` modules pulled in by agents —
// to stubs. Node's loader cannot load the `cloudflare:` protocol.
const svelteKitWorkerStub = fileURLToPath(
  new URL("./tests/stubs/svelteKitWorker.ts", import.meta.url),
);
const cloudflareWorkersStub = fileURLToPath(
  new URL("./tests/stubs/cloudflareWorkers.ts", import.meta.url),
);
const cloudflareEmailStub = fileURLToPath(
  new URL("./tests/stubs/cloudflareEmail.ts", import.meta.url),
);

export default defineConfig({
  // agents/mcp imports cloudflare:workers. Bundle it so the plugin below can
  // replace that protocol; Node's loader cannot.
  ssr: {
    noExternal: ["agents"],
  },
  plugins: [
    {
      name: "stub-cloudflare-and-sveltekit-worker",
      enforce: "pre",
      resolveId(id) {
        if (
          id === "cloudflare:workers" ||
          id.startsWith("cloudflare:workers?")
        ) {
          return cloudflareWorkersStub;
        }
        if (id === "cloudflare:email" || id.startsWith("cloudflare:email?")) {
          return cloudflareEmailStub;
        }
        const normalized = id.replace(/\\/g, "/");
        if (normalized.includes(".svelte-kit/cloudflare/_worker.js")) {
          return svelteKitWorkerStub;
        }
        return null;
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    // Before any test file imports `agents`. Node 20 has no global WebSocket
    // or URLPattern, and agents reads both. See tests/stubs/webSocket.ts.
    setupFiles: ["./tests/stubs/webSocket.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "web/**", "packages/**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
