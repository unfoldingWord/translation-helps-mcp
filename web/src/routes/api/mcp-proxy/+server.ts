/**
 * POST /api/mcp-proxy
 *
 * MCP JSON-RPC 2.0 proxy for the playground and local dev.
 *
 * - tools/list  — returns the canonical tool list (new workflow tools first,
 *                 legacy tools also available for the harness).
 * - tools/call  — forwards to the MCP worker's /api/tool endpoint so that
 *                 the worker's Cloudflare service bindings (to the REST API)
 *                 are properly in scope. Never runs tool handlers inline.
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

// ---------------------------------------------------------------------------
// New workflow tools — these are the tools shown to users and LLMs
// ---------------------------------------------------------------------------
import { listLanguagesTool } from '$mcp/tools/listLanguages.js';
import { getPassageTool } from '$mcp/tools/getPassage.js';
import { getPassageContextTool } from '$mcp/tools/getPassageContext.js';
import { getPassageIndexTool } from '$mcp/tools/getPassageIndex.js';
import { getNoteTool } from '$mcp/tools/getNote.js';
import { getAcademyArticleTool } from '$mcp/tools/getAcademyArticle.js';
import { getWordArticleTool } from '$mcp/tools/getWordArticle.js';
import { getPassageQuestionsTool } from '$mcp/tools/getPassageQuestions.js';
import { searchArticlesWorkflowTool } from '$mcp/tools/searchArticlesWorkflow.js';

// ---------------------------------------------------------------------------
// Legacy tools — kept for ContextHarness compatibility (not shown in playground)
// ---------------------------------------------------------------------------
import { getBundleTool } from '$mcp/tools/getBundle.js';
import { fetchScriptureTool } from '$mcp/tools/fetchScripture.js';
import { fetchTranslationNotesTool } from '$mcp/tools/fetchTranslationNotes.js';
import { fetchTranslationQuestionsTool } from '$mcp/tools/fetchTranslationQuestions.js';
import { fetchTranslationWordTool } from '$mcp/tools/fetchTranslationWord.js';
import { fetchTranslationWordLinksTool } from '$mcp/tools/fetchTranslationWordLinks.js';
import { fetchTranslationAcademyTool } from '$mcp/tools/fetchTranslationAcademy.js';
import { listTranslationAcademyTool } from '$mcp/tools/listTranslationAcademy.js';
import { listTranslationWordsTool } from '$mcp/tools/listTranslationWords.js';
import { searchArticlesTool } from '$mcp/tools/searchArticles.js';
import { listSubjectsTool } from '$mcp/tools/listSubjects.js';
import { listResourcesForLanguageTool } from '$mcp/tools/listResourcesForLanguage.js';

// ---------------------------------------------------------------------------
// Tool list — workflow tools come first (matching the MCP agent surface)
// ---------------------------------------------------------------------------

const WORKFLOW_TOOLS = [
	listLanguagesTool,
	getPassageTool,
	getPassageContextTool,
	getPassageIndexTool,
	getNoteTool,
	getAcademyArticleTool,
	getWordArticleTool,
	getPassageQuestionsTool,
	searchArticlesWorkflowTool
];

const LEGACY_TOOLS = [
	getBundleTool,
	fetchScriptureTool,
	fetchTranslationNotesTool,
	fetchTranslationQuestionsTool,
	fetchTranslationWordTool,
	fetchTranslationWordLinksTool,
	fetchTranslationAcademyTool,
	listTranslationAcademyTool,
	listTranslationWordsTool,
	searchArticlesTool,
	listSubjectsTool,
	listResourcesForLanguageTool
];

function buildDescriptor(tool: { name: string; description: string; inputSchema: unknown }) {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: zodToJsonSchema(tool.inputSchema as Parameters<typeof zodToJsonSchema>[0], {
			$refStrategy: 'none'
		})
	};
}

/** Workflow tools shown in the playground sidebar */
const WORKFLOW_TOOL_LIST = WORKFLOW_TOOLS.map(buildDescriptor);
/** Full list including legacy (for callers that need all names) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ALL_TOOL_LIST = [...WORKFLOW_TOOLS, ...LEGACY_TOOLS].map(buildDescriptor);

// Tool name set for quick lookup
const ALL_TOOL_NAMES = new Set([...WORKFLOW_TOOLS, ...LEGACY_TOOLS].map((t) => t.name));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rpcOk(id: unknown, result: unknown) {
	return json({ jsonrpc: '2.0', id, result });
}

function rpcErr(id: unknown, code: number, message: string) {
	return json({ jsonrpc: '2.0', id, error: { code, message } }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request, platform, url }) => {
	let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
	try {
		body = await request.json();
	} catch {
		return rpcErr(null, -32700, 'Parse error');
	}

	const { id, method, params } = body;

	// ── tools/list ────────────────────────────────────────────────────────────
	// Return the canonical workflow tool list (matches MCP agent surface).
	if (method === 'tools/list') {
		return rpcOk(id, { tools: WORKFLOW_TOOL_LIST });
	}

	// ── tools/call ────────────────────────────────────────────────────────────
	// Forward to the MCP worker's /api/tool endpoint so Cloudflare service
	// bindings (to the REST Data API) are available for the new workflow tools.
	if (method === 'tools/call') {
		const toolName = (params as { name?: string })?.name;
		const args = ((params as { arguments?: Record<string, unknown> })?.arguments) ?? {};

		if (!toolName) return rpcErr(id, -32602, 'Missing tool name');
		if (!ALL_TOOL_NAMES.has(toolName)) return rpcErr(id, -32601, `Unknown tool: "${toolName}"`);

		// Resolve the MCP worker base URL
		const mcpBase =
			platform?.env?.MCP_BASE_URL ??
			privateEnv?.MCP_BASE_URL ??
			url.origin;

		const toolUrl = `${mcpBase.replace(/\/$/, '')}/api/tool`;

		try {
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
				content: data.content ?? [],
				structuredContent: data.structuredContent
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
