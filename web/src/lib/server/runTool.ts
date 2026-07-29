/**
 * In-process MCP tool runner for Cloudflare Workers.
 *
 * Chat/agent must NOT `fetch()` the same Worker's `/api/tool` URL — that hits
 * Cloudflare error 1042 (Worker→Worker same-zone fetch). Call handlers here
 * with `platform.env` instead (service bindings stay available).
 *
 * Tool registry is imported from the canonical src/mcp/toolRegistry.
 */

import type { Env } from '$mcp/agent.js';
import { env as privateEnv } from '$env/dynamic/private';
import { TOOL_REGISTRY as CANONICAL_REGISTRY } from '$mcp/toolRegistry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOL_REGISTRY: Record<string, any> = CANONICAL_REGISTRY;

export type ToolEnv = Partial<Env> & Record<string, unknown>;

/** True when we can run tools in-process (service binding and/or API base URL). */
export function canRunToolsInProcess(env: ToolEnv | null | undefined): boolean {
	if (!env) return false;
	return Boolean(env.API || env.API_BASE_URL);
}

/** Merge platform.env with process/private env fallbacks for ApiClient. */
export function resolveToolEnv(platformEnv: ToolEnv | null | undefined): Env {
	const baseEnv = (platformEnv ?? {}) as ToolEnv;
	const apiBaseUrl: string | undefined =
		(baseEnv.API_BASE_URL as string | undefined) ??
		(typeof process !== 'undefined' ? process.env?.API_BASE_URL : undefined) ??
		privateEnv?.API_BASE_URL;
	return { ...baseEnv, API_BASE_URL: apiBaseUrl } as unknown as Env;
}

export async function runToolInProcess(
	name: string,
	params: Record<string, unknown>,
	platformEnv: ToolEnv | null | undefined,
	requestId?: string
): Promise<unknown> {
	const tool = TOOL_REGISTRY[name];
	if (!tool) {
		throw new Error(`Unknown tool: "${name}"`);
	}

	const env = resolveToolEnv(platformEnv);
	const validated = tool.inputSchema.parse(params);
	const id = requestId ?? crypto.randomUUID();
	const result = await tool.handler(validated as never, env, id);
	return result.structuredContent ?? result;
}
