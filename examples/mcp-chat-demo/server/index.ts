/**
 * Standalone API (optional). Default dev flow uses Vite middleware — see `vite.config.ts`.
 */
import { createApiApp } from "./app.js";
import { loadDemoEnv } from "./env.js";

loadDemoEnv();

const PORT = Number(process.env.SERVER_PORT ?? 5275);
const app = createApiApp();

app.listen(PORT, () => {
  console.log(`[mcp-chat server] http://127.0.0.1:${PORT}`);
  console.log(
    `[mcp-chat server] OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "MISSING"}`,
  );
  console.log(
    `[mcp-chat server] MCP_URL default: ${process.env.MCP_URL ?? "https://tc-helps.mcp.servant.bible/api/mcp"}`,
  );
  console.log(
    `[mcp-chat server] OPENAI_MODEL: ${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
  );
});
