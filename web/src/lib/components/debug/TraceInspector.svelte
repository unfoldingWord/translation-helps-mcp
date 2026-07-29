<script lang="ts">
	import type { TimedEvent } from './traceTypes.js';
	import { ROUTE_BADGE } from './traceTypes.js';

	export let event: TimedEvent | null = null;

	function fmtJson(v: unknown): string {
		return JSON.stringify(v, null, 2);
	}
</script>

<div class="space-y-3 p-3 text-sm sm:p-4">
	{#if !event}
		<p class="text-slate-500">Click a timeline event to inspect it.</p>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'intent'}
		{@const r = event.ev.ev}
		<div>
			<h3 class="mb-1.5 text-xs font-semibold tracking-wider text-violet-300 uppercase">
				Intent Result
			</h3>
			<pre
				class="overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{fmtJson(
					r.result
				)}</pre>
		</div>
		<div class="text-xs text-slate-500">Classified in {r.ms}ms</div>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'route'}
		{@const r = event.ev.ev}
		<div class="mb-2">
			<span
				class="mr-2 rounded-full px-3 py-1 text-sm font-bold {ROUTE_BADGE[r.path] ??
					'bg-slate-700 text-white'}"
			>
				PATH {r.path}
			</span>
		</div>
		<p class="leading-relaxed text-slate-200">{r.reason}</p>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'llm_call'}
		{@const r = event.ev.ev}
		<div>
			<div class="mb-2 flex flex-wrap items-center gap-2">
				<span class="font-semibold text-amber-300">{r.label}</span>
				<span class="text-xs text-slate-400">{r.model}</span>
				<span class="font-mono text-xs text-slate-400">{r.ms}ms</span>
				{#if r.streaming}<span class="text-xs text-sky-400">stream</span>{/if}
				{#if r.error}<span class="text-xs font-semibold text-red-400">ERROR</span>{/if}
			</div>
			<h4 class="mt-3 mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
				Messages
			</h4>
			{#each r.messages as msg}
				<div class="mb-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
					<div
						class="mb-1.5 text-xs font-semibold tracking-wide uppercase {msg.role === 'system'
							? 'text-amber-400'
							: msg.role === 'user'
								? 'text-sky-400'
								: 'text-emerald-400'}"
					>
						{msg.role}
					</div>
					<pre
						class="font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-200">{msg.content}</pre>
				</div>
			{/each}
			{#if r.response}
				<h4 class="mt-3 mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Response
				</h4>
				<pre
					class="rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-emerald-100">{r.response}</pre>
			{/if}
			{#if r.error}
				<h4 class="mt-3 mb-1.5 text-xs font-semibold tracking-wider text-red-400 uppercase">
					Error
				</h4>
				<pre class="font-mono text-xs text-red-300">{r.error}</pre>
			{/if}
		</div>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'tool_call'}
		{@const r = event.ev.ev}
		<div>
			<div class="mb-2 flex flex-wrap items-center gap-2">
				<span class="font-semibold {r.ok ? 'text-emerald-300' : 'text-red-300'}">{r.name}</span>
				<span class="font-mono text-xs text-slate-400">{r.ms}ms</span>
				{#if r.summary}<span class="text-slate-400">— {r.summary}</span>{/if}
			</div>
			<h4 class="mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">Params</h4>
			<pre
				class="overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{fmtJson(
					r.params
				)}</pre>
			{#if r.resultSnapshot !== undefined}
				<h4 class="mt-3 mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
					Result Snapshot
				</h4>
				<pre
					class="overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{fmtJson(
						r.resultSnapshot
					)}</pre>
			{/if}
			{#if r.error}
				<h4 class="mt-3 mb-1.5 text-xs font-semibold tracking-wider text-red-400 uppercase">
					Error
				</h4>
				<pre class="font-mono text-xs text-red-300">{r.error}</pre>
			{/if}
		</div>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'plan'}
		{@const r = event.ev.ev}
		<div class="mb-2">
			<span class="font-semibold text-sky-300">Intent:</span>
			<span class="ml-1 text-slate-200">{r.intent}</span>
		</div>
		<h4 class="mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
			Initial Fetches ({r.initialFetches.length})
		</h4>
		<ul class="mb-3 list-inside list-disc text-slate-200">
			{#each r.initialFetches as f}<li>{f}</li>{/each}
		</ul>
		<h4 class="mb-1.5 text-xs font-semibold tracking-wider text-slate-400 uppercase">
			RC Expansions ({r.rcExpansion.length})
		</h4>
		<ul class="list-inside list-disc text-slate-200">
			{#each r.rcExpansion as x}<li>{x}</li>{/each}
		</ul>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'budget'}
		{@const r = event.ev.ev}
		<div class="flex flex-wrap gap-6 text-base">
			<div>
				<span class="text-slate-400">Before:</span>
				<span class="font-bold text-white">{r.before}</span>
			</div>
			<div>
				<span class="text-slate-400">After:</span>
				<span class="font-bold text-emerald-300">{r.after}</span>
			</div>
			<div>
				<span class="text-slate-400">Dropped:</span>
				<span class="font-bold text-orange-300">{r.dropped}</span>
			</div>
		</div>
	{:else if event.ev.kind === 'trace' && event.ev.ev.type === 'warm'}
		{@const r = event.ev.ev}
		<p class="leading-relaxed text-slate-200">
			Background warm: <span class="font-semibold text-slate-100">{r.reference}</span> in
			<span class="font-semibold text-slate-100">{r.language}</span>
		</p>
	{:else if event.ev.kind === 'status'}
		<p class="leading-relaxed text-slate-200">{event.ev.text}</p>
	{:else}
		<pre
			class="overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{fmtJson(
				event.ev
			)}</pre>
	{/if}
</div>
