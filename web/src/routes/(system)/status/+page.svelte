<script lang="ts">
	import { onMount } from 'svelte';
	import { withBase } from '$lib/paths.js';

	type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

	interface ToolTest {
		id: string;
		label: string;
		tool: string;
		params: Record<string, unknown>;
		validate: (data: unknown) => string | null; // null = pass, string = fail reason
		status: TestStatus;
		latency: number;
		error: string;
		summary: string;
	}

	interface ChatTest {
		status: TestStatus;
		latency: number;
		error: string;
		toolsCalled: string[];
		response: string;
	}

	function isObj(v: unknown): v is Record<string, unknown> {
		return typeof v === 'object' && v !== null;
	}

	function arr(v: unknown): unknown[] {
		return Array.isArray(v) ? v : [];
	}

	const TESTS: Omit<ToolTest, 'status' | 'latency' | 'error' | 'summary'>[] = [
		{
			id: 'list_languages',
			label: 'list_languages',
			tool: 'list_languages',
			params: {},
			validate(data) {
				const d = isObj(data) ? data : {};
				const totalCount = typeof d.total_count === 'number' ? d.total_count : null;
				const langs = arr(d.languages ?? d);
				const count = totalCount ?? langs.length;
				return count >= 50 ? null : `Expected 50+ languages, got ${count}`;
			}
		},
		{
			id: 'get_passage_en',
			label: 'get_passage (JHN 3:16 en)',
			tool: 'get_passage',
			params: { reference: 'JHN 3:16', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const versions = arr(d.versions ?? d.scripture ?? []);
				return versions.length > 0 ? null : 'No versions returned';
			}
		},
		{
			id: 'get_passage_es',
			label: 'get_passage (TIT 2:12 es)',
			tool: 'get_passage',
			params: { reference: 'TIT 2:12', language: 'es' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const versions = arr(d.versions ?? d.scripture ?? []);
				return versions.length > 0 ? null : 'No Spanish versions returned';
			}
		},
		{
			id: 'get_note',
			label: 'get_note (JHN 3:16 en)',
			tool: 'get_note',
			params: { reference: 'JHN 3:16', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const notes = arr(d.notes ?? d.results ?? []);
				if (notes.length > 0) return null;
				// Also accept if data itself is an object with note fields
				if (isObj(data) && ('note' in data || 'quote' in data || 'markdown' in data)) return null;
				return 'No notes returned';
			}
		},
		{
			id: 'get_passage_index',
			label: 'get_passage_index (JHN 3 en)',
			tool: 'get_passage_index',
			params: { reference: 'JHN 3:1', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const notes = arr(d.notes ?? d.index ?? []);
				const words = arr(d.words ?? []);
				return notes.length > 0 || words.length > 0 ? null : 'Expected notes or words index';
			}
		},
		{
			id: 'get_passage_context',
			label: 'get_passage_context (JHN 3:16 en)',
			tool: 'get_passage_context',
			params: { reference: 'JHN 3:16', language: 'en' },
			validate(data) {
				if (!isObj(data)) return 'No data returned';
				const hasContent =
					'notes' in data ||
					'words' in data ||
					'questions' in data ||
					'context' in data ||
					'availability' in data ||
					'scripture' in data;
				return hasContent ? null : 'Expected context/availability keys';
			}
		},
		{
			id: 'get_academy_article',
			label: 'get_academy_article (figs-metaphor)',
			tool: 'get_academy_article',
			params: { path: 'translate/figs-metaphor', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const text = String(d.markdown ?? d.content ?? d.text ?? d.article ?? '');
				return text.length > 100 ? null : `Article too short (${text.length} chars)`;
			}
		},
		{
			id: 'get_word_article',
			label: 'get_word_article (kt/love)',
			tool: 'get_word_article',
			params: { path: 'bible/kt/love' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const text = String(d.markdown ?? d.content ?? d.text ?? d.article ?? '');
				return text.length > 100 ? null : `Article too short (${text.length} chars)`;
			}
		},
		{
			id: 'search_articles',
			label: 'search_articles (grace en)',
			tool: 'search_articles',
			params: { query: 'grace', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const results = arr(d.results ?? d.articles ?? d);
				return results.length > 0 ? null : 'No search results returned';
			}
		},
		{
			id: 'get_questions',
			label: 'get_questions (JHN 3:16 en)',
			tool: 'get_questions',
			params: { reference: 'JHN 3:16', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const questions = arr(d.questions ?? d.results ?? []);
				return questions.length > 0 ? null : 'No questions returned';
			}
		},
		{
			id: 'list_resources',
			label: 'list_resources (en)',
			tool: 'list_resources',
			params: { language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				const resources = arr(d.available ?? d.resources ?? []);
				return resources.length > 0 ? null : 'No resources returned';
			}
		},
		{
			id: 'get_obs_story',
			label: 'get_obs_story (1:1 en)',
			tool: 'get_obs_story',
			params: { reference: '1:1', language: 'en' },
			validate(data) {
				const d = isObj(data) ? data : {};
				if (d.available === false) return 'OBS not available for en';
				const frames = arr(d.frames ?? d.stories ?? []);
				if (frames.length > 0) return null;
				if (typeof d.title === 'string' || typeof d.text === 'string') return null;
				return 'No OBS story content returned';
			}
		}
	];

	let tests: ToolTest[] = TESTS.map((t) => ({
		...t,
		status: 'idle' as TestStatus,
		latency: 0,
		error: '',
		summary: ''
	}));

	let chat: ChatTest = {
		status: 'idle',
		latency: 0,
		error: '',
		toolsCalled: [],
		response: ''
	};

	let lastRun = '';
	let running = false;

	$: passing = tests.filter((t) => t.status === 'pass').length;
	$: failing = tests.filter((t) => t.status === 'fail').length;
	$: total = tests.length;
	$: allDone = tests.every((t) => t.status === 'pass' || t.status === 'fail');

	async function callTool(name: string, params: Record<string, unknown>) {
		const res = await fetch(withBase('/api/tool'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, params })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
		const data = (await res.json()) as {
			isError?: boolean;
			error?: string;
			content?: Array<{ text?: string }>;
			structuredContent?: unknown;
		};
		if (data?.isError || data?.error) {
			throw new Error(data?.error ?? data?.content?.[0]?.text ?? 'Tool error');
		}
		return data?.structuredContent ?? data;
	}

	async function runTest(test: ToolTest) {
		test.status = 'running';
		test.error = '';
		test.summary = '';
		test.latency = 0;
		tests = tests; // trigger reactivity

		const start = Date.now();
		try {
			const data = await callTool(test.tool, test.params);
			test.latency = Date.now() - start;
			const failReason = test.validate(data);
			if (failReason) {
				test.status = 'fail';
				test.error = failReason;
			} else {
				test.status = 'pass';
				// Build a short summary
				if (test.tool === 'list_languages') {
					const d = isObj(data) ? data : {};
					const totalCount = typeof d.total_count === 'number' ? d.total_count : null;
					const langs = arr(d.languages ?? data);
					test.summary =
						totalCount !== null ? `${totalCount} total languages` : `${langs.length} languages`;
				} else if (test.tool === 'get_passage') {
					const d = isObj(data) ? data : {};
					const versions = arr(d.versions ?? d.scripture ?? []);
					test.summary = `${versions.length} version(s)`;
				} else if (test.tool === 'get_note') {
					const notes = arr(isObj(data) ? (data.notes ?? data.results ?? []) : []);
					test.summary = notes.length > 0 ? `${notes.length} note(s)` : 'note found';
				} else if (test.tool === 'get_passage_index') {
					const notes = arr(isObj(data) ? (data.notes ?? data.index ?? []) : []);
					test.summary = `${notes.length} index entries`;
				} else if (test.tool === 'search_articles') {
					const results = arr(isObj(data) ? (data.results ?? data.articles ?? data) : []);
					test.summary = `${results.length} result(s)`;
				} else if (test.tool === 'get_questions') {
					const q = arr(isObj(data) ? (data.questions ?? data.results ?? []) : []);
					test.summary = `${q.length} question(s)`;
				} else if (test.tool === 'list_resources') {
					const d = isObj(data) ? data : {};
					const resources = arr(d.available ?? d.resources ?? []);
					test.summary = `${resources.length} resource(s)`;
				} else if (test.tool === 'get_obs_story') {
					const d = isObj(data) ? data : {};
					const frames = arr(d.frames ?? []);
					test.summary = frames.length > 0 ? `${frames.length} frame(s)` : 'story loaded';
				} else {
					test.summary = 'ok';
				}
			}
		} catch (e) {
			test.latency = Date.now() - start;
			test.status = 'fail';
			test.error = e instanceof Error ? e.message : String(e);
		}
		tests = tests;
	}

	async function runChatTest() {
		chat = { status: 'running', latency: 0, error: '', toolsCalled: [], response: '' };
		const start = Date.now();
		try {
			const res = await fetch(withBase('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'What does John 3:16 say in Spanish?' }],
					language: 'es',
					model: 'gpt-4o-mini'
				})
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			const reader = res.body?.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const toolsCalled: string[] = [];
			let finalText = '';

			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';
					for (const line of lines) {
						if (!line.startsWith('data:')) continue;
						const raw = line.slice(5).trim();
						if (raw === '[DONE]') continue;
						try {
							const ev = JSON.parse(raw);
							if (ev.type === 'tool_call' && ev.name) {
								toolsCalled.push(ev.name);
							}
							if (ev.type === 'text' || ev.choices?.[0]?.delta?.content) {
								finalText += ev.text ?? ev.choices?.[0]?.delta?.content ?? '';
							}
						} catch {
							// non-JSON chunk
						}
					}
				}
			}

			chat.latency = Date.now() - start;
			chat.toolsCalled = [...new Set(toolsCalled)];
			chat.response = finalText.trim().slice(0, 300) || '(response received)';
			chat.status = 'pass';
		} catch (e) {
			chat.latency = Date.now() - start;
			chat.error = e instanceof Error ? e.message : String(e);
			chat.status = 'fail';
		}
	}

	async function runAll() {
		if (running) return;
		running = true;
		lastRun = new Date().toLocaleTimeString();

		// Reset all
		tests = tests.map((t) => ({
			...t,
			status: 'idle' as TestStatus,
			error: '',
			summary: '',
			latency: 0
		}));
		chat = { status: 'idle', latency: 0, error: '', toolsCalled: [], response: '' };

		// Run tool tests in parallel
		const toolPromises = tests.map((t) => runTest(t));
		const chatPromise = runChatTest();
		await Promise.all([...toolPromises, chatPromise]);

		running = false;
	}

	function statusIcon(s: TestStatus) {
		if (s === 'idle') return '○';
		if (s === 'running') return '⏳';
		if (s === 'pass') return '✅';
		return '❌';
	}

	function statusColor(s: TestStatus) {
		if (s === 'pass') return 'text-green-400';
		if (s === 'fail') return 'text-red-400';
		if (s === 'running') return 'text-yellow-400';
		return 'text-slate-600';
	}

	function cardBorder(s: TestStatus) {
		if (s === 'pass') return 'border-green-800/60';
		if (s === 'fail') return 'border-red-800/60';
		if (s === 'running') return 'border-yellow-800/60 animate-pulse';
		return 'border-slate-800';
	}

	onMount(() => {
		runAll();
	});
</script>

<svelte:head>
	<title>API Health — Translation Helps MCP</title>
</svelte:head>

<div class="page-shell">
	<div class="mx-auto max-w-7xl px-4 py-10">
		<!-- Header row -->
		<div class="mb-8 flex flex-wrap items-start justify-between gap-4">
			<div>
				<p class="mb-2 text-xs font-semibold tracking-[0.14em] text-sky-400/90 uppercase">Health</p>
				<h1 class="text-3xl font-semibold tracking-tight text-slate-100">API Health</h1>
				<p class="mt-2 text-sm text-slate-400">
					Runs all tool tests against <span class="font-mono text-sky-400">/api/tool</span> and the chat
					SSE endpoint.
				</p>
			</div>

			<div class="flex items-center gap-4">
				<!-- Summary badge -->
				{#if allDone && total > 0}
					<div
						class="rounded-full px-4 py-1.5 text-sm font-semibold
          {failing === 0 ? 'bg-emerald-900/60 text-emerald-300' : 'bg-red-900/60 text-red-300'}"
					>
						{passing}/{total} passing
						{#if failing > 0}· {failing} failing{/if}
					</div>
				{:else if running}
					<div
						class="rounded-full bg-amber-900/60 px-4 py-1.5 text-sm font-semibold text-amber-300"
					>
						Running tests…
					</div>
				{/if}

				<button onclick={runAll} disabled={running} class="ui-btn ui-btn-solid px-5">
					{running ? 'Running…' : 'Run all tests'}
				</button>
			</div>
		</div>

		<!-- System Info -->
		<div class="ui-card mb-8 p-4">
			<h2 class="mb-3 text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
				System Info
			</h2>
			<div class="flex flex-wrap gap-6 font-mono text-sm">
				<div>
					<span class="text-slate-500">App port</span>
					<span class="ml-2 text-sky-300"
						>{typeof window !== 'undefined' ? window.location.port || '80' : '—'}</span
					>
				</div>
				<div>
					<span class="text-slate-500">Origin</span>
					<span class="ml-2 text-sky-300"
						>{typeof window !== 'undefined' ? window.location.origin : '—'}</span
					>
				</div>
				<div>
					<span class="text-slate-500">/api/tool</span>
					<span class="ml-2 text-sky-300">POST JSON</span>
				</div>
				{#if lastRun}
					<div>
						<span class="text-slate-500">Last run</span>
						<span class="ml-2 text-slate-300">{lastRun}</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Tool Health Grid -->
		<section class="mb-8">
			<h2 class="mb-4 text-lg font-semibold text-slate-100">Tool Health</h2>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each tests as test (test.id)}
					<div class="ui-card p-4 transition-colors {cardBorder(test.status)}">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-base {statusColor(test.status)}">{statusIcon(test.status)}</span
									>
									<span class="truncate font-mono text-xs font-semibold text-slate-200"
										>{test.label}</span
									>
								</div>
								{#if test.status === 'pass' && test.summary}
									<p class="mt-1 text-xs text-green-400">{test.summary}</p>
								{:else if test.status === 'fail' && test.error}
									<p class="mt-1 line-clamp-2 text-xs break-all text-red-400">{test.error}</p>
								{:else if test.status === 'running'}
									<p class="mt-1 text-xs text-yellow-500">calling…</p>
								{:else if test.status === 'idle'}
									<p class="mt-1 text-xs text-slate-600">waiting</p>
								{/if}
							</div>
							{#if test.latency > 0}
								<span class="flex-shrink-0 font-mono text-xs text-slate-500">{test.latency}ms</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>

		<!-- Chat SSE Test -->
		<section class="mb-8">
			<h2 class="mb-4 text-lg font-semibold text-slate-100">Chat SSE Endpoint</h2>
			<div class="ui-card p-5 {cardBorder(chat.status)}">
				<div class="mb-3 flex items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						<span class="text-base {statusColor(chat.status)}">{statusIcon(chat.status)}</span>
						<span class="font-mono text-sm font-semibold text-slate-200">/api/chat</span>
						<span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-400"
							>SSE stream</span
						>
					</div>
					{#if chat.latency > 0}
						<span class="font-mono text-xs text-slate-500">{chat.latency}ms</span>
					{/if}
				</div>

				{#if chat.status === 'idle'}
					<p class="text-sm text-slate-600">Waiting to run…</p>
				{:else if chat.status === 'running'}
					<div class="flex items-center gap-2 text-sm text-yellow-400">
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-yellow-800 border-t-yellow-400"
						></div>
						Streaming response…
					</div>
				{:else if chat.status === 'fail'}
					<p class="text-sm text-red-400">{chat.error || 'Unknown error'}</p>
				{:else if chat.status === 'pass'}
					<div class="space-y-3">
						{#if chat.toolsCalled.length > 0}
							<div>
								<span class="text-xs tracking-wide text-slate-500 uppercase">Tools called</span>
								<div class="mt-1 flex flex-wrap gap-1.5">
									{#each chat.toolsCalled as tool}
										<span
											class="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-xs text-sky-300 ring-1 ring-sky-500/30"
											>{tool}</span
										>
									{/each}
								</div>
							</div>
						{/if}
						{#if chat.response}
							<div>
								<span class="text-xs tracking-wide text-slate-500 uppercase">Response preview</span>
								<p class="mt-1 text-sm text-slate-300 italic">"{chat.response}"</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</section>

		<!-- Legend -->
		<div class="flex flex-wrap gap-4 text-xs text-slate-500">
			<span class="flex items-center gap-1"><span class="text-green-400">✅</span> Pass</span>
			<span class="flex items-center gap-1"><span class="text-red-400">❌</span> Fail</span>
			<span class="flex items-center gap-1"><span class="text-yellow-400">⏳</span> Running</span>
			<span class="flex items-center gap-1"><span class="text-slate-600">○</span> Idle</span>
			<span class="ml-auto">Latencies shown in <span class="font-mono">ms</span></span>
		</div>
	</div>
</div>
