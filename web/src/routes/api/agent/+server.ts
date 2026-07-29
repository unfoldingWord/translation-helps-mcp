/**
 * POST /api/agent
 *
 * Multi-agent SSE endpoint. Routes requests to Scholar or Checker agent.
 *
 * Request body: { agent: 'scholar' | 'checker', action: { type: string, [key]: any }, context?: string }
 *
 * SSE frame types:
 *   event: status    data: {"text":"…"}
 *   event: token     data: {"delta":"…"}
 *   event: ui        data: UIComponent (e.g. academy_article)
 *   event: done      data: { citations?: […] }
 *   event: error     data: {"message":"…"}
 */

import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import { createSkill } from '$lib/server/skillChat.js';
import {
	runPhraseDrill,
	runExplainWord,
	runExplainResource,
	runResourceChat
} from '$lib/server/agents/scholarAgent.js';
import { runDraftCheck } from '$lib/server/agents/checkerAgent.js';
import type {
	DrillChallenge,
	ResourceChatPayload,
	ScriptureContext
} from '$lib/server/agents/scholarAgent.js';
import type { CheckerNote, CheckerQuestion } from '$lib/server/agents/checkerAgent.js';

export const POST: RequestHandler = async ({ request, platform, url }) => {
	let body: { agent?: string; action?: Record<string, unknown>; context?: string };
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const openaiKey = platform?.env?.OPENAI_API_KEY ?? privateEnv.OPENAI_API_KEY;
	if (!openaiKey) return new Response('No API key configured', { status: 500 });

	const mcpBaseUrl = platform?.env?.MCP_BASE_URL ?? privateEnv.MCP_BASE_URL;
	// Do not spread platform.env — Cloudflare bindings are non-enumerable.
	const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
	const { callTool, llm } = createSkill(
		(platform?.env as Record<string, unknown> | undefined) ?? {
			OPENAI_API_KEY: openaiKey,
			MCP_BASE_URL: mcpBaseUrl
		},
		url.origin,
		'gpt-4o',
		waitUntil ? { waitUntil } : undefined
	);

	const stream = new ReadableStream({
		async start(controller) {
			const encode = (event: string, data: unknown) =>
				`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

			const enqueue = (frame: string) => {
				try {
					controller.enqueue(new TextEncoder().encode(frame));
				} catch {
					// stream already closed
				}
			};

			const emit = {
				status: (text: string) => enqueue(encode('status', { text })),
				token: (delta: string) => enqueue(encode('token', { delta }))
			};

			try {
				const { agent, action } = body;

				if (agent === 'scholar') {
					if (action?.type === 'drill_challenge') {
						const challenge = action.challenge as DrillChallenge;
						const language = String(action.language ?? 'en');
						const { response, citations } = await runPhraseDrill(
							challenge,
							language,
							{ callTool, llm },
							emit
						);
						emit.token(response);
						enqueue(encode('done', { citations }));
					} else if (action?.type === 'explain_word') {
						const wordPath = String(action.wordPath ?? '');
						const term = String(action.term ?? '');
						const language = String(action.language ?? 'en');
						const { response } = await runExplainWord(
							wordPath,
							term,
							language,
							{ callTool, llm },
							emit
						);
						emit.token(response);
						enqueue(encode('done', {}));
					} else if (action?.type === 'explain_resource') {
						const resource = action.resource as ResourceChatPayload;
						const language = String(action.language ?? 'en');
						const scripture = (action.scripture ?? null) as ScriptureContext | null;
						const { response, citations, article } = await runExplainResource(
							resource,
							scripture,
							language,
							{ callTool, llm },
							emit
						);
						if (article) {
							enqueue(
								encode('ui', {
									type: 'academy_article',
									path: article.path,
									title: article.title,
									markdown: article.markdown,
									language: article.language
								})
							);
						}
						emit.token(response);
						enqueue(encode('done', { citations }));
					} else if (action?.type === 'resource_chat') {
						const resource = action.resource as ResourceChatPayload;
						const question = String(action.question ?? '');
						const thread = (action.thread ?? []) as Array<{
							role: 'user' | 'assistant';
							content: string;
						}>;
						const language = String(action.language ?? 'en');
						const globalContext = String(body.context ?? '');
						const scripture = (action.scripture ?? null) as ScriptureContext | null;
						const { response } = await runResourceChat(
							resource,
							question,
							thread,
							globalContext,
							language,
							{ callTool, llm },
							emit,
							scripture
						);
						emit.token(response);
						enqueue(encode('done', {}));
					} else {
						enqueue(encode('error', { message: `Unknown scholar action: ${action?.type}` }));
					}
				} else if (agent === 'checker') {
					if (action?.type === 'check_draft') {
						const draft = String(action.draft ?? '');
						const reference = String(action.reference ?? '');
						const language = String(action.language ?? 'en');
						const tnNotes = (action.tnNotes ?? []) as CheckerNote[];
						const tqQuestions = (action.tqQuestions ?? []) as CheckerQuestion[];
						const { response } = await runDraftCheck(
							draft,
							reference,
							language,
							tnNotes,
							tqQuestions,
							{ llm },
							emit
						);
						emit.token(response);
						enqueue(encode('done', {}));
					} else {
						enqueue(encode('error', { message: `Unknown checker action: ${action?.type}` }));
					}
				} else {
					enqueue(encode('error', { message: `Unknown agent: ${agent}` }));
				}
			} catch (e) {
				enqueue(encode('error', { message: e instanceof Error ? e.message : String(e) }));
			} finally {
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
