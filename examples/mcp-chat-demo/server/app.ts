/**
 * Express app for OpenAI + MCP (used by Vite dev middleware and standalone `server/index.ts`).
 */
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import { createMcpHttpClient } from "./mcpHttp.js";
import { runOpenAiMcpChat } from "./openaiMcpChat.js";
import { loadDemoEnv } from "./env.js";

export function getDemoConfig() {
  loadDemoEnv();
  const DEFAULT_MCP =
    process.env.MCP_URL ?? "https://tc-helps.mcp.servant.bible/api/mcp";
  const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  return { DEFAULT_MCP, MODEL };
}

export function createApiApp() {
  const { DEFAULT_MCP, MODEL } = getDemoConfig();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", async (req, res) => {
    const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    const mcpUrl =
      typeof req.query.mcpUrl === "string" && req.query.mcpUrl.trim()
        ? req.query.mcpUrl.trim()
        : DEFAULT_MCP;
    let mcpOk = false;
    let mcpError: string | undefined;
    try {
      const mcp = await createMcpHttpClient(mcpUrl);
      const tools = await mcp.listTools();
      mcpOk = tools.length > 0;
    } catch (e) {
      mcpError = e instanceof Error ? e.message : String(e);
    }
    res.json({
      openaiKeyConfigured: hasKey,
      mcpDefaultUrl: DEFAULT_MCP,
      mcpUrlChecked: mcpUrl,
      mcpReachable: mcpOk,
      mcpError,
      model: MODEL,
    });
  });

  app.post("/api/chat", async (req, res) => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(503).json({
        error:
          "OPENAI_API_KEY is not set. Add it to the repo root `.env` (see `.env.example`) or export OPENAI_API_KEY.",
      });
      return;
    }

    const mcpUrl = (req.body.mcpUrl as string)?.trim() || DEFAULT_MCP;
    const message = (req.body.message as string)?.trim();
    const prior =
      (req.body.messages as Array<{ role: string; content: string }>) ?? [];

    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const priorMessages = prior
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    try {
      const openai = new OpenAI({ apiKey });
      const reply = await runOpenAiMcpChat({
        openai,
        model: MODEL,
        mcpUrl,
        userMessage: message,
        priorMessages: priorMessages,
      });
      res.json({ reply });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/chat]", msg);
      res.status(500).json({ error: msg });
    }
  });

  return app;
}
