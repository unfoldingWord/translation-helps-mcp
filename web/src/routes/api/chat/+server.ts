/**
 * POST /api/chat
 *
 * Accepts: { messages, language?, model?, profile? }
 * Returns: text/event-stream (SSE)
 *
 * SSE frame types:
 *   event: status    data: {"text":"…"}
 *   event: token     data: {"delta":"…"}
 *   event: thinking  data: {"label":"…","state":"working"|"done"}
 *   event: meta      data: { setLanguage?, setName?, awaitingLanguage?, awaitingConfirmation?, … }
 *   event: done      data: { response, citations, intent, reference, challenges, … }
 *   event: error     data: {"message":"…"}
 */

import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import {
	createSkill,
	answerStream,
	type ChatModel,
	type StreamEmit,
	type UserProfile
} from '$lib/server/skillChat.js';

export const POST: RequestHandler = async ({ request, platform }) => {
	let body: {
		messages?: { role: string; content: string }[];
		language?: string;
		model?: ChatModel;
		profile?: UserProfile;
	};

	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON body', { status: 400 });
	}

	const messages = body.messages ?? [];
	const language = body.language ?? 'en';
	const model = body.model ?? 'gpt-4o';
	const profile = body.profile;

	// Find the last user message
	const lastUser = [...messages].reverse().find((m) => m.role === 'user');
	if (!lastUser?.content?.trim()) {
		return new Response('No user message provided', { status: 400 });
	}

	// Resolve keys
	const openaiKey = platform?.env?.OPENAI_API_KEY ?? privateEnv.OPENAI_API_KEY;
	const mcpBaseUrl = platform?.env?.MCP_BASE_URL ?? privateEnv.MCP_BASE_URL;

	if (!openaiKey) {
		const errData = JSON.stringify({
			response:
				'OpenAI API key is not configured. Set OPENAI_API_KEY in web/.env (vite dev) or web/.dev.vars (wrangler dev).',
			citations: [],
			mode: 'error',
			latencyMs: 0
		});
		return new Response(`event: done\ndata: ${errData}\n\n`, {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive'
			}
		});
	}

	// Build skill context
	const skillCtx = createSkill({ OPENAI_API_KEY: openaiKey, MCP_BASE_URL: mcpBaseUrl }, '', model);

	// Prior turns (exclude last user message)
	const priorTurns = messages
		.slice(0, -1)
		.filter(
			(m): m is { role: 'user' | 'assistant'; content: string } =>
				m.role === 'user' || m.role === 'assistant'
		);

	// waitUntil support (Cloudflare Workers)
	const waitUntil =
		platform?.context?.waitUntil?.bind(platform.context) ??
		((_p: Promise<unknown>) => {
			// no-op in vite dev — the promise still runs but isn't extended
		});

	// ---------------------------------------------------------------------------
	// Build SSE ReadableStream
	// ---------------------------------------------------------------------------
	const stream = new ReadableStream({
		async start(controller) {
			const encode = (event: string, data: unknown) => {
				const json = typeof data === 'string' ? data : JSON.stringify(data);
				return `event: ${event}\ndata: ${json}\n\n`;
			};

			const enqueue = (frame: string) =>
				controller.enqueue(new TextEncoder().encode(frame));

			// Track the last time any event was emitted so the heartbeat knows
			// whether it needs to fire.
			let lastEmitAt = Date.now();
			const touch = () => { lastEmitAt = Date.now(); };

			// Keepalive heartbeat — emits a status frame every 3 s when the
			// pipeline is silent, preventing the browser from treating a live
			// stream as a dead connection.
			const heartbeat = setInterval(() => {
				if (Date.now() - lastEmitAt > 3000) {
					enqueue(encode('status', { text: 'Still gathering resources\u2026' }));
					touch();
				}
			}, 3000);

			const stopHeartbeat = () => clearInterval(heartbeat);

			const emit: StreamEmit = {
				status(text) {
					touch();
					enqueue(encode('status', { text }));
				},
				token(delta) {
					touch();
					enqueue(encode('token', { delta }));
				},
				thinking(label, state) {
					touch();
					enqueue(encode('thinking', { label, state }));
				},
				meta(data) {
					touch();
					enqueue(encode('meta', data));
				},
				done(data) {
					stopHeartbeat();
					touch();
					const payload = { ...(data ?? {}), model };
					enqueue(encode('done', payload));
					controller.close();
				},
				error(message) {
					stopHeartbeat();
					touch();
					enqueue(encode('error', { message }));
					controller.close();
				}
			};

			try {
				await answerStream(
					skillCtx,
					lastUser.content.trim(),
					language,
					priorTurns,
					emit,
					profile,
					waitUntil
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				// Ensure stream closes even on unexpected errors
				stopHeartbeat();
				try {
					enqueue(encode('error', { message: msg }));
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
