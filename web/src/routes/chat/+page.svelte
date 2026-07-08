<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { renderMarkdown } from '$lib/renderMarkdown.js';
	import ResourceWorkbench from '$lib/components/ui/ResourceWorkbench.svelte';

	// ---------------------------------------------------------------------------
	// Types
	// ---------------------------------------------------------------------------

	interface ChallengeItem {
		index: number;
		verse: string;
		phrase: string;
		noteText: string;
		category: string;
		/** "tn" = translation note, "tw" = translation word / key term */
		sourceType?: 'tn' | 'tw';
		supportReference?: string;
		wordPath?: string;
		at?: string;
	}

	/** Generative-UI component data emitted via the `ui` SSE event. */
	type UIComponentData =
		| { type: 'challenge_cards'; challenges: ChallengeItem[] }
		| {
				type: 'scripture_panel';
				verses: { label: string; text: string }[];
				highlightPhrase?: string;
		  }
		| {
				type: 'scripture_text';
				reference: string;
				versions: Array<{
					label: string;
					text: string;
					direction?: 'ltr' | 'rtl';
					resourceType?: string;
				}>;
				highlightPhrase?: string;
		  }
		| {
				type: 'translation_notes';
				reference: string;
				notes: Array<{
					id: string;
					quote?: string;
					noteText: string;
					supportReference?: string;
					category?: string;
					verse?: string;
				}>;
		  }
		| {
				type: 'translation_words';
				reference: string;
				words: Array<{
					id: string;
					term: string;
					definition?: string;
					verse?: string;
					origWords?: string;
					wordPath?: string;
				}>;
		  }
		| {
				type: 'translation_questions';
				reference: string;
				questions: Array<{ id: string; question: string; response?: string; verse?: string }>;
		  }
		| { type: 'phrase_drill'; challenge: ChallengeItem; noteText: string; atSuggestion?: string }
		| { type: 'progress_tracker'; total: number; explored: number[] }
		| { type: 'ta_article_preview'; reference: string; title: string; excerpt: string };

	interface ToolCallTrace {
		tool: string;
		params: Record<string, unknown>;
		latencyMs: number;
		ok: boolean;
		error?: string;
		summary?: string;
		resultSnapshot?: unknown;
	}

	interface Message {
		role: 'user' | 'assistant';
		content: string;
		citations?: { path: string; title?: string }[];
		reference?: string;
		mode?: 'compose' | 'rag' | 'training-only' | 'error';
		dataWarning?: string;
		latencyMs?: number;
		model?: string;
		intent?: string;
		nextBatch?: string;
		challenges?: ChallengeItem[];
		drillIndex?: number;
		totalChallenges?: number;
		toolCalls?: ToolCallTrace[];
		uiComponents?: UIComponentData[];
	}

	// ---------------------------------------------------------------------------
	// Profile (localStorage)
	// ---------------------------------------------------------------------------

	interface UserProfile {
		name?: string;
		language?: string;
	}

	const PROFILE_KEY = 'th_profile';
	let profile: UserProfile = {};

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let messages: Message[] = [];
	let input = '';
	let language = 'en';
	let model = 'gpt-4o';
	let isLoading = false;
	let error = '';
	let messagesEnd: HTMLElement;
	let statusLine = '';

	// Per-send AbortController to cancel in-flight SSE streams on clearChat()
	let currentAbortController: AbortController | null = null;
	// Increments on each new send; frame handlers check this to discard stale frames
	let generationId = 0;

	// Tool-call side panel (dev mode)
	let showToolPanel = false;
	let expandedCalls: Set<string> = new Set();

	// Mobile: which panel is visible ('chat' | 'resources')
	let mobileView: 'chat' | 'resources' = 'chat';

	/**
	 * Tracks explored challenge indices per annotated_passage message.
	 * Key: message index, Value: Set of 1-based challenge indices already drilled.
	 */
	let exploredByMessage: Map<number, Set<number>> = new Map();

	// Sub-agent thinking panel
	let thinkingSteps: Map<string, 'working' | 'done'> = new Map();

	const KNOWN_LANGUAGE_OPTIONS = [
		'en',
		'es',
		'es-419',
		'fr',
		'pt-BR',
		'id',
		'hi',
		'ar',
		'ru',
		'zh-Hans'
	];

	onMount(() => {
		try {
			const stored = localStorage.getItem(PROFILE_KEY);
			if (stored) {
				profile = JSON.parse(stored) as UserProfile;
				if (profile.language && KNOWN_LANGUAGE_OPTIONS.includes(profile.language)) {
					language = profile.language;
				}
			}
		} catch {
			// ignore
		}
	});

	function saveProfile() {
		try {
			localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
		} catch {
			// ignore
		}
	}

	// ── Workbench state ─────────────────────────────────────────────────────

	/**
	 * The UIComponents shown in the right workbench panel.
	 * Tracks the LATEST assistant message's components; accumulates new ones as they arrive.
	 */
	$: workbenchComponents = ((): UIComponentData[] => {
		// Find the most recent assistant message with any UIComponents
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m.role === 'assistant' && m.uiComponents && m.uiComponents.length > 0) {
				return m.uiComponents;
			}
		}
		return [];
	})();

	$: hasWorkbenchContent = workbenchComponents.length > 0;
	$: if (typeof window !== 'undefined')
		console.log(
			'[WORKBENCH] components count:',
			workbenchComponents.length,
			workbenchComponents.map((c) => c.type)
		);

	/** Explored set for the latest annotated_passage message. */
	$: latestAnnotatedIdx = [...messages].reduceRight(
		(found, m, i) => (found === -1 && m.intent === 'annotated_passage' ? i : found),
		-1
	);
	$: workbenchExplored =
		latestAnnotatedIdx !== -1
			? (exploredByMessage.get(latestAnnotatedIdx) ?? new Set<number>())
			: new Set<number>();

	// ── Tool call trace ──────────────────────────────────────────────────────

	$: allToolCalls = [...messages]
		.filter((m) => m.role === 'assistant' && m.toolCalls?.length)
		.reverse()
		.flatMap((m, turnIdx) =>
			(m.toolCalls ?? []).map((tc, idx) => ({
				...tc,
				turnLabel: m.reference ?? m.intent ?? `Turn ${messages.indexOf(m) + 1}`,
				key: `${turnIdx}-${idx}`
			}))
		);

	function toggleExpand(key: string) {
		if (expandedCalls.has(key)) expandedCalls.delete(key);
		else expandedCalls.add(key);
		expandedCalls = new Set(expandedCalls);
	}

	function fmtParams(params: Record<string, unknown>): string {
		const keys = ['reference', 'language', 'query', 'path', 'term'];
		const parts = keys
			.filter((k) => params[k] !== undefined)
			.map((k) => `${k}=${JSON.stringify(params[k])}`);
		return (
			parts.join(' ') ||
			Object.keys(params)
				.slice(0, 2)
				.map((k) => `${k}=…`)
				.join(' ')
		);
	}

	const SUGGESTED = [
		'Help me translate John 3',
		'Explain John 3:16 for translation',
		'What does the word "grace" mean in biblical context?',
		'How should I translate Genesis 1:1?',
		'What are figures of speech in translation?'
	];

	function hasChecklistStep(msg: Message): boolean {
		return /\[Step \d+\/\d+\]/i.test(msg.content ?? '');
	}

	// ---------------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------------

	async function send() {
		const text = input.trim();
		if (!text || isLoading) return;

		input = '';
		error = '';
		messages = [...messages, { role: 'user', content: text }];

		await tick();
		scrollToBottom();

		isLoading = true;
		statusLine = '';
		thinkingSteps = new Map();

		// Cancel any in-flight request from a previous send
		currentAbortController?.abort();
		currentAbortController = new AbortController();
		const myGenId = ++generationId;

		// Switch to resources on mobile when sending (after response arrives)
		const assistantIdx = messages.length;
		messages = [
			...messages,
			{
				role: 'assistant',
				content: '',
				citations: [],
				mode: undefined,
				latencyMs: undefined,
				model
			}
		];

		const start = Date.now();

		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: messages.slice(0, assistantIdx),
					language,
					model,
					profile
				}),
				signal: currentAbortController.signal
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (!res.body) throw new Error('No response body');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let sseBuffer = '';

			const processFrame = (frame: string) => {
				// Discard frames from a previous generation (e.g. after clearChat)
				if (myGenId !== generationId) return;

				const lines = frame.split('\n');
				let event = 'message';
				let data = '';
				for (const line of lines) {
					if (line.startsWith('event:')) event = line.slice(6).trim();
					else if (line.startsWith('data:')) data = line.slice(5).trim();
				}
				if (!data) return;

				try {
					const parsed = JSON.parse(data) as Record<string, unknown>;

					if (event === 'status') {
						statusLine = String(parsed.text ?? '');
					} else if (event === 'thinking') {
						const label = String(parsed.label ?? '');
						const state = String(parsed.state ?? 'working') as 'working' | 'done';
						if (label) thinkingSteps = new Map(thinkingSteps).set(label, state);
					} else if (event === 'ui') {
						const component = parsed as UIComponentData;
						if (component.type) {
							if (!messages[assistantIdx]) return;
							const existing = messages[assistantIdx].uiComponents ?? [];
							messages[assistantIdx] = {
								...messages[assistantIdx],
								uiComponents: [...existing, component]
							};
							messages = messages;
							// On mobile, switch to resources view when first resource arrives
							if (mobileView === 'chat' && existing.length === 0) {
								mobileView = 'resources';
							}
						}
					} else if (event === 'token') {
						if (!messages[assistantIdx]) return;
						const delta = String(parsed.delta ?? '');
						messages[assistantIdx] = {
							...messages[assistantIdx],
							content: (messages[assistantIdx].content ?? '') + delta
						};
						messages = messages;
						scrollToBottom();
					} else if (event === 'meta') {
						if (parsed.setLanguage && typeof parsed.setLanguage === 'string') {
							language = parsed.setLanguage;
							profile = { ...profile, language: parsed.setLanguage };
							saveProfile();
						}
						if (parsed.setName && typeof parsed.setName === 'string') {
							profile = { ...profile, name: parsed.setName };
							saveProfile();
						}
					} else if (event === 'done') {
						statusLine = '';
						thinkingSteps = new Map();
						const doneResponse = typeof parsed.response === 'string' ? parsed.response : undefined;
						if (doneResponse && !messages[assistantIdx].content) {
							messages[assistantIdx] = { ...messages[assistantIdx], content: doneResponse };
						} else if (doneResponse) {
							const hiddenMarkers = (doneResponse.match(/<!--[\s\S]*?-->/g) ?? []).join('\n');
							if (hiddenMarkers && !messages[assistantIdx].content.includes('<!--')) {
								messages[assistantIdx] = {
									...messages[assistantIdx],
									content: messages[assistantIdx].content + '\n' + hiddenMarkers
								};
							}
						}
						messages[assistantIdx] = {
							...messages[assistantIdx],
							citations:
								(parsed.citations as { path: string; title?: string }[] | undefined) ??
								messages[assistantIdx].citations ??
								[],
							reference:
								typeof parsed.reference === 'string'
									? parsed.reference
									: messages[assistantIdx].reference,
							mode: (parsed.mode as Message['mode']) ?? messages[assistantIdx].mode,
							dataWarning:
								typeof parsed.dataWarning === 'string'
									? parsed.dataWarning
									: messages[assistantIdx].dataWarning,
							latencyMs: Date.now() - start,
							model: typeof parsed.model === 'string' ? parsed.model : model,
							intent:
								typeof parsed.intent === 'string' ? parsed.intent : messages[assistantIdx].intent,
							nextBatch:
								typeof parsed.nextBatch === 'string'
									? parsed.nextBatch
									: messages[assistantIdx].nextBatch,
							challenges:
								(parsed.challenges as ChallengeItem[] | undefined) ??
								messages[assistantIdx].challenges,
							drillIndex:
								typeof parsed.drillIndex === 'number'
									? parsed.drillIndex
									: messages[assistantIdx].drillIndex,
							totalChallenges:
								typeof parsed.totalChallenges === 'number'
									? parsed.totalChallenges
									: messages[assistantIdx].totalChallenges,
							toolCalls:
								(parsed.toolCalls as ToolCallTrace[] | undefined) ??
								messages[assistantIdx].toolCalls
						};
						messages = messages;
					} else if (event === 'error') {
						statusLine = '';
						thinkingSteps = new Map();
						const errMsg = String(parsed.message ?? 'Unknown error');
						messages[assistantIdx] = {
							...messages[assistantIdx],
							content: `Sorry, something went wrong: ${errMsg}`,
							mode: 'error',
							latencyMs: Date.now() - start
						};
						messages = messages;
					}
				} catch (err) {
					// Log SSE frame parse errors so they are visible in the browser console
					console.warn('[SSE] Failed to parse frame', { event, data: data.slice(0, 200), err });
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				sseBuffer += decoder.decode(value, { stream: true });
				const frames = sseBuffer.split('\n\n');
				sseBuffer = frames.pop() ?? '';
				for (const frame of frames) {
					if (frame.trim()) processFrame(frame);
				}
			}
		} catch (e) {
			statusLine = '';
			error = e instanceof Error ? e.message : String(e);
			if (!messages[assistantIdx]?.content) {
				messages = messages.filter((_, i) => i !== assistantIdx);
			}
		} finally {
			isLoading = false;
			await tick();
			scrollToBottom();
		}
	}

	function useSuggestion(s: string) {
		input = s;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function scrollToBottom() {
		messagesEnd?.scrollIntoView({ behavior: 'smooth' });
	}

	function clearChat() {
		currentAbortController?.abort();
		currentAbortController = null;
		generationId++; // invalidate any in-flight frame handlers
		messages = [];
		error = '';
		isLoading = false;
		statusLine = '';
		mobileView = 'chat';
	}

	function sendNext() {
		input = 'next';
		send();
	}

	function drillInto(challenge: ChallengeItem) {
		const lastAnnotatedIdx = [...messages].reduceRight(
			(found, m, i) => (found === -1 && m.intent === 'annotated_passage' ? i : found),
			-1
		);
		if (lastAnnotatedIdx !== -1) {
			const current = exploredByMessage.get(lastAnnotatedIdx) ?? new Set<number>();
			current.add(challenge.index);
			exploredByMessage = new Map(exploredByMessage).set(lastAnnotatedIdx, current);
		}
		input = String(challenge.index);
		send();
	}

	function drillNext(currentIndex: number) {
		input = String(currentIndex + 1);
		send();
	}

	function returnToPassage() {
		const lastAnnotated = [...messages].reverse().find((m) => m.intent === 'annotated_passage');
		if (lastAnnotated) {
			const el = document.querySelector(`[data-msgid="${messages.indexOf(lastAnnotated)}"]`);
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function isDrillBranch(msg: Message): boolean {
		return msg.intent === 'phrase_drill';
	}

	function stripUsfm(text: string): string {
		return text
			.replace(/\\zaln-[se][^\\]*\\\*/g, '')
			.replace(/\\zaln-[se]\s*\\\*/g, '')
			.replace(/\\w\s+(.*?)\|[^\\]+\\w\*/g, '$1')
			.replace(/\\w\s+(.*?)\\w\*/g, '$1')
			.replace(/\\v\s+\d+\s*/g, '')
			.replace(/\\c\s+\d+\s*/g, '')
			.replace(/\\[a-zA-Z0-9]+\*?\s*/g, '');
	}

	function renderMarkdownLocal(text: string): string {
		try {
			const clean = stripUsfm(text.replace(/<!--[\s\S]*?-->/g, '').trimEnd());
			return renderMarkdown(clean);
		} catch {
			return text;
		}
	}

	function modeLabel(mode?: string): string {
		if (mode === 'compose') return 'passage + RAG + AI';
		if (mode === 'rag') return 'semantic search + AI';
		if (mode === 'training-only') return '⚠ training knowledge only';
		if (mode === 'error') return 'error';
		return '';
	}
</script>

<svelte:head>
	<title>Workbench · Translation Helps MCP</title>
</svelte:head>

<!-- ── Outer workbench grid ─────────────────────────────────────────────── -->
<div class="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden md:flex-row">
	<!-- ══ LEFT PANEL: Chat (35%) ════════════════════════════════════════════ -->
	<div
		class="flex flex-col border-r border-gray-800 bg-gray-950 md:w-[35%]
			{mobileView === 'resources' ? 'hidden md:flex' : 'flex'}"
	>
		<!-- Chat header -->
		<div class="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-2.5">
			<div class="min-w-0">
				<h1 class="truncate text-base font-bold text-white">Ezer</h1>
				<p class="truncate text-xs text-gray-500">
					Translation guide · <span class="font-mono text-indigo-400">{model}</span>
				</p>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				<!-- Model selector -->
				<select
					bind:value={model}
					class="rounded border border-gray-700 bg-gray-800 px-1.5 py-1 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
					title="Model"
				>
					<option value="gpt-4o">gpt-4o</option>
					<option value="gpt-4o-mini">gpt-4o-mini</option>
					<option value="gpt-4.1">gpt-4.1</option>
					<option value="gpt-4.1-mini">gpt-4.1-mini</option>
				</select>
				<!-- Language selector -->
				<select
					bind:value={language}
					class="rounded border border-gray-700 bg-gray-800 px-1.5 py-1 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
					title="Language"
				>
					<option value="en">EN</option>
					<option value="es">ES</option>
					<option value="es-419">ES-419</option>
					<option value="fr">FR</option>
					<option value="pt-BR">PT-BR</option>
					<option value="id">ID</option>
					<option value="hi">HI</option>
					<option value="ar">AR</option>
					<option value="ru">RU</option>
					<option value="zh-Hans">ZH</option>
				</select>
				<!-- Dev: tool-call panel toggle -->
				<button
					on:click={() => (showToolPanel = !showToolPanel)}
					title="Toggle tool-call trace"
					class="rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300
						{showToolPanel ? 'text-indigo-400' : ''}"
				>
					🔧
					{#if allToolCalls.length > 0}
						<span class="text-xs">{allToolCalls.length}</span>
					{/if}
				</button>
				{#if messages.length > 0}
					<button
						on:click={clearChat}
						class="rounded p-1 text-xs text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
						title="Clear chat"
					>
						✕
					</button>
				{/if}
			</div>
		</div>

		<!-- Message list -->
		<div class="flex-1 space-y-3 overflow-y-auto px-3 py-3">
			{#if messages.length === 0}
				<!-- Empty state with suggestions -->
				<div class="flex h-full flex-col items-center justify-center text-center">
					<div class="mb-2 text-4xl">📖</div>
					<h2 class="mb-1 text-base font-semibold text-gray-200">Ask a translation question</h2>
					<p class="mb-5 max-w-xs text-xs text-gray-500">
						Include a Bible reference for in-depth passage analysis, or ask a general translation
						question.
					</p>
					<div class="flex flex-wrap justify-center gap-1.5">
						{#each SUGGESTED as s}
							<button
								on:click={() => useSuggestion(s)}
								class="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-300 transition-colors hover:border-indigo-500 hover:text-white"
							>
								{s}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				{#each messages as msg, i}
					{#if msg.role === 'user'}
						<!-- User bubble -->
						<div class="flex justify-end">
							<div
								class="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3 py-2 text-sm text-white"
							>
								{msg.content}
							</div>
						</div>
					{:else}
						<!-- Assistant bubble -->
						<div data-msgid={i} class="flex justify-start {isDrillBranch(msg) ? 'pl-4' : ''}">
							<div class="max-w-[95%] space-y-1.5 {isDrillBranch(msg) ? 'w-full' : ''}">
								{#if isDrillBranch(msg)}
									<div class="flex items-center gap-2 pl-0.5 text-xs text-violet-400">
										<div class="h-px flex-1 bg-violet-800/50"></div>
										<span class="shrink-0 font-medium">↳ Phrase detail</span>
										<div class="h-px flex-1 bg-violet-800/50"></div>
									</div>
								{/if}

								<!-- Message text (analysis from LLM — concise since data is in workbench) -->
								<div
									class="prose prose-invert prose-sm max-w-none rounded-2xl px-3 py-2.5 text-gray-100
										{isDrillBranch(msg)
										? 'rounded-tl-sm border border-violet-800/40 bg-gray-800/80'
										: 'rounded-tl-sm bg-gray-800'}"
								>
									{@html renderMarkdownLocal(msg.content)}
								</div>

								<!-- Data warning -->
								{#if msg.dataWarning}
									<div
										class="flex items-start gap-1.5 rounded-lg border border-amber-700 bg-amber-950 px-2.5 py-1.5 text-xs text-amber-300"
									>
										<span class="mt-0.5 shrink-0">⚠️</span>
										<span>{msg.dataWarning}</span>
									</div>
								{/if}

								<!-- Navigation: after phrase_drill on last message -->
								{#if isDrillBranch(msg) && msg === messages[messages.length - 1]}
									<div class="flex flex-wrap items-center gap-1.5 pt-0.5">
										{#if msg.drillIndex && msg.totalChallenges && msg.drillIndex < msg.totalChallenges}
											<button
												on:click={() => drillNext(msg.drillIndex!)}
												disabled={isLoading}
												class="flex items-center gap-1 rounded-lg border border-violet-600 bg-violet-950 px-2.5 py-1 text-xs font-medium text-violet-300 transition-colors hover:border-violet-400 hover:text-white disabled:opacity-40"
											>
												Next #{msg.drillIndex + 1} →
											</button>
										{/if}
										<button
											on:click={returnToPassage}
											disabled={isLoading}
											class="flex items-center gap-1 rounded-lg border border-gray-600 bg-gray-800 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-gray-400 hover:text-white disabled:opacity-40"
										>
											↑ All challenges
										</button>
									</div>
								{/if}

								<!-- Continue button -->
								{#if msg === messages[messages.length - 1] && !msg.challenges && !isDrillBranch(msg)}
									{#if hasChecklistStep(msg)}
										<button
											on:click={sendNext}
											disabled={isLoading}
											class="flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-950 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-500 hover:text-white disabled:opacity-40"
										>
											<span>Next step</span>
											<span>→</span>
										</button>
									{:else if msg.nextBatch}
										<button
											on:click={sendNext}
											disabled={isLoading}
											class="flex items-center gap-1 rounded-lg border border-indigo-700 bg-indigo-950 px-2.5 py-1 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-500 hover:text-white disabled:opacity-40"
										>
											<span>Next</span>
											<span class="font-mono">{msg.nextBatch}</span>
											<span>→</span>
										</button>
									{/if}
								{/if}

								<!-- Meta row -->
								<div class="flex flex-wrap items-center gap-2 px-0.5">
									{#if msg.reference}
										<span
											class="rounded bg-indigo-950 px-1.5 py-0.5 font-mono text-xs text-indigo-300"
										>
											{msg.reference}
										</span>
									{/if}
									{#if msg.mode && msg.mode !== 'compose'}
										<span
											class="text-xs {msg.mode === 'training-only'
												? 'text-amber-600'
												: 'text-gray-600'}"
										>
											{modeLabel(msg.mode)}
										</span>
									{/if}
									{#if msg.latencyMs}
										<span class="text-xs text-gray-700">{msg.latencyMs}ms</span>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				{/each}

				<!-- Sub-agent thinking panel -->
				{#if isLoading && thinkingSteps.size > 0}
					<div class="flex justify-start">
						<div
							class="w-56 space-y-1 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2 text-xs"
						>
							<p class="mb-1 font-semibold tracking-wider text-gray-500 uppercase">Analyzing</p>
							{#each [...thinkingSteps.entries()] as [label, state]}
								<div class="flex items-center gap-1.5">
									{#if state === 'done'}
										<span class="shrink-0 font-bold text-emerald-400">✓</span>
									{:else}
										<span
											class="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-indigo-400"
										></span>
									{/if}
									<span class={state === 'done' ? 'text-gray-500 line-through' : 'text-gray-200'}
										>{label}</span
									>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Loading indicator -->
				{#if isLoading && thinkingSteps.size === 0}
					<div class="flex justify-start">
						<div
							class="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-gray-800 px-3 py-2.5"
						>
							<span
								class="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]"
							></span>
							<span
								class="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]"
							></span>
							<span class="h-2 w-2 animate-bounce rounded-full bg-indigo-400"></span>
						</div>
					</div>
				{/if}
				{#if isLoading && statusLine}
					<div class="animate-pulse px-1 py-0.5 text-xs text-indigo-400 italic">{statusLine}</div>
				{/if}
			{/if}
			<div bind:this={messagesEnd}></div>
		</div>

		<!-- Error banner -->
		{#if error}
			<div
				class="mx-3 mb-2 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300"
			>
				{error}
			</div>
		{/if}

		<!-- Input bar -->
		<div class="shrink-0 border-t border-gray-800 px-3 py-2.5">
			<div class="flex gap-2">
				<textarea
					bind:value={input}
					on:keydown={handleKey}
					placeholder="Ask about a passage or translation concept…"
					rows="2"
					class="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
					disabled={isLoading}
				></textarea>
				<button
					on:click={send}
					disabled={isLoading || !input.trim()}
					class="self-end rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{isLoading ? '…' : '→'}
				</button>
			</div>
		</div>
	</div>
	<!-- end left panel -->

	<!-- ══ RIGHT PANEL: Resource Workbench (65%) ════════════════════════════ -->
	<div
		class="flex min-h-0 flex-1 flex-col p-2 md:p-3
			{mobileView === 'chat' ? 'hidden md:flex' : 'flex'}"
	>
		{#if showToolPanel}
			<!-- Dev: tool-call trace panel (replaces workbench when open) -->
			<div
				class="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900"
			>
				<div class="flex items-center justify-between border-b border-gray-800 px-3 py-2">
					<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase"
						>Tool Calls</span
					>
					<div class="flex items-center gap-2">
						{#if allToolCalls.length > 0}
							<span class="text-xs text-gray-500">{allToolCalls.length} total</span>
						{/if}
						<button
							on:click={() => (showToolPanel = false)}
							class="text-xs text-gray-500 hover:text-gray-300"
						>
							✕ Close
						</button>
					</div>
				</div>
				<div class="flex-1 space-y-1.5 overflow-y-auto p-2">
					{#if allToolCalls.length === 0}
						<p class="px-2 py-4 text-center text-xs text-gray-600">No tool calls yet.</p>
					{:else}
						{#each allToolCalls as tc}
							<div
								class="rounded-lg border {tc.ok
									? 'border-gray-700'
									: 'border-red-800'} bg-gray-800/60 text-xs"
							>
								<button
									class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
									on:click={() => toggleExpand(tc.key)}
								>
									<span class="shrink-0 {tc.ok ? 'text-emerald-400' : 'text-red-400'}"
										>{tc.ok ? '✓' : '✗'}</span
									>
									<span class="shrink-0 font-mono font-semibold text-indigo-300"
										>{tc.tool.replace(/_/g, '_\u200B')}</span
									>
									{#if tc.summary}
										<span class="truncate text-gray-500">{tc.summary}</span>
									{/if}
									<span class="ml-auto shrink-0 text-gray-600">{tc.latencyMs}ms</span>
									<span class="shrink-0 text-gray-600">{expandedCalls.has(tc.key) ? '▲' : '▼'}</span
									>
								</button>
								{#if expandedCalls.has(tc.key)}
									<div class="space-y-1.5 border-t border-gray-700 px-2.5 py-2">
										{#if tc.turnLabel}
											<p class="text-gray-500">
												Turn: <span class="text-gray-400">{tc.turnLabel}</span>
											</p>
										{/if}
										<div>
											<p class="mb-0.5 text-gray-500">Params</p>
											<pre
												class="overflow-x-auto rounded bg-gray-900 p-1.5 break-all whitespace-pre-wrap text-gray-300">{JSON.stringify(
													tc.params,
													null,
													2
												)}</pre>
										</div>
										{#if tc.resultSnapshot !== undefined}
											<div>
												<p class="mb-0.5 text-gray-500">Response</p>
												<pre
													class="max-h-40 overflow-x-auto rounded bg-gray-900 p-1.5 break-all whitespace-pre-wrap text-emerald-300">{JSON.stringify(
														tc.resultSnapshot,
														null,
														2
													)}</pre>
											</div>
										{/if}
										{#if tc.error}
											<div>
												<p class="mb-0.5 text-red-500">Error</p>
												<pre
													class="overflow-x-auto rounded bg-red-950 p-1.5 break-all whitespace-pre-wrap text-red-300">{tc.error}</pre>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{:else}
			<ResourceWorkbench
				components={workbenchComponents}
				{isLoading}
				explored={workbenchExplored}
				onSelectChallenge={(idx) => {
					const challenges = workbenchComponents
						.filter((c) => c.type === 'challenge_cards')
						.flatMap(
							(c) => (c as { type: 'challenge_cards'; challenges: ChallengeItem[] }).challenges
						);
					const c = challenges.find((ch) => ch.index === idx);
					if (c) drillInto(c);
				}}
				onDrillBack={returnToPassage}
			/>
		{/if}
	</div>
	<!-- end right panel -->

	<!-- ══ Mobile toggle button ═════════════════════════════════════════════ -->
	<div class="fixed right-4 bottom-20 z-50 md:hidden">
		<button
			on:click={() => (mobileView = mobileView === 'chat' ? 'resources' : 'chat')}
			class="flex items-center gap-1.5 rounded-full border border-gray-600 bg-gray-800/90 px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors hover:border-indigo-500 hover:text-white
				{hasWorkbenchContent ? 'text-indigo-300' : 'text-gray-400'}"
		>
			{#if mobileView === 'chat'}
				<span>📚</span>
				<span>Resources</span>
				{#if hasWorkbenchContent}
					<span class="h-2 w-2 rounded-full bg-indigo-500"></span>
				{/if}
			{:else}
				<span>💬</span>
				<span>Chat</span>
			{/if}
		</button>
	</div>
</div>
<!-- end outer grid -->
