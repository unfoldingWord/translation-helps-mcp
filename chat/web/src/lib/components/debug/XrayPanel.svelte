<script lang="ts">
	import TraceTimeline from './TraceTimeline.svelte';
	import TraceInspector from './TraceInspector.svelte';
	import {
		ROUTE_BADGE,
		getIntentEv,
		getRouteEv,
		countByKind,
		formatXrayReport,
		downloadTextFile
	} from './traceTypes.js';
	import type { TimedEvent, FilterKind } from './traceTypes.js';

	// ─── Props ────────────────────────────────────────────────────────────────
	/** Each entry represents one assistant turn (in message order). */
	export let turns: Array<{
		userSnippet: string;
		events: TimedEvent[];
		/** True while this turn is still streaming. */
		live?: boolean;
		statusText?: string;
	}> = [];

	export let onClose: () => void = () => {};
	/** When true, a "View Resources" button is shown in the header to switch to the workbench. */
	export let hasResources: boolean = false;

	// ─── State ────────────────────────────────────────────────────────────────
	let filter: FilterKind = 'all';
	let expandedTurns: Set<number> = new Set([0]); // newest first → turn 0 expanded by default
	let selectedTurnIdx: number | null = null;
	let selectedEventIdx: number | null = null;
	let exportNote = '';

	const FILTERS: { id: FilterKind; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'routing', label: 'Routing' },
		{ id: 'tools', label: 'Tools' },
		{ id: 'llm', label: 'LLM' },
		{ id: 'status', label: 'Status' },
		{ id: 'ui', label: 'UI' }
	];

	// Turns shown newest-first
	$: displayTurns = [...turns].reverse().map((t, reversedIdx) => ({
		...t,
		originalIdx: turns.length - 1 - reversedIdx,
		reversedIdx
	}));

	// Session summary totals
	$: totalEvents = turns.reduce((s, t) => s + t.events.length, 0);
	$: totalTools = turns.reduce((s, t) => s + countByKind(t.events, 'tool_call'), 0);
	$: totalLlm = turns.reduce((s, t) => s + countByKind(t.events, 'llm_call'), 0);
	$: totalLlmMs = turns.reduce((s, t) => {
		return (
			s +
			t.events
				.filter((e) => e.ev.kind === 'trace' && (e.ev.ev as { type: string }).type === 'llm_call')
				.reduce((sum, e) => {
					const ev = e.ev as { kind: 'trace'; ev: { type: 'llm_call'; ms: number } };
					return sum + (ev.ev.ms ?? 0);
				}, 0)
		);
	}, 0);
	$: totalToolMs = turns.reduce((s, t) => {
		return (
			s +
			t.events
				.filter((e) => e.ev.kind === 'trace' && (e.ev.ev as { type: string }).type === 'tool_call')
				.reduce((sum, e) => {
					const ev = e.ev as { kind: 'trace'; ev: { type: 'tool_call'; ms: number } };
					return sum + (ev.ev.ms ?? 0);
				}, 0)
		);
	}, 0);

	function toggleTurn(idx: number) {
		if (expandedTurns.has(idx)) {
			expandedTurns.delete(idx);
		} else {
			expandedTurns.add(idx);
		}
		expandedTurns = new Set(expandedTurns);
	}

	function selectEvent(turnIdx: number, eventIdx: number) {
		if (selectedTurnIdx === turnIdx && selectedEventIdx === eventIdx) {
			selectedTurnIdx = null;
			selectedEventIdx = null;
		} else {
			selectedTurnIdx = turnIdx;
			selectedEventIdx = eventIdx;
		}
	}

	function buildReport(): string {
		return formatXrayReport(turns);
	}

	function reportFilename(): string {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		return `xray-report-${stamp}.txt`;
	}

	async function exportReport(mode: 'download' | 'copy') {
		if (turns.length === 0) {
			exportNote = 'No turns to export';
			return;
		}
		const report = buildReport();
		if (mode === 'download') {
			downloadTextFile(reportFilename(), report);
			exportNote = 'Downloaded';
		} else {
			try {
				await navigator.clipboard.writeText(report);
				exportNote = 'Copied';
			} catch {
				// Clipboard may be blocked; fall back to download
				downloadTextFile(reportFilename(), report);
				exportNote = 'Downloaded (clipboard blocked)';
			}
		}
		window.setTimeout(() => {
			exportNote = '';
		}, 2000);
	}

	$: selectedEvent =
		selectedTurnIdx !== null && selectedEventIdx !== null
			? (turns[selectedTurnIdx]?.events[selectedEventIdx] ?? null)
			: null;
</script>

<div class="flex h-full flex-col overflow-hidden bg-slate-950 text-slate-100">
	<!-- Header -->
	<div
		class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5 sm:px-4"
	>
		<div class="flex min-w-0 items-center gap-2.5">
			<span class="text-sm font-semibold tracking-wide text-sky-400">X-ray</span>
			<span
				class="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-400"
			>
				{totalEvents} events
			</span>
			{#if exportNote}
				<span class="text-xs text-emerald-400">{exportNote}</span>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				disabled={turns.length === 0}
				on:click={() => exportReport('copy')}
				class="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
				title="Copy X-ray text report to clipboard"
				aria-label="Copy X-ray text report to clipboard"
			>
				Copy
			</button>
			<button
				type="button"
				disabled={turns.length === 0}
				on:click={() => exportReport('download')}
				class="rounded-lg border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-xs font-medium text-sky-300 transition-colors hover:border-sky-500 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
				title="Download X-ray text report"
				aria-label="Download X-ray text report"
			>
				Export
			</button>
			{#if hasResources}
				<button
					on:click={onClose}
					class="rounded-lg border border-sky-700/50 bg-sky-950/40 px-2.5 py-1 text-xs font-medium text-sky-300 transition-colors hover:border-sky-500 hover:text-sky-100"
					title="Switch to resource workbench"
				>
					Resources
				</button>
			{/if}
			<button
				on:click={onClose}
				class="rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
				aria-label="Close X-ray"
			>
				Close
			</button>
		</div>
	</div>

	<!-- Session summary strip -->
	{#if turns.length > 0}
		<div
			class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-xs sm:px-4"
		>
			<span class="text-slate-400">{turns.length} turn{turns.length !== 1 ? 's' : ''}</span>
			<span class="font-medium text-emerald-400">
				{totalTools} tools · {totalToolMs}ms
			</span>
			<span class="font-medium text-amber-400">
				{totalLlm} LLM · {totalLlmMs}ms
			</span>
		</div>
	{/if}

	<!-- Filter chips -->
	<div class="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-800 px-3 py-2 sm:px-4">
		{#each FILTERS as f}
			<button
				on:click={() => (filter = f.id)}
				class="rounded-full px-2.5 py-1 text-xs font-medium transition {filter === f.id
					? 'bg-sky-600 text-white'
					: 'border border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200'}"
			>
				{f.label}
			</button>
		{/each}
	</div>

	<!-- Turns list -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if turns.length === 0}
			<div class="px-4 py-12 text-center text-sm text-slate-400">
				<p class="text-slate-200">No turns yet</p>
				<p class="mt-2 text-slate-500">Send a message to capture the full pipeline X-ray.</p>
			</div>
		{:else}
			{#each displayTurns as dt}
				{@const intentEv = getIntentEv(dt.events)}
				{@const routeEv = getRouteEv(dt.events)}
				{@const turnToolCount = countByKind(dt.events, 'tool_call')}
				{@const turnLlmCount = countByKind(dt.events, 'llm_call')}
				{@const doneEv = dt.events.find((e) => e.ev.kind === 'done')}
				{@const turnLatency = doneEv?.t}
				{@const isExpanded = expandedTurns.has(dt.reversedIdx)}

				<div class="border-b border-slate-800/80">
					<!-- Turn header (collapsible) -->
					<button
						on:click={() => toggleTurn(dt.reversedIdx)}
						class="flex w-full items-start gap-2.5 px-3 py-3 text-left transition hover:bg-slate-900/80 sm:px-4"
					>
						<span class="mt-0.5 shrink-0 text-xs text-slate-500">{isExpanded ? '▼' : '▶'}</span>
						<div class="min-w-0 flex-1">
							<!-- User snippet -->
							<div class="truncate text-sm text-slate-100">{dt.userSnippet}</div>
							<!-- Flow badges row -->
							<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
								{#if intentEv}
									<span
										class="rounded-full bg-violet-900/70 px-2 py-0.5 text-xs font-semibold text-violet-200"
									>
										{intentEv.ev.result.intent}
									</span>
									<span
										class="rounded-full border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-400"
									>
										{intentEv.ev.result.confidence}
									</span>
									{#if intentEv.ev.result.reference}
										<span class="rounded-full bg-sky-900/60 px-1.5 py-0.5 text-xs text-sky-300">
											{intentEv.ev.result.reference}
										</span>
									{/if}
								{/if}
								{#if routeEv}
									<span
										class="rounded-full px-2 py-0.5 text-xs font-bold {ROUTE_BADGE[
											routeEv.ev.path
										] ?? 'bg-slate-700 text-white'}"
									>
										{routeEv.ev.path}
									</span>
								{/if}
								{#if turnToolCount > 0}
									<span class="text-xs text-emerald-400">{turnToolCount} tools</span>
								{/if}
								{#if turnLlmCount > 0}
									<span class="text-xs text-amber-400">{turnLlmCount} LLM</span>
								{/if}
								{#if turnLatency !== undefined}
									<span class="ml-auto font-mono text-xs text-slate-500">{turnLatency}ms</span>
								{:else if dt.live}
									<span class="ml-auto animate-pulse text-xs text-sky-400">
										{dt.statusText || 'streaming…'}
									</span>
								{/if}
							</div>
						</div>
					</button>

					<!-- Expanded: timeline + inline inspector -->
					{#if isExpanded}
						<div class="border-t border-slate-800 bg-slate-950/80">
							{#if dt.events.length === 0}
								<p class="px-4 py-3 text-sm text-slate-500 italic">
									No trace captured for this turn — X-ray was off when it ran.
								</p>
							{:else}
								<div class="p-3 sm:p-4">
									<TraceTimeline
										events={dt.events}
										selectedIdx={selectedTurnIdx === dt.originalIdx ? selectedEventIdx : null}
										{filter}
										running={dt.live ?? false}
										statusText={dt.statusText ?? ''}
										onSelect={(i) => selectEvent(dt.originalIdx, i)}
									/>
								</div>

								<!-- Inline inspector (accordion) -->
								{#if selectedTurnIdx === dt.originalIdx && selectedEvent !== null}
									<div class="border-t border-slate-800 bg-slate-900/50 text-sm">
										<div
											class="flex items-center justify-between border-b border-slate-800 px-3 py-2 sm:px-4"
										>
											<span class="text-xs font-semibold tracking-wider text-slate-400 uppercase">
												Inspector — {selectedEvent.ev.kind}
											</span>
											<button
												on:click={() => {
													selectedTurnIdx = null;
													selectedEventIdx = null;
												}}
												class="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
												aria-label="Close inspector"
											>
												✕
											</button>
										</div>
										<div class="max-h-96 overflow-y-auto">
											<TraceInspector event={selectedEvent} />
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
