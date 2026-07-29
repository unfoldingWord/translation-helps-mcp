/**
 * POST /api/mcp-proxy
 *
 * MCP JSON-RPC 2.0 proxy for the playground and local dev.
 *
 * - tools/list  — returns the canonical MCP_TOOLS list from toolRegistry
 * - tools/call  — runs tool handlers in-process with platform.env (service
 *                 bindings). Falls back to HTTP only when bindings are absent.
 *
 * Resolution for the MCP worker base URL:
 *   1. platform.env.MCP_BASE_URL   (wrangler dev / deployed)
 *   2. $env/dynamic/private.MCP_BASE_URL  (vite dev via web/.env)
 *   3. request origin               (same-origin deployed Worker)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { withBase } from '$lib/paths.js';
import { canRunToolsInProcess, runToolInProcess } from '$lib/server/runTool.js';
import { MCP_TOOLS, TOOL_REGISTRY } from '$mcp/toolRegistry.js';

function buildDescriptor(tool: { name: string; description: string; inputSchema: unknown }) {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: zodToJsonSchema(tool.inputSchema as Parameters<typeof zodToJsonSchema>[0], {
			$refStrategy: 'none'
		})
	};
}

/** Canonical MCP surface — same as /mcp McpAgent */
const TOOL_LIST = MCP_TOOLS.map(buildDescriptor);
const ALL_TOOL_NAMES = new Set(Object.keys(TOOL_REGISTRY));

function rpcOk(id: unknown, result: unknown) {
	return json({ jsonrpc: '2.0', id, result });
}

function rpcErr(id: unknown, code: number, message: string) {
	return json({ jsonrpc: '2.0', id, error: { code, message } }, { status: 400 });
}

export const POST: RequestHandler = async ({ request, platform, url }) => {
	let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
	try {
		body = await request.json();
	} catch {
		return rpcErr(null, -32700, 'Parse error');
	}

	const { id, method, params } = body;

	// ── tools/list ────────────────────────────────────────────────────────────
	if (method === 'tools/list') {
		return rpcOk(id, { tools: TOOL_LIST });
	}

	// ── tools/call ────────────────────────────────────────────────────────────
	if (method === 'tools/call') {
		const toolName = (params as { name?: string })?.name;
		const args = (params as { arguments?: Record<string, unknown> })?.arguments ?? {};

		if (!toolName) return rpcErr(id, -32602, 'Missing tool name');
		if (!ALL_TOOL_NAMES.has(toolName)) return rpcErr(id, -32601, `Unknown tool: "${toolName}"`);

		try {
			if (canRunToolsInProcess(platform?.env as Record<string, unknown> | undefined)) {
				const structuredContent = await runToolInProcess(
					toolName,
					args,
					platform?.env as Record<string, unknown> | undefined
				);
				return rpcOk(id, {
					structuredContent,
					content: [{ type: 'text', text: JSON.stringify(structuredContent) }]
				});
			}

			const mcpBase = platform?.env?.MCP_BASE_URL ?? privateEnv?.MCP_BASE_URL ?? url.origin;

			const toolUrl = `${String(mcpBase).replace(/\/$/, '')}${withBase('/api/tool')}`;

			const res = await fetch(toolUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: toolName, params: args })
			});

			const data = (await res.json()) as {
				structuredContent?: unknown;
				content?: unknown[];
				error?: string;
			};

			if (!res.ok || data.error) {
				return rpcOk(id, {
					isError: true,
					content: [{ type: 'text', text: data.error ?? `Tool "${toolName}" failed` }]
				});
			}

			return rpcOk(id, {
				structuredContent: data.structuredContent,
				content: data.content ?? [{ type: 'text', text: JSON.stringify(data.structuredContent) }]
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return rpcOk(id, {
				isError: true,
				content: [{ type: 'text', text: message }]
			});
		}
	}

	return rpcErr(id, -32601, `Method not found: "${method}"`);
};

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type'
		}
	});
};
