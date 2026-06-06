/**
 * skillChat.ts — server-side helper that wires ContextHarness to the MCP server.
 *
 * Usage in +server.ts endpoints:
 *   const { callTool, llm } = createSkill(platform, url.origin);
 *   const result = await answer({ callTool, llm }, userMessage, language);
 */

import { OpenAILLMProvider } from '$core/rag/providers/OpenAILLMProvider.js';
import { ContextHarness } from '$core/harness/ContextHarness.js';
import { SkillService } from '$core/skill/SkillService.js';
import type { Challenge } from '$core/harness/PassageAnnotator.js';
import type { ToolCallTrace } from '$core/harness/ContextHarness.js';
import {
	shouldOfferWarmup,
	buildWarmupMarker,
	buildLangMarker,
	buildPendingMarkers,
	buildNameInvitedMarker,
	hasNameInvited,
	extractLang,
	extractWarmup,
	resolveLanguage,
	type LanguageOption,
} from '$core/harness/warmup.js';
import {
	classifyIntent,
	extractReferenceInfo,
	extractSessionContext,
	type IntentResult,
	type IntentType,
} from '$core/harness/intent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * LLM-based contextual classifier for short conversational messages.
 *
 * Replaces all brittle multilingual regex patterns (AFFIRMATIVE_RE, CONTINUATION_PATTERN,
 * NAME_RE) with a single small structured LLM call. Only fires when the message has no
 * Bible reference and is short enough to be conversational (≤ 120 chars).
 *
 * Returns flags the caller can use to override/enrich the rule-based intentResult.
 */
async function resolveContextual(
	llm: OpenAILLMProvider,
	message: string,
	history: ConversationTurn[],
): Promise<{ isAffirmative: boolean; isContinuation: boolean; extractedName: string | null }> {
	const empty = { isAffirmative: false, isContinuation: false, extractedName: null };

	// Only worth calling for short, reference-free messages
	if (message.trim().length > 120 || extractReferenceInfo(message)) return empty;

	// Give the LLM the last assistant turn for context (strip hidden markers)
	const lastAssistant = [...history]
		.reverse()
		.find((m) => m.role === 'assistant')
		?.content?.replace(/<!--[\s\S]*?-->/g, '')
		.trim()
		.slice(0, 300) ?? '';

	const system = `You are a conversation classifier for a Bible translation assistant.

The assistant's last message was:
"${lastAssistant || '(conversation start)'}"

For the user's reply classify:
- "isAffirmative": true if the user is saying yes / confirming / agreeing to what the assistant just asked or offered
- "isContinuation": true if the user is saying next / continue / proceed to advance through a sequence
- "extractedName": the user's preferred name or alias if they introduced themselves in this message, otherwise null

Reply ONLY with valid JSON on one line, for example: {"isAffirmative":false,"isContinuation":false,"extractedName":null}`;

	try {
		const raw = await llm.generate(
			[{ role: 'system', content: system }, { role: 'user', content: message }],
			{ maxTokens: 40 }
		);
		const match = raw.match(/\{[\s\S]*?\}/);
		if (!match) return empty;
		const parsed = JSON.parse(match[0]) as Record<string, unknown>;
		return {
			isAffirmative: Boolean(parsed.isAffirmative),
			isContinuation: Boolean(parsed.isContinuation),
			extractedName: typeof parsed.extractedName === 'string' && parsed.extractedName !== 'null'
				? parsed.extractedName
				: null,
		};
	} catch {
		return empty;
	}
}

/**
 * Returns true when conversation history shows an active Bible passage session
 * (annotated passage, batch drill, checklist, or any response mentioning a USFM ref).
 * Path G (conversational) should be skipped in this case.
 *
 * NOTE: All checks here are structural pattern matches on deterministic content
 * (HTML comment markers, USFM reference format, batch footer pattern) rather than
 * free-form intent classification. They are reliable and do not benefit from LLM
 * replacement. No TODO(llm-intent) needed.
 */
function hasActivePassageSession(history: ConversationTurn[]): boolean {
	const assistantMsgs = history
		.filter((m) => m.role === 'assistant')
		.slice(-4)
		.map((m) => m.content);

	for (const content of assistantMsgs) {
		if (/<!-- CHALLENGES:\d+/.test(content)) return true;
		if (/<!-- PHRASE_DRILL:\d+/.test(content)) return true;
		if (/Say "next" for [A-Z0-9]+ \d+:\d+/i.test(content)) return true;
		if (/\[Step \d+\/\d+\]/i.test(content)) return true;
		// Any USFM reference pattern (e.g. "TIT 2:12", "JHN 3:16")
		if (/\b[A-Z0-9]{2,3}\s+\d+:\d+\b/.test(content)) return true;
		// Passage fetched marker in assistant system content
		if (/extractReferenceInfo|<!-- LANG:|<!-- WARM/.test(content)) return true;
	}

	// Also check if any user message in the last 4 turns contained a reference
	const userMsgs = history
		.filter((m) => m.role === 'user')
		.slice(-4)
		.map((m) => m.content);
	for (const content of userMsgs) {
		if (extractReferenceInfo(content) !== null) return true;
	}

	return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ChatAnswer {
	response: string;
	citations: { path: string; title?: string }[];
	reference?: string;
	mode: 'compose' | 'rag' | 'training-only';
	latencyMs: number;
	dataWarning?: string;
	intent?: string;
	/** Next verse-batch reference when in a progressive-disclosure session. */
	nextBatch?: string;
	/** Structured translation challenges from an annotated_passage response. */
	challenges?: Challenge[];
	/** For phrase_drill: the 1-based index of the challenge just answered. */
	drillIndex?: number;
	/** Total number of challenges in the current session. */
	totalChallenges?: number;
	/** Every MCP tool call made during this turn, in invocation order. */
	toolCalls?: ToolCallTrace[];
}

export type { Challenge, ToolCallTrace };

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export interface StreamEmit {
	/** Send a progress/status message (not part of the final answer text) */
	status(text: string): void;
	/** Send a token delta for the in-progress assistant message */
	token(delta: string): void;
	/** Send a named sub-agent progress update (for the thinking panel in the UI) */
	thinking(label: string, state: 'working' | 'done'): void;
	/** Send structured metadata (language, name, flags) */
	meta(data: StreamMeta): void;
	/** Signal end of stream */
	done(data?: Partial<ChatAnswer>): void;
	/** Signal an error */
	error(message: string): void;
}

export interface StreamMeta {
	setLanguage?: string;
	setName?: string;
	awaitingLanguage?: boolean;
	awaitingConfirmation?: boolean;
	reference?: string;
	intent?: string;
	citations?: { path: string; title?: string }[];
	challenges?: Challenge[];
	nextBatch?: string;
	toolCalls?: ToolCallTrace[];
}

export interface UserProfile {
	name?: string;
	language?: string;
}

interface PlatformEnv {
	OPENAI_API_KEY?: string;
	/** Worker base URL for tool calls (e.g. http://localhost:8787 in dev). */
	MCP_BASE_URL?: string;
	/** REST Data API base URL (e.g. http://localhost:8788 when running the API worker locally).
	 *  When set, can be used by tooling that calls the REST API directly.
	 *  The MCP worker itself uses the API service binding in production;
	 *  for local dev, set API_BASE_URL on the MCP worker process instead. */
	API_BASE_URL?: string;
}

export type ChatModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1' | 'gpt-4.1-mini';
export const DEFAULT_MODEL: ChatModel = 'gpt-4o';

export type CallTool = (name: string, params: Record<string, unknown>) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LLM-driven language resolver
// ---------------------------------------------------------------------------

/**
 * Ask the LLM to map a free-text language reply to a BCP-47 code, then
 * validate the result against the catalog list.
 *
 * Returns the matched code string, or null if the LLM can't resolve it.
 */
async function resolveLanguageLLM(
	llm: OpenAILLMProvider,
	reply: string,
	langList: LanguageOption[]
): Promise<string | null> {
	// Build a compact catalog string for context (cap at 120 entries to stay within token budget)
	const catalogSample = langList
		.slice(0, 120)
		.map((l) => `${l.code}${l.name ? ` (${l.name})` : ''}`)
		.join(', ');

	const system =
		`You are a language-code resolver for Bible translation software. ` +
		`Given the user's reply, output ONLY a BCP-47 language code (e.g. es, es-419, pt-br, zh-Hans) ` +
		`or the word NONE if you cannot determine a language. ` +
		`Do not output anything else — no punctuation, no explanation. ` +
		(catalogSample ? `Known catalog codes: ${catalogSample}.` : '');

	let raw: string;
	try {
		raw = await llm.generate(
			[
				{ role: 'system', content: system },
				{ role: 'user', content: reply }
			],
			{ maxTokens: 12 }
		);
	} catch {
		return null;
	}

	const candidate = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
	if (!candidate || candidate === 'none') return null;

	// Validate: exact match in catalog
	const codeSet = new Set(langList.map((l) => (l.code ?? '').toLowerCase()));
	if (codeSet.has(candidate)) {
		// Return with original casing from catalog
		return langList.find((l) => (l.code ?? '').toLowerCase() === candidate)?.code ?? null;
	}

	// Try base language (es-419 -> es) if the full code isn't in the catalog
	const base = candidate.split('-')[0];
	if (base !== candidate && codeSet.has(base)) {
		return langList.find((l) => (l.code ?? '').toLowerCase() === base)?.code ?? null;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Immediate acknowledgment — fires synchronously before any awaits
// ---------------------------------------------------------------------------

/**
 * Emit a templated status acknowledgment immediately after intent classification,
 * before any async work starts. This eliminates the cold-start dead window by
 * giving the user visual feedback within < 1ms on every request.
 */
function immediateAck(emit: StreamEmit, intent: string, ref?: string): void {
	const refLabel = ref ? `**${ref}**` : 'this passage';
	const acks: Record<string, string> = {
		annotated_passage: `Reading ${refLabel} and gathering translation resources\u2026`,
		passage_overview:  `Preparing a full overview of ${refLabel} \u2014 this may take a moment\u2026`,
		phrase_drill:      `Exploring that phrase from ${refLabel}\u2026`,
		word_study:        `Looking up that term\u2026`,
		open_ended:        `Let me look that up for you\u2026`,
		language_answer:   `Updating your language preference\u2026`,
		warm_confirm:      `Great! Let me get started\u2026`,
	};
	emit.status(acks[intent] ?? `Working on your request\u2026`);
}

// ---------------------------------------------------------------------------

/**
 * Build callTool + LLM provider connected to the running tool endpoint.
 *
 * MCP_BASE_URL resolution:
 *   1. platform.env.MCP_BASE_URL    (wrangler dev at port 8787)
 *   2. process.env.MCP_BASE_URL     (vite dev, from web/.env)
 *   3. requestOrigin                (same-origin deployed Worker)
 */
export function createSkill(
	platformEnv: PlatformEnv | undefined | null,
	requestOrigin: string,
	model: ChatModel = DEFAULT_MODEL
): { skill: SkillService; callTool: CallTool; llm: OpenAILLMProvider } {
	const apiKey =
		platformEnv?.OPENAI_API_KEY ??
		(typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined) ??
		'';

	const toolBase =
		platformEnv?.MCP_BASE_URL ??
		(typeof process !== 'undefined' ? process.env?.MCP_BASE_URL : undefined) ??
		requestOrigin;
	const toolUrl = `${toolBase.replace(/\/$/, '')}/api/tool`;

	const callTool: CallTool = async (name, params) => {
		const requestId = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

		const res = await fetch(toolUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, params, requestId })
		});

		const data = (await res.json()) as { structuredContent?: unknown; error?: string };

		if (!res.ok || data.error) {
			throw new Error(data.error ?? `Tool "${name}" failed with HTTP ${res.status}`);
		}

		return data.structuredContent ?? data;
	};

	const llm = new OpenAILLMProvider({ apiKey, model });

	const skill = new SkillService({
		callTool,
		llmProvider: llm
	});

	return { skill, callTool, llm };
}

// ---------------------------------------------------------------------------
// Answer router — delegates to ContextHarness
// ---------------------------------------------------------------------------

/**
 * Route a user message through the ContextHarness:
 *   classify intent → select resources → parallel-fetch → rc-link expand
 *   → budget → intent-specific prompt → generate.
 *
 * Falls back gracefully when no data is available.
 */
export async function answer(
	{ callTool, llm }: { callTool: CallTool; llm: OpenAILLMProvider; skill?: SkillService },
	message: string,
	language: string,
	conversationHistory?: ConversationTurn[]
): Promise<ChatAnswer> {
	const start = Date.now();

	const harness = new ContextHarness(llm, callTool);

	const result = await harness.run(message, { language, conversationHistory });

	return {
		response: result.response,
		citations: result.citations,
		reference: result.reference,
		mode: result.mode,
		dataWarning: result.dataWarning,
		intent: result.intent,
		nextBatch: result.nextBatch,
		challenges: result.challenges,
		drillIndex: result.drillIndex,
		totalChallenges: result.totalChallenges,
		toolCalls: result.toolCalls,
		latencyMs: Date.now() - start
	};
}

// ---------------------------------------------------------------------------
// Streaming orchestrator
// ---------------------------------------------------------------------------

/** Default strategic language — gate fires when language is still this value. */
const DEFAULT_LANGUAGE = 'en';

/**
 * Stream an answer through the language-gate → warm-gate → full pipeline.
 *
 * Emitter callbacks are called synchronously from within this async function.
 * The caller is responsible for buffering / encoding SSE frames.
 *
 * @param ctx         - { callTool, llm } from createSkill()
 * @param message     - latest user message
 * @param language    - current language code from the UI dropdown
 * @param history     - prior conversation turns (excluding the current message)
 * @param emit        - SSE emitter callbacks
 * @param profile     - optional browser profile (name + language preference)
 * @param waitUntil   - optional CF waitUntil for background work
 */
export async function answerStream(
	{ callTool, llm }: { callTool: CallTool; llm: OpenAILLMProvider },
	message: string,
	language: string,
	history: ConversationTurn[],
	emit: StreamEmit,
	profile?: UserProfile,
	waitUntil?: (p: Promise<unknown>) => void
): Promise<void> {
	try {
		// Resolve effective language: profile > dropdown > default
		const effectiveLang = profile?.language ?? language ?? DEFAULT_LANGUAGE;
		const historyForClassify = history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

		// Build name-aware system snippet
		const nameSnippet = profile?.name
			? `Address the user as ${profile.name} when natural.`
			: '';

		// 1. Fast rule-based intent classification (synchronous, no LLM)
		let intentResult: IntentResult = classifyIntent(message, historyForClassify);

		// 1b. LLM contextual enrichment for short conversational messages.
		//     Replaces ALL hardcoded multilingual regex patterns — the LLM understands
		//     "sí", "sim", "oui", "はい", "Me llamo X", etc. without any word lists.
		let ctx = { isAffirmative: false, isContinuation: false, extractedName: null as string | null };
		if (!intentResult.reference && message.trim().length <= 120) {
			ctx = await resolveContextual(llm, message, history);

			// Override: warm-gate confirmation
			if (ctx.isAffirmative && !intentResult.warmConfirmed) {
				const warmup = extractWarmup(historyForClassify);
				if (warmup) {
					intentResult = {
						...intentResult,
						intent: warmup.intent as IntentType,
						reference: warmup.ref,
						warmConfirmed: true,
						confidence: 'high',
					};
				}
			}

			// Override: batch / checklist continuation
			if (ctx.isContinuation && !intentResult.continuationRef) {
				const session = extractSessionContext(historyForClassify);
				if (session?.type === 'batch') {
					intentResult = {
						...intentResult,
						intent: 'passage_help',
						reference: session.nextRef,
						continuationRef: session.nextRef,
						confidence: 'high',
					};
				} else if (session?.type === 'checklist') {
					const nextStep = session.currentStep + 1;
					if (nextStep <= session.totalSteps) {
						intentResult = {
							...intentResult,
							intent: 'checklist_step',
							nextStep,
							totalSteps: session.totalSteps,
							confidence: 'high',
						};
					}
				}
			}

			// Name extraction — LLM result wins over regex
			if (ctx.extractedName && !profile?.name) {
				emit.meta({ setName: ctx.extractedName });
			}
		}

		// 1a. Immediate acknowledgment — after contextual enrichment so it uses the
		//     correct intent (e.g. "warm_confirm" → "Great! Let me get started…").
		immediateAck(emit, intentResult.intent, intentResult.reference);

		// -----------------------------------------------------------------------
		// Path A: Language answer — user replied to the language-gate prompt
		// -----------------------------------------------------------------------
		if (intentResult.intent === 'language_answer' && intentResult.pendingRef) {
			const { pendingRef, pendingIntent } = intentResult;

			// Fetch language list to resolve the user's reply
			emit.status('Resolving language…');
			let langList: LanguageOption[] = [];
			try {
				const raw = await callTool('list_languages', {}) as { languages?: LanguageOption[] } | LanguageOption[];
				langList = Array.isArray(raw) ? raw : (raw as { languages?: LanguageOption[] }).languages ?? [];
			} catch {
				// Continue with empty list — we'll still try to match
			}

		// Resolve order: exact heuristic → LLM → affirmative-default fallback
		let resolvedCode =
			resolveLanguage(message, langList) ??
			(await resolveLanguageLLM(llm, message, langList));

	if (!resolvedCode) {
		// Last resort: if LLM classified this as an affirmative and we have a
		// suggested default (profile or dropdown), treat it as "go with what you have".
		// Do NOT guard on suggestedDefault !== DEFAULT_LANGUAGE — if the system told
		// the user "I suggest en, just say adelante" they should get "en" back too.
		const suggestedDefault = profile?.language ?? language;
		if (ctx.isAffirmative && suggestedDefault) {
			resolvedCode = suggestedDefault;
		}
	}

		if (!resolvedCode) {
			// Could not resolve — re-ask
			const clarifyText = `I wasn't sure which language that is. Could you type the language name (like "Spanish") or its code (like "es" or "es-419")?`;
			emit.token(clarifyText);
			// Keep AWAITING_LANG + PENDING_PASSAGE markers alive
			const markers = buildPendingMarkers(pendingRef, pendingIntent ?? 'annotated_passage');
			emit.done({
				response: clarifyText + '\n' + markers,
				citations: [],
				mode: 'compose',
				latencyMs: 0
			});
			return;
		}

			// Resolve variant upfront: if the code is a base (no hyphen) and a known
		// variant exists in the language list, upgrade it now so every subsequent
		// tool call passes the exact variant (e.g. "es" → "es-419") and the
		// server-side fallback is never needed during this session.
		if (!resolvedCode.includes('-') && langList.length > 0) {
			const prefix = resolvedCode + '-';
			const variant = langList.find((l) => (l.code ?? '').startsWith(prefix))?.code;
			if (variant) resolvedCode = variant;
		}

		// Language resolved — emit meta so UI dropdown updates
		emit.meta({ setLanguage: resolvedCode });

		// Name already captured by resolveContextual above (no regex needed)

		// The user already stated their intent (they asked about a passage) AND
		// answered the language gate.  Firing _handleWarmGate here would produce a
		// third confirmation question ("¿Te gustaría…?") that the user hasn't asked
		// for.  Skip the warm gate and run the harness directly, just like Path C.
	emit.status('Loading passage resources…');
	{
		const harness = new ContextHarness(llm, callTool);
		// Strip the lang-gate assistant turn from history before calling the harness.
		// That turn contains <!-- AWAITING_LANG --> which would make classifyIntent
		// return 'language_answer' for pendingRef, causing selectResources to return
		// an empty initialFetches plan and the response to come from training-only.
		const harnessHistory = (history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>)
			.filter((m) => !(m.role === 'assistant' && m.content.includes('<!-- AWAITING_LANG -->')));
		// Use pendingRef as the synthetic message so the harness classifies it
		// as an annotated_passage / passage intent with the correct reference.
		const result = await harness.run(pendingRef, {
			language: resolvedCode,
			conversationHistory: harnessHistory,
				emit: {
					status: (s) => emit.status(s),
					token: (d) => emit.token(d),
					thinking: (l, s) => emit.thinking(l, s),
				}
			});

			if (result.effectiveLanguage && result.effectiveLanguage !== resolvedCode) {
				emit.meta({ setLanguage: result.effectiveLanguage });
			}

			emit.done({
				response: result.response,
				citations: result.citations,
				reference: result.reference,
				mode: result.mode,
				dataWarning: result.dataWarning,
				intent: result.intent,
				nextBatch: result.nextBatch,
				challenges: result.challenges,
				drillIndex: result.drillIndex,
				totalChallenges: result.totalChallenges,
				toolCalls: result.toolCalls,
				latencyMs: 0
			});
		}
		return;
	}

		// -----------------------------------------------------------------------
		// (Name extraction handled by resolveContextual above — no regex needed)
		// -----------------------------------------------------------------------
		// Path C: Warm confirmation — user said "yes" to a warm-gate offer
		// -----------------------------------------------------------------------
		if (intentResult.warmConfirmed && intentResult.reference) {
			// Run the full harness — caches should already be warm
			emit.status('Loading passage resources…');
			const harness = new ContextHarness(llm, callTool);
			const result = await harness.run(message, {
				language: effectiveLang,
				conversationHistory: history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
				emit: {
					status: (s) => emit.status(s),
					token: (d) => emit.token(d),
					thinking: (l, s) => emit.thinking(l, s),
				}
			});

			// Surface variant upgrade (e.g. "es" → "es-419") to the UI
			if (result.effectiveLanguage && result.effectiveLanguage !== effectiveLang) {
				emit.meta({ setLanguage: result.effectiveLanguage });
			}

			emit.done({
				response: result.response,
				citations: result.citations,
				reference: result.reference,
				mode: result.mode,
				dataWarning: result.dataWarning,
				intent: result.intent,
				nextBatch: result.nextBatch,
				challenges: result.challenges,
				drillIndex: result.drillIndex,
				totalChallenges: result.totalChallenges,
				toolCalls: result.toolCalls,
				latencyMs: 0
			});
			return;
		}

		// -----------------------------------------------------------------------
		// Path D: Language gate — ask for language before warming
		// -----------------------------------------------------------------------
		const langInHistory = extractLang(history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>);
		// Language is "known" (gate skipped) only when a LANG marker was confirmed
		// during THIS conversation. Stored profile/dropdown values are ignored here
		// so the gate fires once per new conversation.
		const langKnown = !!langInHistory;

		// Fire the language gate for ANY message that contains a passage reference,
		// regardless of intent. This covers both passage-specific intents AND
		// open-ended questions that mention a reference (e.g. "Can you help me
		// with John 3:16?"). The intent check is deliberately omitted here so that
		// indirect phrasings don't silently bypass the gate.
		if (!langKnown && intentResult.reference) {
			// Language list is not fetched here — the user knows their own language.
			// (list_languages is still called in Path A when the user answers, to validate.)

			const suggestedDefault = profile?.language ?? (language !== DEFAULT_LANGUAGE ? language : null);
			const defaultHint = suggestedDefault
				? ` If they have no preference, suggest **${suggestedDefault}** as the default and say they can just say "go ahead" to use it.`
				: '';

			// Let the LLM ask the question in whatever language the user is using.
			const langGateSystem = [
				`${nameSnippet}You are Ezer, a Bible translation helper (your name means "helper" in Hebrew).`,
				`The user has asked about ${intentResult.reference}.`,
				`You need to know which strategic language (e.g. Spanish, English, French) they want to use as the SOURCE or BASE for their translation work — not the target language they are translating into.`,
				`Ask them which strategic language they want to use as the base, in a single short sentence (max 20 words).`,
				defaultHint,
				`Match the language of the user's last message. No markdown.`,
			].join(' ');

			const langGateChunks: string[] = [];
			if (llm.generateStream) {
				for await (const delta of llm.generateStream(
					[
						{ role: 'system', content: langGateSystem },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 60 }
				)) {
					emit.token(delta);
					langGateChunks.push(delta);
				}
			} else {
				const t = await llm.generate(
					[
						{ role: 'system', content: langGateSystem },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 60 }
				);
				emit.token(t);
				langGateChunks.push(t);
			}

			const langGateText = langGateChunks.join('');

			// Name invite is handled separately in a later turn — don't bundle it here.
			const nameMarker = !hasNameInvited(history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>)
				? '\n' + buildNameInvitedMarker()
				: '';
			const pendingMarkers = '\n' + buildPendingMarkers(intentResult.reference, intentResult.intent);

			emit.meta({ awaitingLanguage: true });
			emit.done({
				response: langGateText + nameMarker + pendingMarkers,
				citations: [],
				mode: 'compose',
				latencyMs: 0
			});
			return;
		}

		// -----------------------------------------------------------------------
		// Path E: Warm gate — offer confirmation while background-warming
		// -----------------------------------------------------------------------
		const resolvedLang = langInHistory ?? effectiveLang;

		if (
			shouldOfferWarmup(
				{ ...intentResult } as Parameters<typeof shouldOfferWarmup>[0],
				history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
			) &&
			intentResult.reference
		) {
			await _handleWarmGate(
				{ callTool, llm },
				intentResult.reference,
				intentResult.intent,
				resolvedLang,
				history,
				emit,
				nameSnippet,
				waitUntil,
				profile
			);
			return;
		}

		// -----------------------------------------------------------------------
		// Path G: Conversational path — no Bible reference detected
		// -----------------------------------------------------------------------
		// For messages that contain no passage reference (greetings, small talk,
		// general questions), use a single direct LLM call with name context
		// rather than the full harness. The LLM decides naturally:
		//   • If it reads as a greeting → greet by name (if known) or ask for it
		//   • If it's a general question → answer briefly
		// Task-oriented questions with a reference always skip this path and go
		// to the full harness (Path F) below.
		if (!intentResult.reference && !hasActivePassageSession(history)) {
			const nameCtx = profile?.name
				? `The user goes by "${profile.name}". Use that name when it feels natural.`
				: `You do not know what to call the user yet. If their message is a greeting or conversational opener, briefly introduce yourself as Ezer — a Bible translation helper (mention that your name means "helper" in Hebrew) — then ask how you should call them (they may prefer a nickname or alias — keep it casual and low-pressure).`;

			const systemMsg = [
				`You are Ezer — a friendly Bible translation helper. Your name means "helper" in Hebrew, fitting for your role guiding people through translating scripture passages.`,
				nameCtx,
				`Reply in 2–3 short sentences max. Do not use markdown.`,
				`If the user asks what you do, explain you help walk translators through any Bible passage in their target language.`,
			].join(' ');

			const chunks: string[] = [];
			if (llm.generateStream) {
				for await (const delta of llm.generateStream(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 100 }
				)) {
					emit.token(delta);
					chunks.push(delta);
				}
			} else {
				const text = await llm.generate(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 100 }
				);
				emit.token(text);
				chunks.push(text);
			}

			// Name persistence handled earlier by resolveContextual (no regex needed here)

			emit.done({ response: chunks.join(''), citations: [], mode: 'compose', latencyMs: 0 });
			return;
		}

		// -----------------------------------------------------------------------
		// Path G+: Active session continuation — no new reference but an active
		// passage/phrase-drill session exists.
		//
		// Two sub-cases:
		//   A. SHORT AFFIRMATIVE / SOCIAL ("Sí", "yes", "claro", "ok", "gracias")
		//      → plain LLM call with history; no tool calls needed.
		//   B. QUESTION / CONCEPT INQUIRY ("¿Qué es una personificación?",
		//      "¿A qué se refiere con X?", "explícame más", etc.)
		//      → route through the harness so agenticFallback can call MCP tools
		//        (e.g. get_academy_article, get_note with phrase) and cite resources.
		// -----------------------------------------------------------------------
		if (!intentResult.reference) {
			// Use the isAffirmative / isContinuation signals already resolved by
			// resolveContextual() (LLM call, runs above for messages ≤ 120 chars).
			// If neither flag is set, treat the message as a substantive inquiry and
			// route through the harness so MCP tools can be called.
			//
			// For messages > 120 chars ctx defaults to {false, false, null} so they
			// always hit the harness — appropriate since long messages are virtually
			// always substantive questions or requests, not brief social replies.
			const msgTrimmed = message.trim();
			const isQuestion =
				msgTrimmed.includes('?') ||
				msgTrimmed.includes('¿') ||
				(!ctx.isAffirmative && !ctx.isContinuation);

			if (isQuestion) {
				// Route through harness so MCP tools can be called.
				// agenticFallback now receives conversation history (fix applied above).
				emit.status('Buscando recursos…');
				const harness = new ContextHarness(llm, callTool);
				const result = await harness.run(message, {
					language: resolvedLang,
					conversationHistory: history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
					emit: {
						status: (s) => emit.status(s),
						token: (d) => emit.token(d),
						thinking: (l, s) => emit.thinking(l, s),
					}
				});
				if (result.effectiveLanguage && result.effectiveLanguage !== effectiveLang) {
					emit.meta({ setLanguage: result.effectiveLanguage });
				}
				emit.done({
					response: result.response,
					citations: result.citations,
					reference: result.reference,
					mode: result.mode,
					dataWarning: result.dataWarning,
					intent: result.intent,
					toolCalls: result.toolCalls,
					latencyMs: 0
				});
				return;
			}

			// Short affirmative / social continuation → plain LLM, no tools needed
			const nameCtx = profile?.name
				? `The user goes by "${profile.name}". Use that name when it feels natural.`
				: '';
			const systemMsg = [
				nameCtx,
				`You are Ezer, a Bible translation helper (your name means "helper" in Hebrew).`,
				`You are in an active translation session. The user's message is a brief reply or continuation.`,
				`Read the conversation history to understand what was last discussed and continue naturally.`,
				`Do NOT greet the user, do NOT start a new topic, do NOT ask what passage they want.`,
				`If the user affirmed something, continue the topic. If they thanked you, acknowledge briefly.`,
				`Reply concisely in the user's language.`,
			].filter(Boolean).join(' ');

			const chunks: string[] = [];
			if (llm.generateStream) {
				for await (const delta of llm.generateStream(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 300 }
				)) {
					emit.token(delta);
					chunks.push(delta);
				}
			} else {
				const text = await llm.generate(
					[
						{ role: 'system', content: systemMsg },
						...historyForClassify,
						{ role: 'user', content: message }
					],
					{ maxTokens: 300 }
				);
				emit.token(text);
				chunks.push(text);
			}

			emit.done({ response: chunks.join(''), citations: [], mode: 'compose', latencyMs: 0 });
			return;
		}

		// -----------------------------------------------------------------------
		// Path F: Full pipeline (no gate needed or non-passage intent)
		// -----------------------------------------------------------------------
		emit.status('Processing your request…');
		const harness = new ContextHarness(llm, callTool);
		const result = await harness.run(message, {
			language: resolvedLang,
			conversationHistory: history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
			emit: {
				status: (s) => emit.status(s),
				token: (d) => emit.token(d),
				thinking: (l, s) => emit.thinking(l, s),
			}
		});

		// Surface variant upgrade (e.g. "es" → "es-419") to the UI
		if (result.effectiveLanguage && result.effectiveLanguage !== effectiveLang) {
			emit.meta({ setLanguage: result.effectiveLanguage });
		}

		emit.done({
			response: result.response,
			citations: result.citations,
			reference: result.reference,
			mode: result.mode,
			dataWarning: result.dataWarning,
			intent: result.intent,
			nextBatch: result.nextBatch,
			challenges: result.challenges,
			drillIndex: result.drillIndex,
			totalChallenges: result.totalChallenges,
			toolCalls: result.toolCalls,
			latencyMs: 0
		});
	} catch (err) {
		emit.error(err instanceof Error ? err.message : String(err));
	}
}

// ---------------------------------------------------------------------------
// Warm-gate helper
// ---------------------------------------------------------------------------

async function _handleWarmGate(
	{ callTool, llm }: { callTool: CallTool; llm: OpenAILLMProvider },
	ref: string,
	intent: string,
	language: string,
	history: ConversationTurn[],
	emit: StreamEmit,
	nameSnippet: string,
	waitUntil: ((p: Promise<unknown>) => void) | undefined,
	profile: UserProfile | undefined
): Promise<void> {
	emit.status(`Loading ${ref}…`);

	// Fire background warm — fire-and-forget
	const warmPromise = callTool('get_passage', { reference: ref, language }).catch(() => {});
	if (waitUntil) {
		waitUntil(warmPromise);
	}

	// Stream a short polite confirmation question via LLM.
	// Include recent conversation history so the LLM matches the user's language.
	const nameContext = nameSnippet ? `${nameSnippet}\n` : '';
	const systemMsg = `${nameContext}You are a friendly Bible translation assistant. The user just asked about ${ref}. Write a single short sentence (max 20 words) asking if they'd like you to walk them through it for translation. Do NOT say "I found it" — you haven't fetched it yet. Match the language of the conversation. No markdown.`;

	const recentHistory = history
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.slice(-4) as Array<{ role: 'user' | 'assistant'; content: string }>;

	const confirmText: string[] = [];
	if (llm.generateStream) {
		for await (const delta of llm.generateStream(
			[{ role: 'system', content: systemMsg }, ...recentHistory],
			{ maxTokens: 60 }
		)) {
			emit.token(delta);
			confirmText.push(delta);
		}
	} else {
		const text = await llm.generate(
			[{ role: 'system', content: systemMsg }, ...recentHistory],
			{ maxTokens: 60 }
		);
		emit.token(text);
		confirmText.push(text);
	}

	const fullConfirm = confirmText.join('');
	const langMarker = buildLangMarker(language);
	const warmupMarker = buildWarmupMarker(ref, intent);
	const response = `${fullConfirm}\n${langMarker}\n${warmupMarker}`;

	emit.meta({ awaitingConfirmation: true, reference: ref, intent });
	emit.done({
		response,
		citations: [],
		mode: 'compose',
		latencyMs: 0
	});
}
