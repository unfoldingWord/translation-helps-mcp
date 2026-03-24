/**
 * Node-side MCP HTTP client (same protocol as browser `src/mcpHttp.ts`).
 */

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

async function postMcp(
  serverUrl: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(serverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: params ?? {} }),
  });

  const data = (await res.json()) as {
    error?: { message?: string; code?: number };
    result?: unknown;
  };

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${data.error?.message ?? res.statusText}`,
    );
  }

  if (data.error) {
    throw new Error(data.error.message ?? "MCP error");
  }

  return data.result !== undefined ? data.result : data;
}

export interface McpHttpClient {
  readonly serverUrl: string;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export async function createMcpHttpClient(
  serverUrl: string,
): Promise<McpHttpClient> {
  await postMcp(serverUrl, "initialize", {
    protocolVersion: "2024-11-05",
  });

  return {
    serverUrl,
    async listTools() {
      const result = (await postMcp(serverUrl, "tools/list", {})) as {
        tools?: McpToolDefinition[];
      };
      return result.tools ?? [];
    },
    async callTool(name: string, args: Record<string, unknown>) {
      return (await postMcp(serverUrl, "tools/call", {
        name,
        arguments: args,
      })) as McpToolResult;
    },
  };
}

export function mcpResultToString(
  result: McpToolResult,
  maxChars = 14000,
): string {
  const content = result.content;
  if (Array.isArray(content) && content.length > 0) {
    const parts = content.map((c) => {
      if (c.type === "text" && typeof c.text === "string") {
        return c.text;
      }
      return JSON.stringify(c);
    });
    const joined = parts.join("\n");
    return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined;
  }
  const s = JSON.stringify(result, null, 2);
  return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
}
