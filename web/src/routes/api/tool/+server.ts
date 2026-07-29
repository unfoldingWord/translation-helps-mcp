/**
 * POST /api/tool
 *
 * Internal server-side tool runner. Calls MCP tool handlers directly using
 * platform.env (Cloudflare bindings), bypassing the WebSocket-only McpAgent.
 *
 * Used by /api/chat → skillChat.ts → callTool() for server-side Skills invocation.
 * Also called by /api/mcp-proxy when MCP_BASE_URL resolves to the same origin
 * (deployed Worker) or when running under wrangler dev.
 *
 * Body: { name: string, params: Record<string, unknown>, requestId?: string }
 * Response: { structuredContent: unknown } | { error: string }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TOOL_REGISTRY, runToolInProcess, resolveToolEnv } from '$lib/server/runTool.js';

export const POST: RequestHandler = async ({ request, platform }) => {
	let body: { name?: string; params?: Record<string, unknown>; requestId?: string };

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const { name, params = {}, requestId = crypto.randomUUID() } = body;

	if (!name) {
		return json({ error: 'Missing tool name' }, { status: 400 });
	}

	if (!TOOL_REGISTRY[name]) {
		return json({ error: `Unknown tool: "${name}"` }, { status: 404 });
	}

	try {
		// Ensure env is resolved the same way as in-process chat calls
		resolveToolEnv(platform?.env as Record<string, unknown> | undefined);
		const structuredContent = await runToolInProcess(
			name,
			params,
			platform?.env as Record<string, unknown> | undefined,
			requestId
		);

		return json({
			structuredContent,
			content: [{ type: 'text', text: JSON.stringify(structuredContent) }]
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[api/tool] error in "${name}":`, message);
		return json({ error: message }, { status: 400 });
	}
};
