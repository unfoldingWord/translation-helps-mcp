<script lang="ts">
	import { onMount } from 'svelte';

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
			const res = await fetch('/api/metrics');
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
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

<div class="mx-auto max-w-6xl px-4 py-12">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="mb-1 text-3xl font-bold text-white">Performance Metrics</h1>
			<p class="text-sm text-gray-400">
				Powered by Cloudflare Analytics Engine · {lastRefreshed ? `Updated ${lastRefreshed}` : ''}
			</p>
		</div>
		<button
			on:click={loadMetrics}
			disabled={loading}
			class="rounded-lg bg-gray-800 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-700 disabled:opacity-50"
		>
			{loading ? '⏳' : '↻'} Refresh
		</button>
	</div>

	{#if error}
		<div class="mb-6 rounded-lg border border-yellow-800 bg-yellow-950 p-4 text-sm text-yellow-300">
			⚠ {error} — Metrics require a deployed Cloudflare Worker with Analytics Engine configured.
		</div>
	{/if}

	{#if loading}
		<div class="mb-8 grid grid-cols-4 gap-4">
			{#each Array(4) as _}
				<div class="h-24 animate-pulse rounded-xl bg-gray-900 p-5"></div>
			{/each}
		</div>
	{:else if metrics.length > 0}
		<!-- Summary cards -->
		<div class="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
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

			<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div class="text-3xl font-bold text-white">{totalCalls.toLocaleString()}</div>
				<div class="mt-1 text-sm text-gray-400">Total Calls</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div class="text-3xl font-bold text-indigo-300">{avgP50}ms</div>
				<div class="mt-1 text-sm text-gray-400">Avg P50 Latency</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div class="text-3xl font-bold text-green-300">{avgCacheHit}%</div>
				<div class="mt-1 text-sm text-gray-400">Avg Cache Hit Rate</div>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
				<div
					class="text-3xl font-bold {Number(avgErrorRate) > 5 ? 'text-red-400' : 'text-green-300'}"
				>
					{avgErrorRate}%
				</div>
				<div class="mt-1 text-sm text-gray-400">Avg Error Rate</div>
			</div>
		</div>

		<!-- Per-tool table -->
		<div class="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-gray-800 text-xs tracking-wider text-gray-400 uppercase">
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
						<tr class="border-t border-gray-800 transition-colors hover:bg-gray-800/50">
							<td class="p-4 font-mono text-xs text-indigo-300">{row.tool}</td>
							<td class="p-4 text-right text-white">{row.calls.toLocaleString()}</td>
							<td class="p-4 text-right text-gray-300">{row.p50Ms}ms</td>
							<td class="p-4 text-right text-gray-300">{row.p95Ms}ms</td>
							<td
								class="p-4 text-right {row.cacheHitRate > 0.7
									? 'text-green-400'
									: 'text-yellow-400'}">{(row.cacheHitRate * 100).toFixed(0)}%</td
							>
							<td class="p-4 text-right {row.errorRate > 0.05 ? 'text-red-400' : 'text-green-400'}"
								>{(row.errorRate * 100).toFixed(1)}%</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="py-16 text-center text-gray-500">
			<div class="mb-4 text-4xl">📊</div>
			<p class="mb-2 text-lg">No metrics data yet</p>
			<p class="text-sm">
				Call some tools via the <a href="/playground" class="text-indigo-400 underline"
					>Playground</a
				> and refresh.
			</p>
		</div>
	{/if}
</div>
