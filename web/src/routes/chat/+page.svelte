<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { marked } from 'marked';

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
		/** Next verse-batch ref when in a progressive-disclosure session, e.g. "JHN 3:1-4" */
		nextBatch?: string;
		/** Structured challenge list from an annotated_passage response. */
		challenges?: ChallengeItem[];
		/** For phrase_drill: which challenge index was just answered */
		drillIndex?: number;
		/** Total challenges in the current session */
		totalChallenges?: number;
		/** MCP tool calls made for this turn */
		toolCalls?: ToolCallTrace[];
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
	/** Live status line shown while a streaming response is in progress */
	let statusLine = '';

	// Tool-call side panel
	let showPanel = false;
	let expandedCalls: Set<string> = new Set();

	// Sub-agent thinking panel — tracks per-agent progress during overview requests.
	// Key: agent label, Value: 'working' | 'done'
	let thinkingSteps: Map<string, 'working' | 'done'> = new Map();

	// Hydrate profile from localStorage on mount
	onMount(() => {
		try {
			const stored = localStorage.getItem(PROFILE_KEY);
			if (stored) {
				profile = JSON.parse(stored) as UserProfile;
				if (profile.language) {
					language = profile.language;
				}
			}
		} catch {
			// localStorage unavailable or invalid JSON — ignore
		}
	});

	function saveProfile() {
		try {
			localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
		} catch {
			// ignore
		}
	}

	/** All tool calls from all assistant turns, most-recent-turn first. */
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
		if (expandedCalls.has(key)) {
			expandedCalls.delete(key);
		} else {
			expandedCalls.add(key);
		}
		expandedCalls = new Set(expandedCalls); // trigger reactivity
	}

	/** Summarise params as a short readable string. */
	function fmtParams(params: Record<string, unknown>): string {
		const keys = ['reference', 'language', 'query', 'path', 'term'];
		const parts = keys
			.filter((k) => params[k] !== undefined)
			.map((k) => `${k}=${JSON.stringify(params[k])}`);
		return parts.join(' ') || Object.keys(params).slice(0, 2).map((k) => `${k}=…`).join(' ');
	}

	const SUGGESTED = [
		'Help me translate John 3',
		'Explain John 3:16 for translation',
		'What does the word "grace" mean in biblical context?',
		'How should I translate Genesis 1:1?',
		'What are figures of speech in translation?'
	];

	/** True when the last assistant message is a guided checklist step */
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

		// Add a placeholder assistant message that will be filled by streaming
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
				body: JSON.stringify({ messages: messages.slice(0, assistantIdx), language, model, profile })
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}

			if (!res.body) {
				throw new Error('No response body');
			}

			// --- SSE stream reader ---
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let sseBuffer = '';

			const processFrame = (frame: string) => {
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
					if (label) {
						thinkingSteps = new Map(thinkingSteps).set(label, state);
					}
				} else if (event === 'token') {
						const delta = String(parsed.delta ?? '');
						messages[assistantIdx] = {
							...messages[assistantIdx],
							content: (messages[assistantIdx].content ?? '') + delta
						};
						messages = messages; // trigger reactivity
						scrollToBottom();
					} else if (event === 'meta') {
						// Sync language
						if (parsed.setLanguage && typeof parsed.setLanguage === 'string') {
							language = parsed.setLanguage;
							profile = { ...profile, language: parsed.setLanguage };
							saveProfile();
						}
						// Sync name
						if (parsed.setName && typeof parsed.setName === 'string') {
							profile = { ...profile, name: parsed.setName };
							saveProfile();
						}
				} else if (event === 'done') {
					statusLine = '';
					thinkingSteps = new Map();
						// Use response field from done payload if content is still empty
						// (e.g. gates that emitted tokens but also set response with markers)
						const doneResponse = typeof parsed.response === 'string' ? parsed.response : undefined;
						if (doneResponse && !messages[assistantIdx].content) {
							messages[assistantIdx] = { ...messages[assistantIdx], content: doneResponse };
						} else if (doneResponse) {
							// Merge hidden markers from response into displayed content
							// The tokens contain the visible text; append any hidden markers only.
							// Use [\s\S]*? (non-greedy, dotAll) so the regex handles multi-line JSON
							// and content that contains ">" (e.g. CHALLENGES arrays with rich fields).
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
							citations: (parsed.citations as ChallengeItem[] | undefined) ?? messages[assistantIdx].citations ?? [],
							reference: typeof parsed.reference === 'string' ? parsed.reference : messages[assistantIdx].reference,
							mode: (parsed.mode as Message['mode']) ?? messages[assistantIdx].mode,
							dataWarning: typeof parsed.dataWarning === 'string' ? parsed.dataWarning : messages[assistantIdx].dataWarning,
							latencyMs: Date.now() - start,
							model: typeof parsed.model === 'string' ? parsed.model : model,
							intent: typeof parsed.intent === 'string' ? parsed.intent : messages[assistantIdx].intent,
							nextBatch: typeof parsed.nextBatch === 'string' ? parsed.nextBatch : messages[assistantIdx].nextBatch,
							challenges: (parsed.challenges as ChallengeItem[] | undefined) ?? messages[assistantIdx].challenges,
							drillIndex: typeof parsed.drillIndex === 'number' ? parsed.drillIndex : messages[assistantIdx].drillIndex,
							totalChallenges: typeof parsed.totalChallenges === 'number' ? parsed.totalChallenges : messages[assistantIdx].totalChallenges,
							toolCalls: (parsed.toolCalls as ToolCallTrace[] | undefined) ?? messages[assistantIdx].toolCalls
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
				} catch {
					// Ignore parse errors
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
			// Remove placeholder if still empty
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
		messages = [];
		error = '';
	}

	/** Send the "next" continuation message to advance the verse batch or checklist. */
	function sendNext() {
		input = 'next';
		send();
	}

	/** Drill into a specific challenge phrase. */
	function drillInto(challenge: ChallengeItem) {
		input = String(challenge.index);
		send();
	}

	/** Advance to the next challenge after a phrase_drill response. */
	function drillNext(currentIndex: number) {
		input = String(currentIndex + 1);
		send();
	}

	/** Return to the annotated passage challenge list from a drill branch. */
	function returnToPassage() {
		// Re-show the challenge list: find the last annotated_passage message and re-display
		// We can't re-show the buttons from a past message in the list easily,
		// so we send "show challenges" which the intent classifier maps to the list display.
		// Simpler: just scroll up so user sees the challenge buttons. Show a visual hint.
		const lastAnnotated = [...messages].reverse().find((m) => m.intent === 'annotated_passage');
		if (lastAnnotated) {
			const el = document.querySelector(`[data-msgid="${messages.indexOf(lastAnnotated)}"]`);
			el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	const CATEGORY_BADGE: Record<string, string> = {
		'figure-of-speech': '🌀',
		'double-meaning':   '🔀',
		'idiom':            '💬',
		'grammar':          '✏️',
		'key-term':         '🔑',
		'name':             '📛',
		'cultural':         '🏛️',
		'other':            '⚠️'
	};

	/** Tailwind classes for challenge buttons — different colours for TN vs TW */
	function challengeBtnClass(c: ChallengeItem): string {
		if (c.sourceType === 'tw') {
			return 'flex items-center gap-1.5 rounded-lg border border-amber-600 bg-amber-950/60 px-3 py-1.5 text-left text-sm transition-colors hover:border-amber-400 hover:bg-amber-900 disabled:opacity-40';
		}
		return 'flex items-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-950/60 px-3 py-1.5 text-left text-sm transition-colors hover:border-indigo-400 hover:bg-indigo-900 disabled:opacity-40';
	}

	/** Whether a message is a phrase-drill branch response. */
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

	function renderMarkdown(text: string): string {
		try {
			// Strip all hidden HTML comments (CHALLENGES, WARMUP, LANG, AWAITING_LANG,
			// PENDING_PASSAGE, NAME_INVITED) and any residual USFM markup before rendering
			const clean = stripUsfm(
				text.replace(/<!--[\s\S]*?-->/g, '').trimEnd()
			);
			return marked.parse(clean) as string;
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
	<title>Chat · Translation Helps MCP</title>
</svelte:head>

<div class="mx-auto flex h-[calc(100vh-8rem)] px-4 py-6 {showPanel ? 'max-w-7xl gap-4' : 'max-w-4xl'}" style="flex-direction: {showPanel ? 'row' : 'column'}">

<!-- ── Main chat column ── -->
<div class="flex flex-1 min-w-0 flex-col {showPanel ? 'h-full' : ''}">

	<!-- Header -->
	<div class="mb-4 flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-bold text-white">Translation Help Chat</h1>
		<p class="mt-0.5 text-sm text-gray-400">
			Powered by Skills · RAG · OpenAI · <span class="font-mono text-indigo-400">{model}</span>
		</p>
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<!-- Model selector -->
		<div class="flex items-center gap-2">
			<label for="mdl" class="text-sm text-gray-400">Model</label>
			<select
				id="mdl"
				bind:value={model}
				class="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
			>
				<option value="gpt-4o">gpt-4o</option>
				<option value="gpt-4o-mini">gpt-4o-mini</option>
				<option value="gpt-4.1">gpt-4.1</option>
				<option value="gpt-4.1-mini">gpt-4.1-mini</option>
			</select>
		</div>
		<!-- Language selector -->
		<div class="flex items-center gap-2">
			<label for="lang" class="text-sm text-gray-400">Language</label>
			<select
				id="lang"
				bind:value={language}
				class="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200 focus:border-indigo-500 focus:outline-none"
			>
					<option value="en">English (en)</option>
					<option value="es">Spanish (es)</option>
					<option value="es-419">Spanish LA (es-419)</option>
					<option value="fr">French (fr)</option>
					<option value="pt-BR">Portuguese BR (pt-BR)</option>
					<option value="id">Indonesian (id)</option>
					<option value="hi">Hindi (hi)</option>
					<option value="ar">Arabic (ar)</option>
					<option value="ru">Russian (ru)</option>
					<option value="zh-Hans">Chinese (zh-Hans)</option>
				</select>
			</div>
			<!-- Tool-call panel toggle -->
		<button
			on:click={() => (showPanel = !showPanel)}
			class="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm transition-colors
				{showPanel
					? 'border-indigo-500 bg-indigo-950 text-indigo-300'
					: 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'}"
		>
			<span>🔧</span>
			<span>Tools</span>
			{#if allToolCalls.length > 0}
				<span class="ml-0.5 rounded-full bg-indigo-700 px-1.5 py-0.5 text-xs font-semibold text-white">
					{allToolCalls.length}
				</span>
			{/if}
		</button>
		{#if messages.length > 0}
				<button
					on:click={clearChat}
					class="rounded-md border border-gray-700 px-3 py-1 text-sm text-gray-400 hover:border-gray-500 hover:text-white"
				>
					Clear
				</button>
			{/if}
		</div>
	</div>

	<!-- Message list -->
	<div class="flex-1 space-y-4 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-4">
		{#if messages.length === 0}
			<!-- Empty state with suggestions -->
			<div class="flex h-full flex-col items-center justify-center text-center">
				<div class="mb-2 text-4xl">📖</div>
				<h2 class="mb-1 text-lg font-semibold text-gray-200">Ask a translation question</h2>
				<p class="mb-6 max-w-sm text-sm text-gray-500">
					Include a Bible reference for in-depth passage analysis, or ask a general translation
					question for semantic search.
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					{#each SUGGESTED as s}
						<button
							on:click={() => useSuggestion(s)}
							class="rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-indigo-500 hover:text-white"
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
							class="max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm text-white"
						>
							{msg.content}
						</div>
					</div>
				{:else}
					<!-- Assistant bubble — branch visual for phrase_drill -->
					<div
						data-msgid={i}
						class="flex justify-start {isDrillBranch(msg) ? 'pl-6' : ''}"
					>
						<div class="max-w-[88%] space-y-2 {isDrillBranch(msg) ? 'w-full' : ''}">

							<!-- Branch indicator stripe for phrase_drill -->
							{#if isDrillBranch(msg)}
								<div class="flex items-center gap-2 pl-0.5 text-xs text-violet-400">
									<div class="h-px flex-1 bg-violet-800/50"></div>
									<span class="shrink-0 font-medium">↳ Phrase detail</span>
									<div class="h-px flex-1 bg-violet-800/50"></div>
								</div>
							{/if}

							<div
								class="prose prose-invert prose-sm max-w-none rounded-2xl px-4 py-3 text-gray-100
								{isDrillBranch(msg)
									? 'rounded-tl-sm border border-violet-800/40 bg-gray-800/80'
									: 'rounded-tl-sm bg-gray-800'}"
							>
								{@html renderMarkdown(msg.content)}
							</div>

							<!-- Data-quality warning (training-only mode) -->
							{#if msg.dataWarning}
								<div
									class="flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-950 px-3 py-2 text-xs text-amber-300"
								>
									<span class="mt-0.5 shrink-0">⚠️</span>
									<span>{msg.dataWarning}</span>
								</div>
							{/if}

							<!-- Challenge buttons (annotated_passage) — TN and TW have distinct colours -->
							{#if msg.challenges && msg.challenges.length > 0}
								<!-- Only show on the last annotated_passage message -->
								{#if msg === messages.filter((m) => m.intent === 'annotated_passage').at(-1) && msg === messages[messages.length - 1]}
									<div class="space-y-2 pt-1">
										<!-- TN group -->
										{#if msg.challenges.some((c) => c.sourceType !== 'tw')}
											<p class="px-0.5 text-xs font-semibold uppercase tracking-wider text-indigo-400">
												📝 Translation Notes
											</p>
											<div class="flex flex-wrap gap-2">
												{#each msg.challenges.filter((c) => c.sourceType !== 'tw') as challenge}
													<button
														on:click={() => drillInto(challenge)}
														disabled={isLoading}
														class={challengeBtnClass(challenge)}
													>
														<span class="font-bold text-indigo-300">{challenge.index}.</span>
														<span>{CATEGORY_BADGE[challenge.category] ?? '⚠️'}</span>
														<span class="font-medium text-white">"{challenge.phrase}"</span>
														<span class="text-gray-500 text-xs">v.{challenge.verse}</span>
													</button>
												{/each}
											</div>
										{/if}
										<!-- TW group -->
										{#if msg.challenges.some((c) => c.sourceType === 'tw')}
											<p class="px-0.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
												📖 Key Terms
											</p>
											<div class="flex flex-wrap gap-2">
												{#each msg.challenges.filter((c) => c.sourceType === 'tw') as challenge}
													<button
														on:click={() => drillInto(challenge)}
														disabled={isLoading}
														class={challengeBtnClass(challenge)}
													>
														<span class="font-bold text-amber-300">{challenge.index}.</span>
														<span>🔑</span>
														<span class="font-medium text-white">"{challenge.phrase}"</span>
														<span class="text-gray-500 text-xs">v.{challenge.verse}</span>
													</button>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							{/if}

							<!-- After a phrase_drill: "Next challenge →" and "↑ All challenges" -->
							{#if isDrillBranch(msg) && msg === messages[messages.length - 1]}
								<div class="flex flex-wrap items-center gap-2 pt-1">
									{#if msg.drillIndex && msg.totalChallenges && msg.drillIndex < msg.totalChallenges}
										<button
											on:click={() => drillNext(msg.drillIndex!)}
											disabled={isLoading}
											class="flex items-center gap-1.5 rounded-lg border border-violet-600 bg-violet-950 px-3 py-1.5 text-sm font-medium text-violet-300 transition-colors hover:border-violet-400 hover:text-white disabled:opacity-40"
										>
											<span>Next challenge</span>
											<span class="font-bold">#{msg.drillIndex + 1}</span>
											<span>→</span>
										</button>
									{/if}
									<button
										on:click={returnToPassage}
										disabled={isLoading}
										class="flex items-center gap-1.5 rounded-lg border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-gray-400 hover:text-white disabled:opacity-40"
									>
										↑ All challenges
									</button>
								</div>
							{/if}

							<!-- Continue button (checklist step or batch mode) -->
							{#if msg === messages[messages.length - 1] && !msg.challenges && !isDrillBranch(msg)}
								{#if hasChecklistStep(msg)}
									<button
										on:click={sendNext}
										disabled={isLoading}
										class="flex items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-colors hover:border-emerald-500 hover:text-white disabled:opacity-40"
									>
										<span>Next step</span>
										<span>→</span>
									</button>
								{:else if msg.nextBatch}
									<button
										on:click={sendNext}
										disabled={isLoading}
										class="flex items-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-950 px-3 py-1.5 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-500 hover:text-white disabled:opacity-40"
									>
										<span>Next</span>
										<span class="font-mono text-xs text-indigo-400">{msg.nextBatch}</span>
										<span>→</span>
									</button>
								{/if}
							{/if}

							<!-- Meta row -->
							<div class="flex flex-wrap items-center gap-3 px-1">
								{#if msg.reference}
									<span
										class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-300"
									>
										{msg.reference}
									</span>
								{/if}
								{#if msg.mode}
									<span
										class="text-xs {msg.mode === 'training-only'
											? 'text-amber-600'
											: 'text-gray-600'}">{modeLabel(msg.mode)}</span
									>
								{/if}
								{#if msg.model}
									<span class="font-mono text-xs text-gray-600">{msg.model}</span>
								{/if}
								{#if msg.latencyMs}
									<span class="text-xs text-gray-600">{msg.latencyMs}ms</span>
								{/if}
							</div>

							<!-- Citations -->
							{#if msg.citations && msg.citations.length > 0}
								<div class="rounded-lg border border-gray-700 bg-gray-850 px-3 py-2 text-xs">
									<p class="mb-1 font-medium text-gray-400">Sources</p>
									<ul class="space-y-0.5">
										{#each msg.citations as c}
											<li class="font-mono text-indigo-400">{c.path}</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Sub-agent thinking panel — visible when overview pipeline is running -->
			{#if isLoading && thinkingSteps.size > 0}
				<div class="flex justify-start">
					<div class="w-64 rounded-xl border border-gray-700 bg-gray-800/80 px-3 py-2.5 text-xs space-y-1.5">
						<p class="font-semibold uppercase tracking-wider text-gray-500 mb-1">Analyzing</p>
						{#each [...thinkingSteps.entries()] as [label, state]}
							<div class="flex items-center gap-2">
								{#if state === 'done'}
									<span class="text-emerald-400 font-bold shrink-0">✓</span>
								{:else}
									<span class="inline-block h-2 w-2 shrink-0 rounded-full bg-indigo-400 animate-pulse"></span>
								{/if}
								<span class="{state === 'done' ? 'text-gray-400 line-through' : 'text-gray-200'}">{label}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Loading indicator (dots) — shown when no thinking steps yet -->
			{#if isLoading && thinkingSteps.size === 0}
				<div class="flex justify-start">
					<div class="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-800 px-4 py-3">
						<span class="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]"
						></span>
						<span class="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]"
						></span>
						<span class="h-2 w-2 animate-bounce rounded-full bg-indigo-400"></span>
					</div>
				</div>
			{/if}
			{#if isLoading && statusLine}
				<div class="px-2 py-1 text-xs text-indigo-400 italic animate-pulse">{statusLine}</div>
			{/if}
		{/if}

		<!-- Scroll anchor -->
		<div bind:this={messagesEnd}></div>
	</div>

	<!-- Error banner -->
	{#if error}
		<div class="mt-2 rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
			{error}
		</div>
	{/if}

	<!-- Input bar -->
	<div class="mt-3 flex gap-2">
		<textarea
			bind:value={input}
			on:keydown={handleKey}
			placeholder="Ask about a Bible passage or translation concept… (Enter to send, Shift+Enter for newline)"
			rows="2"
			class="flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
			disabled={isLoading}
		></textarea>
		<button
			on:click={send}
			disabled={isLoading || !input.trim()}
			class="self-end rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
		>
			{isLoading ? 'Thinking…' : 'Send'}
		</button>
	</div>

</div><!-- end main chat column -->

<!-- ── Tool-call side panel ── -->
{#if showPanel}
<aside class="flex w-80 shrink-0 flex-col rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
	<div class="flex items-center justify-between border-b border-gray-800 px-3 py-2">
		<span class="text-xs font-semibold uppercase tracking-wider text-gray-400">Tool Calls</span>
		{#if allToolCalls.length > 0}
			<span class="text-xs text-gray-500">{allToolCalls.length} total</span>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-2 space-y-1.5">
		{#if allToolCalls.length === 0}
			<p class="px-2 py-4 text-center text-xs text-gray-600">
				No tool calls yet.<br />Send a message to see which tools the system uses.
			</p>
		{:else}
			{#each allToolCalls as tc}
				<!-- Tool call row -->
				<div class="rounded-lg border {tc.ok ? 'border-gray-700' : 'border-red-800'} bg-gray-800/60 text-xs">
					<!-- Header row (always visible) -->
					<button
						class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
						on:click={() => toggleExpand(tc.key)}
					>
						<!-- Status dot -->
						<span class="shrink-0 {tc.ok ? 'text-emerald-400' : 'text-red-400'}">
							{tc.ok ? '✓' : '✗'}
						</span>
						<!-- Tool name badge -->
						<span class="shrink-0 font-mono font-semibold text-indigo-300">
							{tc.tool.replace(/_/g, '_\u200B')}
						</span>
						<!-- Summary -->
						{#if tc.summary}
							<span class="truncate text-gray-500">{tc.summary}</span>
						{/if}
						<!-- Latency -->
						<span class="ml-auto shrink-0 text-gray-600">{tc.latencyMs}ms</span>
						<!-- Expand chevron -->
						<span class="shrink-0 text-gray-600">{expandedCalls.has(tc.key) ? '▲' : '▼'}</span>
					</button>

					<!-- Expanded detail -->
					{#if expandedCalls.has(tc.key)}
						<div class="border-t border-gray-700 px-2.5 py-2 space-y-1.5">
							<!-- Turn label -->
							{#if tc.turnLabel}
								<p class="text-gray-500">Turn: <span class="text-gray-400">{tc.turnLabel}</span></p>
							{/if}
							<!-- Params -->
							<div>
								<p class="mb-0.5 text-gray-500">Params</p>
								<pre class="overflow-x-auto rounded bg-gray-900 p-1.5 text-gray-300 leading-relaxed whitespace-pre-wrap break-all">{JSON.stringify(tc.params, null, 2)}</pre>
							</div>
						<!-- Result snapshot -->
						{#if tc.resultSnapshot !== undefined}
							<div>
								<p class="mb-0.5 text-gray-500">Response</p>
								<pre class="overflow-x-auto rounded bg-gray-900 p-1.5 text-emerald-300 leading-relaxed whitespace-pre-wrap break-all max-h-48">{JSON.stringify(tc.resultSnapshot, null, 2)}</pre>
							</div>
						{/if}
						<!-- Error -->
						{#if tc.error}
							<div>
								<p class="mb-0.5 text-red-500">Error</p>
								<pre class="overflow-x-auto rounded bg-red-950 p-1.5 text-red-300 whitespace-pre-wrap break-all">{tc.error}</pre>
							</div>
						{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</aside>
{/if}

</div><!-- end outer flex row -->
