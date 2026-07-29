<script lang="ts">
	import { rowClass, rowLabel, matchesFilter } from './traceTypes.js';
	import type { TimedEvent, FilterKind } from './traceTypes.js';

	export let events: TimedEvent[] = [];
	export let selectedIdx: number | null = null;
	export let filter: FilterKind = 'all';
	export let running = false;
	export let statusText = '';
	/** Offset to show relative timestamps. When set, shows +Xms instead of absolute. */
	export let t0 = 0;
	/** Called when a row is clicked. Index is into the original (unfiltered) events array. */
	export let onSelect: (idx: number) => void = () => {};
</script>

<div class="flex flex-col gap-1.5">
	{#each events as te, i}
		{#if matchesFilter(te, filter)}
			<button
				on:click={() => onSelect(i)}
				class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition hover:brightness-110 {rowClass(
					te.ev
				)} {selectedIdx === i ? 'ring-2 ring-sky-500/60' : ''}"
			>
				<span class="mt-0.5 shrink-0 font-mono text-xs text-slate-400">
					{t0 > 0 ? `+${te.t - t0}` : te.t}ms
				</span>
				<span class="min-w-0 flex-1 leading-relaxed text-slate-100">{rowLabel(te)}</span>
			</button>
		{/if}
	{/each}
	{#if running}
		<div class="flex items-center gap-2 px-3 py-2 text-sm text-slate-400">
			<span class="animate-pulse text-sky-400">●</span>
			{statusText || 'Working…'}
		</div>
	{/if}
</div>
