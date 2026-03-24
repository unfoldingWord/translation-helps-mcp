import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { buildSystemPrompt } from "./systemPrompt.js";
import {
  createMcpHttpClient,
  mcpResultToString,
  type McpHttpClient,
} from "./mcpHttp.js";

function listedToolsToOpenAI(
  tools: Awaited<ReturnType<McpHttpClient["listTools"]>>,
) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: (t.description ?? "").slice(0, 8000),
      parameters: normalizeParameters(t.inputSchema),
    },
  }));
}

function normalizeParameters(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const s = schema as Record<string, unknown>;
  if (s.type === "object" || s.properties) {
    return schema;
  }
  return { type: "object", properties: {} };
}

export async function runOpenAiMcpChat(options: {
  openai: OpenAI;
  model: string;
  mcpUrl: string;
  userMessage: string;
  priorMessages: Array<{ role: "user" | "assistant"; content: string }>;
  maxIterations?: number;
}): Promise<string> {
  const {
    openai,
    model,
    mcpUrl,
    userMessage,
    priorMessages,
    maxIterations = 12,
  } = options;

  const mcp = await createMcpHttpClient(mcpUrl);
  const listed = await mcp.listTools();
  const tools = listedToolsToOpenAI(listed);
  const system = buildSystemPrompt(listed);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  let iteration = 0;
  while (iteration < maxIterations) {
    iteration++;

    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const choice = response.choices[0]?.message;
    if (!choice) {
      return "No response from the model.";
    }

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      return choice.content?.trim() || "(empty reply)";
    }

    messages.push({
      role: "assistant",
      content: choice.content,
      tool_calls: choice.tool_calls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      try {
        const result = await mcp.callTool(fn.name, args);
        const text = mcpResultToString(result);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: text,
        });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error calling tool ${fn.name}: ${err}`,
        });
      }
    }
  }

  return "Stopped: too many tool rounds. Try a simpler question.";
}
