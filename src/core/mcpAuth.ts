/**
 * Optional Bearer / X-Api-Key checks for MCP HTTP surfaces.
 *
 * When MCP_API_KEY is unset, anonymous public access is allowed (current prod).
 * When set, require Authorization: Bearer <key> or X-Api-Key: <key>.
 */

export function enforceOptionalMcpApiKey(
  request: Request,
  apiKey: string | undefined,
  cors: Record<string, string> = {},
): Response | null {
  if (!apiKey) return null;

  const provided = extractApiKey(request);
  if (provided === apiKey) return null;

  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message:
          "Valid MCP API key required. Pass Authorization: Bearer <key> or X-Api-Key.",
        retryable: false,
      },
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="translation-helps-mcp"',
        ...cors,
      },
    },
  );
}

function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const headerKey = request.headers.get("X-Api-Key")?.trim();
  return headerKey || null;
}
