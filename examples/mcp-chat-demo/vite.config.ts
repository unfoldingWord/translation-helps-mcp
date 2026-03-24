import react from "@vitejs/plugin-react";
import type { Connect } from "vite";
import { defineConfig } from "vite";
import { createApiApp } from "./server/app.ts";

function apiDevMiddleware(): {
  name: string;
  configureServer: (server: import("vite").ViteDevServer) => void;
} {
  return {
    name: "mcp-chat-demo-api",
    configureServer(server) {
      const api = createApiApp();
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        const url = req.url ?? "";
        if (url.startsWith("/api")) {
          api(req, res, next);
        } else {
          next();
        }
      };
      server.middlewares.use(handler);
    },
  };
}

// Port chosen to avoid clashing with main UI (8174) and default Vite (5173).
// In dev, `/api` is handled by Express in-process (no separate port).
export default defineConfig({
  plugins: [react(), apiDevMiddleware()],
  server: {
    port: 5274,
    strictPort: false,
  },
  /** `vite preview` has no dev middleware — proxy to standalone API if you run `npm run dev:server`. */
  preview: {
    port: 5274,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5275",
        changeOrigin: true,
      },
    },
  },
});
