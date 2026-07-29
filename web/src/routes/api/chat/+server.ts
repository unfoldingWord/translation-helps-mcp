/**
 * POST /api/chat
 *
 * Accepts: { messages, language?, model?, profile?, debug? }
 * Returns: text/event-stream (SSE)
 *
 * SSE frame types:
 *   event: status        data: {"text":"…"}
 *   event: token         data: {"delta":"…"}
 *   event: thinking      data: {"label":"…","state":"working"|"done"}
 *   event: meta          data: { setLanguage?, setName?, awaitingLanguage?, … }
 *   event: ui            data: UIComponent
 *   event: panel_action  data: PanelAction (open / focus_tab / highlight / scroll_to)
 *   event: trace         data: TraceEvent (only when debug:true)
 *   event: done          data: { response, citations, intent, reference, challenges, … }
 *   event: error         data: {"message":"…"}
 */

import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import {
	createSkill,
	answerStream,
	streamIntroGreeting,
	parsePanelState,
	type ChatModel,
	type StreamEmit,
	type UserProfile
} from '$lib/server/skillChat.js';
import { coalescePanelActions, panelActionsForUiComponent } from '$core/harness/panelActions.js';
import type { UIComponent } from '$core/harness/uiComponents.js';

// PlatformEnv is the Cloudflare env bag (bindings are non-enumerable).
type PlatformEnv = NonNullable<App.Platform['env']>;

export const POST: RequestHandler = async ({ request, platform, url }) => {
	let body: {
		messages?: { role: string; content: string }[];
		/** Legacy / receptor target language. */
		language?: string;
		languageName?: string;
		/** Door43 resources + coach conversation language. */
		sourceLanguage?: string;
		/** Receptor label only. */
		targetLanguage?: string;
		model?: ChatModel;
		profile?: UserProfile;
		debug?: boolean;
		context?: string;
		/** Study | Translate | Check — coach + panel bias. */
		workflowMode?: 'study' | 'translate' | 'check';
		/** True when the user explicitly chose the mode (UI tab click) — always wins. */
		workflowModeExplicit?: boolean;
		/** Structured resources-panel snapshot for coach awareness. */
		panelState?: unknown;
		/** When `intro`, stream Ezer's first greeting (no user message required). */
		intent?: string;
	};

	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON body', { status: 400 });
	}

	const messages = body.messages ?? [];
	const language = body.language ?? body.targetLanguage ?? 'en';
	const languageName = typeof body.languageName === 'string' ? body.languageName : undefined;
	const sourceLanguage = typeof body.sourceLanguage === 'string' ? body.sourceLanguage : undefined;
	const targetLanguage = typeof body.targetLanguage === 'string' ? body.targetLanguage : language;
	const model = body.model ?? 'gpt-4o';
	const profile = body.profile;
	const debug = body.debug === true;
	const studyContext = typeof body.context === 'string' ? body.context : undefined;
	const panelState = parsePanelState(body.panelState);
	const workflowMode =
		body.workflowMode === 'study' ||
		body.workflowMode === 'translate' ||
		body.workflowMode === 'check'
			? body.workflowMode
			: undefined;
	const workflowModeExplicit = body.workflowModeExplicit === true;
	const isIntro = body.intent === 'intro';
	const langPairOpts = { sourceLanguage, targetLanguage };

	// Find the last user message (not required for intro greetings)
	const lastUser = [...messages].reverse().find((m) => m.role === 'user');
	if (!isIntro && !lastUser?.content?.trim()) {
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

	// Pass platform.env by reference — Cloudflare bindings (API, KV, …) are NOT
	// enumerable, so `{ ...platform.env }` drops them and tools fall back to a
	// same-Worker fetch that returns error 1042.
	const requestOrigin = url.origin;
	const waitUntil =
		platform?.context?.waitUntil?.bind(platform.context) ??
		((_p: Promise<unknown>) => {
			// no-op in vite dev — the promise still runs but isn't extended
		});
	const skillCtx = createSkill(
		(platform?.env as PlatformEnv | undefined) ?? {
			OPENAI_API_KEY: openaiKey,
			MCP_BASE_URL: mcpBaseUrl
		},
		requestOrigin,
		model,
		{ waitUntil }
	);

	// Prior turns (exclude last user message)
	const priorTurns = messages
		.slice(0, -1)
		.filter(
			(m): m is { role: 'user' | 'assistant'; content: string } =>
				m.role === 'user' || m.role === 'assistant'
		);

	// waitUntil already captured above for createSkill / prefetch

	// ---------------------------------------------------------------------------
	// Build SSE ReadableStream
	// ---------------------------------------------------------------------------
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let cancelled = false;
	const abortController = new AbortController();

	const stream = new ReadableStream({
		async start(controller) {
			const encode = (event: string, data: unknown) => {
				const json = typeof data === 'string' ? data : JSON.stringify(data);
				return `event: ${event}\ndata: ${json}\n\n`;
			};

			const enqueue = (frame: string) => {
				if (cancelled) return;
				try {
					controller.enqueue(new TextEncoder().encode(frame));
				} catch {
					// stream already closed
				}
			};

			// Track the last time any event was emitted so the heartbeat knows
			// whether it needs to fire.
			let lastEmitAt = Date.now();
			const touch = () => {
				lastEmitAt = Date.now();
			};

			// Keepalive heartbeat — emits a status frame every 3 s when the
			// pipeline is silent, preventing the browser from treating a live
			// stream as a dead connection.
			heartbeat = setInterval(() => {
				if (cancelled) {
					clearInterval(heartbeat!);
					return;
				}
				if (Date.now() - lastEmitAt > 3000) {
					enqueue(encode('status', { text: 'Still gathering resources\u2026' }));
					touch();
				}
			}, 3000);

			const stopHeartbeat = () => {
				if (heartbeat) {
					clearInterval(heartbeat);
					heartbeat = null;
				}
			};

			/** Collected UI components — also attached to `done` so the client can
			 *  recover if individual `ui` SSE frames were dropped or failed to parse. */
			const collectedUi: unknown[] = [];

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
				ui(component) {
					touch();
					collectedUi.push(component);
					enqueue(encode('ui', component));
					// Deterministic companion panel actions (open / focus tab).
					const companions = coalescePanelActions(
						panelActionsForUiComponent(component as UIComponent)
					);
					for (const action of companions) {
						touch();
						enqueue(encode('panel_action', action));
					}
				},
				panelAction(action) {
					touch();
					enqueue(encode('panel_action', action));
				},
				done(data) {
					stopHeartbeat();
					touch();
					const payload = {
						...(data ?? {}),
						model,
						...(collectedUi.length > 0 ? { uiComponents: collectedUi } : {})
					};
					enqueue(encode('done', payload));
					controller.close();
				},
				error(message) {
					stopHeartbeat();
					touch();
					enqueue(encode('error', { message }));
					controller.close();
				},
				...(debug && {
					trace(ev) {
						touch();
						enqueue(encode('trace', ev));
					}
				})
			};

			try {
				if (isIntro) {
					await streamIntroGreeting(
						skillCtx.llm,
						{
							language,
							languageName,
							sourceLanguage,
							targetLanguage,
							name: profile?.name,
							lastReference: profile?.lastReference,
							callTool: skillCtx.callTool
						},
						emit
					);
				} else {
					await answerStream(
						skillCtx,
						lastUser!.content.trim(),
						language,
						priorTurns,
						emit,
						profile,
						waitUntil,
						debug ? (ev) => emit.trace?.(ev) : undefined,
						studyContext,
						langPairOpts,
						workflowMode,
						workflowModeExplicit,
						panelState
					);
				}
			} catch (err) {
				if (cancelled) return; // client disconnected — skip error emission
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
		},
		cancel() {
			cancelled = true;
			if (heartbeat) {
				clearInterval(heartbeat);
				heartbeat = null;
			}
			abortController.abort();
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
