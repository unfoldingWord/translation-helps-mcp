<script lang="ts">
	import { onMount } from 'svelte';
	import { withBase } from '$lib/paths.js';

	type MetricRow = {
		tool: string;
		calls: number;
		p50Ms: number;
		p95Ms: number;
		errorRate: number;
		cacheHitRate: number;
	};

	let metrics: MetricRow[] = [];
	let loading = true;
	let error = '';
	let lastRefreshed = '';

	async function loadMetrics() {
		loading = true;
		error = '';
		try {
			const res = await fetch(withBase('/api/metrics'));
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { metrics?: MetricRow[] };
			metrics = data.metrics ?? [];
			lastRefreshed = new Date().toLocaleTimeString();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(loadMetrics);
</script>

<svelte:head>
	<title>Metrics — Translation Helps MCP</title>
</svelte:head>

<div class="page-shell">
	<div class="mx-auto max-w-6xl px-4 py-10">
		<div class="mb-8 flex items-center justify-between">
			<div>
				<p class="mb-2 text-xs font-semibold tracking-[0.14em] text-sky-400/90 uppercase">
					Observability
				</p>
				<h1 class="mb-1 text-3xl font-semibold tracking-tight text-slate-100">
					Performance Metrics
				</h1>
				<p class="text-sm text-slate-400">
					Powered by Cloudflare Analytics Engine · {lastRefreshed ? `Updated ${lastRefreshed}` : ''}
				</p>
			</div>
			<button onclick={loadMetrics} disabled={loading} class="ui-btn px-4 py-2">
				{loading ? '…' : '↻'} Refresh
			</button>
		</div>

		{#if error}
			<div
				class="mb-6 rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-300"
			>
				⚠ {error} — Metrics require a deployed Cloudflare Worker with Analytics Engine configured.
			</div>
		{/if}

		{#if loading}
			<div class="mb-8 grid grid-cols-4 gap-4">
				{#each Array(4) as _}
					<div class="h-24 animate-pulse rounded-xl bg-slate-900 p-5"></div>
				{/each}
			</div>
		{:else if metrics.length > 0}
			{@const totalCalls = metrics.reduce((a, m) => a + m.calls, 0)}
			{@const avgP50 = Math.round(metrics.reduce((a, m) => a + m.p50Ms, 0) / metrics.length)}
			{@const avgErrorRate = (
				(metrics.reduce((a, m) => a + m.errorRate, 0) / metrics.length) *
				100
			).toFixed(1)}
			{@const avgCacheHit = (
				(metrics.reduce((a, m) => a + m.cacheHitRate, 0) / metrics.length) *
				100
			).toFixed(1)}
			<!-- Summary cards -->
			<div class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
				<div class="ui-card p-5">
					<div class="text-3xl font-bold text-slate-100">{totalCalls.toLocaleString()}</div>
					<div class="mt-1 text-sm text-slate-400">Total Calls</div>
				</div>
				<div class="ui-card p-5">
					<div class="text-3xl font-bold text-sky-300">{avgP50}ms</div>
					<div class="mt-1 text-sm text-slate-400">Avg P50 Latency</div>
				</div>
				<div class="ui-card p-5">
					<div class="text-3xl font-bold text-emerald-300">{avgCacheHit}%</div>
					<div class="mt-1 text-sm text-slate-400">Avg Cache Hit Rate</div>
				</div>
				<div class="ui-card p-5">
					<div
						class="text-3xl font-bold {Number(avgErrorRate) > 5
							? 'text-red-400'
							: 'text-green-300'}"
					>
						{avgErrorRate}%
					</div>
					<div class="mt-1 text-sm text-slate-400">Avg Error Rate</div>
				</div>
			</div>

			<!-- Per-tool table -->
			<div class="ui-card overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-800 text-xs tracking-wider text-slate-400 uppercase">
							<th class="p-4 text-left">Tool</th>
							<th class="p-4 text-right">Calls</th>
							<th class="p-4 text-right">P50</th>
							<th class="p-4 text-right">P95</th>
							<th class="p-4 text-right">Cache Hit</th>
							<th class="p-4 text-right">Error Rate</th>
						</tr>
					</thead>
					<tbody>
						{#each metrics as row}
							<tr class="border-t border-slate-800 transition-colors hover:bg-slate-800/50">
								<td class="p-4 font-mono text-xs text-sky-300">{row.tool}</td>
								<td class="p-4 text-right text-slate-100">{row.calls.toLocaleString()}</td>
								<td class="p-4 text-right text-slate-300">{row.p50Ms}ms</td>
								<td class="p-4 text-right text-slate-300">{row.p95Ms}ms</td>
								<td
									class="p-4 text-right {row.cacheHitRate > 0.7
										? 'text-green-400'
										: 'text-yellow-400'}">{(row.cacheHitRate * 100).toFixed(0)}%</td
								>
								<td
									class="p-4 text-right {row.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}"
									>{(row.errorRate * 100).toFixed(1)}%</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="py-16 text-center text-slate-500">
				<div class="mb-4 text-4xl">📊</div>
				<p class="mb-2 text-lg">No metrics data yet</p>
				<p class="text-sm">
					Call some tools via the <a href={withBase('/playground')} class="text-sky-400 underline"
						>Playground</a
					> and refresh.
				</p>
			</div>
		{/if}
	</div>
</div>
