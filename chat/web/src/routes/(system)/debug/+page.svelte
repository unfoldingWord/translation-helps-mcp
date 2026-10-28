<script lang="ts">
	import type { TraceEvent } from '$lib/server/traceEvents.js';
	import TraceTimeline from '$lib/components/debug/TraceTimeline.svelte';
	import TraceInspector from '$lib/components/debug/TraceInspector.svelte';
	import { ROUTE_BADGE } from '$lib/components/debug/traceTypes.js';
	import type { AnyEvent, TimedEvent } from '$lib/components/debug/traceTypes.js';
	import { withBase } from '$lib/paths.js';

	// ─── State ───────────────────────────────────────────────────────────────
	let input = '';
	let language = 'en';
	let model = 'gpt-4o';
	let running = false;

	let traceEvents: TimedEvent[] = [];
	let statusText = '';
	let responseText = '';
	let rawSseLines: string[] = [];
	let selectedIdx: number | null = null;
	let latencyMs: number | undefined = undefined;

	// Derived flow badges
	$: intentEv = traceEvents
		.map((e) => e.ev)
		.find(
			(e): e is { kind: 'trace'; ev: TraceEvent & { type: 'intent' } } =>
				e.kind === 'trace' && (e as { kind: 'trace'; ev: TraceEvent }).ev.type === 'intent'
		) as { kind: 'trace'; ev: TraceEvent & { type: 'intent' } } | undefined;

	$: routeEv = traceEvents
		.map((e) => e.ev)
		.find(
			(e): e is { kind: 'trace'; ev: TraceEvent & { type: 'route' } } =>
				e.kind === 'trace' && (e as { kind: 'trace'; ev: TraceEvent }).ev.type === 'route'
		) as { kind: 'trace'; ev: TraceEvent & { type: 'route' } } | undefined;

	$: selectedEvent = selectedIdx !== null ? traceEvents[selectedIdx] : null;

	const PRESETS = [
		'Hi',
		'Titus chapter 2',
		'John 3:16 in Spanish',
		'What does grace mean?',
		'TIT 2:12 es'
	];

	const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'];
	const LANGUAGES = ['en', 'es', 'es-419', 'fr', 'pt-br'];

	// ─── Runner ──────────────────────────────────────────────────────────────
	async function run(msg?: string) {
		const userMsg = msg ?? input;
		if (!userMsg.trim() || running) return;
		running = true;
		traceEvents = [];
		statusText = '';
		responseText = '';
		rawSseLines = [];
		selectedIdx = null;
		latencyMs = undefined;
		const t0 = Date.now();

		try {
			const res = await fetch(withBase('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: [{ role: 'user', content: userMsg }],
					language,
					model,
					debug: true
				})
			});

			if (!res.body) {
				running = false;
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const frames = buf.split('\n\n');
				buf = frames.pop() ?? '';
				for (const frame of frames) {
					if (!frame.trim()) continue;
					rawSseLines = [...rawSseLines, `[${Date.now() - t0}ms] ${frame.replace(/\n/g, ' | ')}`];
					const eventMatch = frame.match(/^event: (\S+)/m);
					const dataMatch = frame.match(/^data: (.+)$/m);
					if (!eventMatch || !dataMatch) continue;
					const evType = eventMatch[1];
					let data: unknown;
					try {
						data = JSON.parse(dataMatch[1]);
					} catch {
						data = dataMatch[1];
					}
					const t = Date.now() - t0;

					if (evType === 'trace') {
						const trEv = data as TraceEvent;
						traceEvents = [...traceEvents, { t, ev: { kind: 'trace', ev: trEv } }];
					} else if (evType === 'status') {
						const txt = (data as { text: string }).text;
						statusText = txt;
						traceEvents = [...traceEvents, { t, ev: { kind: 'status', text: txt } }];
					} else if (evType === 'token') {
						responseText += (data as { delta: string }).delta;
					} else if (evType === 'thinking') {
						const d = data as { label: string; state: string };
						traceEvents = [
							...traceEvents,
							{ t, ev: { kind: 'thinking', label: d.label, state: d.state } }
						];
					} else if (evType === 'ui') {
						traceEvents = [...traceEvents, { t, ev: { kind: 'ui', data } }];
					} else if (evType === 'done') {
						latencyMs = t;
						traceEvents = [...traceEvents, { t, ev: { kind: 'done', data } }];
					} else if (evType === 'error') {
						traceEvents = [...traceEvents, { t, ev: { kind: 'error', data } }];
					} else if (evType === 'meta') {
						traceEvents = [...traceEvents, { t, ev: { kind: 'meta', data } }];
					}
				}
			}
		} catch (err) {
			traceEvents = [
				...traceEvents,
				{ t: Date.now() - t0, ev: { kind: 'error', data: { message: String(err) } } }
			];
		}
		running = false;
	}

	function selectRow(idx: number) {
		selectedIdx = selectedIdx === idx ? null : idx;
	}
</script>

<div class="page-shell flex min-h-[calc(100vh-8rem)] flex-col text-slate-100">
	<!-- ─── Runner bar ──────────────────────────────────────────────────────── -->
	<div
		class="flex flex-wrap items-center gap-2 border-b border-slate-800/90 bg-slate-950/60 px-4 py-3"
	>
		<input
			bind:value={input}
			onkeydown={(e) => e.key === 'Enter' && run()}
			placeholder="Enter a message…"
			class="ui-input min-w-[260px] flex-1"
		/>
		<select bind:value={language} class="ui-input w-auto">
			{#each LANGUAGES as l}
				<option value={l}>{l}</option>
			{/each}
		</select>
		<select bind:value={model} class="ui-input w-auto">
			{#each MODELS as m}
				<option value={m}>{m}</option>
			{/each}
		</select>

		<!-- Presets -->
		<div class="flex flex-wrap gap-1">
			{#each PRESETS as p}
				<button
					onclick={() => {
						input = p;
						run(p);
					}}
					disabled={running}
					class="ui-chip disabled:opacity-50">{p}</button
				>
			{/each}
		</div>

		<button onclick={() => run()} disabled={running} class="ui-btn ui-btn-solid px-4 py-1.5">
			{running ? 'Running…' : 'Run'}
		</button>
	</div>

	<!-- ─── Flow badges ─────────────────────────────────────────────────────── -->
	{#if intentEv || routeEv || latencyMs !== undefined}
		<div
			class="flex flex-wrap items-center gap-2 border-b border-slate-800/90 bg-slate-900/40 px-4 py-2"
		>
			{#if intentEv}
				<span
					class="rounded-full bg-purple-800 px-3 py-0.5 text-xs font-semibold text-purple-200 uppercase"
				>
					{intentEv.ev.result.intent}
				</span>
				<span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
					{intentEv.ev.result.confidence}
				</span>
				{#if intentEv.ev.result.reference}
					<span class="rounded-full bg-blue-900 px-2 py-0.5 text-xs text-blue-200">
						📖 {intentEv.ev.result.reference}
					</span>
				{/if}
			{/if}
			{#if routeEv}
				<span
					class="rounded-full px-3 py-0.5 text-xs font-bold {ROUTE_BADGE[routeEv.ev.path] ??
						'bg-slate-700 text-white'}"
				>
					PATH {routeEv.ev.path}
				</span>
			{/if}
			<span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300 capitalize">
				{language}
			</span>
			{#if latencyMs !== undefined}
				<span
					class="ml-auto rounded-full bg-slate-700 px-3 py-0.5 font-mono text-xs text-slate-300"
				>
					⏱ {latencyMs}ms
				</span>
			{/if}
		</div>
	{/if}

	<!-- ─── Main panels ──────────────────────────────────────────────────────── -->
	<div class="flex flex-1 overflow-hidden" style="min-height: 400px;">
		<!-- Timeline (left) -->
		<div class="flex w-1/2 flex-col border-r border-slate-800" style="overflow-y: auto;">
			<div
				class="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase backdrop-blur"
			>
				Timeline ({traceEvents.length} events)
			</div>
			<div class="p-2">
				<TraceTimeline
					events={traceEvents}
					{selectedIdx}
					{running}
					{statusText}
					onSelect={selectRow}
				/>
			</div>
		</div>

		<!-- Inspector (right) -->
		<div class="flex w-1/2 flex-col" style="overflow-y: auto;">
			<div
				class="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase backdrop-blur"
			>
				Inspector {selectedEvent ? `— ${selectedEvent.ev.kind}` : '(click a row)'}
			</div>
			<TraceInspector event={selectedEvent} />
		</div>
	</div>

	<!-- ─── Response pane ────────────────────────────────────────────────────── -->
	{#if responseText || (running && statusText)}
		<div class="border-t border-slate-800 bg-slate-900/60 px-4 py-3">
			<div class="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">Response</div>
			{#if running && !responseText}
				<p class="text-sm text-slate-500 italic">{statusText}</p>
			{:else}
				<div class="prose prose-sm max-w-none text-sm whitespace-pre-wrap text-slate-200">
					{responseText}
				</div>
			{/if}
		</div>
	{/if}

	<!-- ─── Raw SSE log ───────────────────────────────────────────────────────── -->
	<details class="border-t border-slate-800 bg-slate-950">
		<summary
			class="cursor-pointer px-4 py-2 text-xs font-semibold tracking-wider text-slate-600 uppercase select-none hover:text-slate-400"
		>
			Raw SSE log ({rawSseLines.length} frames)
		</summary>
		<div class="max-h-48 overflow-y-auto px-4 pb-3 font-mono text-xs text-slate-500">
			{#each rawSseLines as line}
				<div class="border-b border-slate-900 py-0.5">{line}</div>
			{/each}
		</div>
	</details>
</div>
