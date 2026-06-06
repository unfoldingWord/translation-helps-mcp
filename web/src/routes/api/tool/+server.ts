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
 *
 * Env resolution for new workflow tools that need API_BASE_URL:
 *   1. platform.env.API_BASE_URL  (wrangler dev — set in wrangler.toml [vars])
 *   2. platform.env.API           (Cloudflare service binding — production / wrangler dev)
 *   3. process.env.API_BASE_URL   (vite dev — set in web/.env)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import type { Env } from '$mcp/agent.js';

// ---------------------------------------------------------------------------
// New workflow tools (primary MCP surface)
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
// Legacy tools (kept for ContextHarness / backward compat)
// ---------------------------------------------------------------------------
import { getBundleTool } from '$mcp/tools/getBundle.js';
import { fetchScriptureTool } from '$mcp/tools/fetchScripture.js';
import { fetchTranslationNotesTool } from '$mcp/tools/fetchTranslationNotes.js';
import { fetchTranslationQuestionsTool } from '$mcp/tools/fetchTranslationQuestions.js';
import { fetchTranslationWordTool } from '$mcp/tools/fetchTranslationWord.js';
import { fetchTranslationWordLinksTool } from '$mcp/tools/fetchTranslationWordLinks.js';
import { fetchTranslationAcademyTool } from '$mcp/tools/fetchTranslationAcademy.js';
import { listSubjectsTool } from '$mcp/tools/listSubjects.js';
import { listResourcesForLanguageTool } from '$mcp/tools/listResourcesForLanguage.js';
import { listResourcesByLanguageTool } from '$mcp/tools/listResourcesByLanguage.js';
import { listTranslationAcademyTool } from '$mcp/tools/listTranslationAcademy.js';
import { listTranslationWordsTool } from '$mcp/tools/listTranslationWords.js';
import { searchArticlesTool } from '$mcp/tools/searchArticles.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOL_REGISTRY: Record<string, any> = {
	// New workflow tools (primary MCP surface)
	list_languages: listLanguagesTool,
	get_passage: getPassageTool,
	get_passage_context: getPassageContextTool,
	get_passage_index: getPassageIndexTool,
	get_note: getNoteTool,
	get_academy_article: getAcademyArticleTool,
	get_word_article: getWordArticleTool,
	get_questions: getPassageQuestionsTool,
	search_articles: searchArticlesWorkflowTool,
	// Legacy tools — callable by the harness via HTTP but NOT shown to LLMs
	get_bundle: getBundleTool,
	fetch_scripture: fetchScriptureTool,
	fetch_translation_notes: fetchTranslationNotesTool,
	fetch_translation_questions: fetchTranslationQuestionsTool,
	fetch_translation_word: fetchTranslationWordTool,
	fetch_translation_word_links: fetchTranslationWordLinksTool,
	fetch_translation_academy: fetchTranslationAcademyTool,
	list_subjects: listSubjectsTool,
	list_resources_for_language: listResourcesForLanguageTool,
	list_resources_by_language: listResourcesByLanguageTool,
	list_translation_academy: listTranslationAcademyTool,
	list_translation_words: listTranslationWordsTool,
	search_articles_legacy: searchArticlesTool
};

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

	const tool = TOOL_REGISTRY[name];
	if (!tool) {
		return json({ error: `Unknown tool: "${name}"` }, { status: 404 });
	}

	// Build env: platform.env (wrangler dev / Cloudflare) + process.env fallbacks (vite dev)
	const baseEnv = (platform?.env ?? {}) as Partial<Env>;
	const apiBaseUrl: string | undefined =
		baseEnv.API_BASE_URL ??
		(typeof process !== 'undefined' ? process.env?.API_BASE_URL : undefined) ??
		privateEnv?.API_BASE_URL;
	const env = { ...baseEnv, API_BASE_URL: apiBaseUrl } as unknown as Env;

	try {
		// Validate params against the tool's Zod schema
		const validated = tool.inputSchema.parse(params);

		// Call the handler with the resolved env
		const result = await tool.handler(validated as never, env, requestId);

		return json({ structuredContent: result.structuredContent, content: result.content });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[api/tool] error in "${name}":`, message);
		return json({ error: message }, { status: 400 });
	}
};
