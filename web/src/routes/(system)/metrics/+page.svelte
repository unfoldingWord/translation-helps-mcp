<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { RotateCw } from 'lucide-svelte';
	import { SITE } from '$lib/site';

	type MetricRow = {
		tool: string;
		calls: number;
		p50Ms: number;
		p95Ms: number;
		errorRate: number;
		cacheHitRate: number;
	};

	let metrics = $state<MetricRow[]>([]);
	let loading = $state(true);
	let error = $state('');
	let note = $state('');
	let updated = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch(`${base}/api/metrics`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { metrics?: MetricRow[]; note?: string; error?: string };
			metrics = data.metrics ?? [];
			note = data.note ?? '';
			error = data.error ?? '';
			updated = new Date().toLocaleTimeString();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const totalCalls = $derived(metrics.reduce((a, m) => a + m.calls, 0));
	const mean = (pick: (m: MetricRow) => number) =>
		metrics.length ? metrics.reduce((a, m) => a + pick(m), 0) / metrics.length : 0;
	const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

	const cards = $derived([
		{ label: 'Calls, last 24 hours', value: totalCalls.toLocaleString() },
		{ label: 'Median time (P50)', value: `${Math.round(mean((m) => m.p50Ms))} ms` },
		{ label: 'Served from cache', value: pct(mean((m) => m.cacheHitRate)) },
		{ label: 'Calls with an error', value: pct(mean((m) => m.errorRate)) }
	]);
</script>

<svelte:head>
	<title>Metrics · {SITE.name}</title>
	<meta
		name="description"
		content="How many calls each tool got in the last 24 hours, and how fast it answered."
	/>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-14">
	<p class="text-accent-2 font-mono text-xs tracking-wide uppercase">System</p>
	<h1 class="text-ink mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Metrics</h1>
	<p class="text-ink-2 mt-3 max-w-2xl">
		Calls to each tool in the last 24 hours, from Cloudflare Analytics Engine. The last three cards
		are the mean of the per-tool figures below, not weighted by calls.
	</p>

	<div class="mt-8 flex flex-wrap items-center justify-between gap-3">
		<p class="text-ink-2 text-sm" aria-live="polite">{updated ? `Updated ${updated}` : ''}</p>
		<button
			type="button"
			onclick={load}
			disabled={loading}
			class="border-line-strong bg-surface text-ink hover:border-accent inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
		>
			<RotateCw size={15} class={loading ? 'animate-spin' : ''} aria-hidden="true" />
			Refresh
		</button>
	</div>

	{#if error}
		<p
			class="border-line-strong bg-surface text-danger mt-4 rounded-lg border p-4 text-sm"
			role="alert"
		>
			Failed to load the metrics: {error}
		</p>
	{/if}

	{#if loading && !metrics.length}
		<p class="text-ink-2 mt-6 text-sm">Loading…</p>
	{:else if metrics.length}
		<dl class="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
			{#each cards as card (card.label)}
				<div class="border-line bg-surface rounded-lg border p-4">
					<dd class="text-ink text-2xl font-semibold tracking-tight">{card.value}</dd>
					<dt class="text-ink-2 mt-1 text-xs">{card.label}</dt>
				</div>
			{/each}
		</dl>

		<div class="border-line bg-surface mt-6 overflow-x-auto rounded-lg border">
			<table class="w-full min-w-[34rem] border-collapse text-left text-sm whitespace-nowrap">
				<thead>
					<tr class="border-line text-ink-2 border-b text-xs">
						<th class="px-4 py-3 font-normal">Tool</th>
						<th class="px-4 py-3 text-right font-normal">Calls</th>
						<th class="px-4 py-3 text-right font-normal">P50</th>
						<th class="px-4 py-3 text-right font-normal">P95</th>
						<th class="px-4 py-3 text-right font-normal">From cache</th>
						<th class="px-4 py-3 text-right font-normal">Errors</th>
					</tr>
				</thead>
				<tbody>
					{#each metrics as row (row.tool)}
						<tr class="border-line border-b last:border-0">
							<td class="text-ink px-4 py-2.5 font-mono text-[13px]">{row.tool}</td>
							<td class="text-ink px-4 py-2.5 text-right">{row.calls.toLocaleString()}</td>
							<td class="text-ink-2 px-4 py-2.5 text-right">{row.p50Ms} ms</td>
							<td class="text-ink-2 px-4 py-2.5 text-right">{row.p95Ms} ms</td>
							<td class="text-ink-2 px-4 py-2.5 text-right">{pct(row.cacheHitRate, 0)}</td>
							<td
								class="px-4 py-2.5 text-right {row.errorRate > 0.05 ? 'text-danger' : 'text-ink-2'}"
							>
								{pct(row.errorRate)}{row.errorRate > 0.05 ? ' (high)' : ''}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if !error}
		<div class="border-line bg-surface mt-6 rounded-lg border p-6">
			<p class="text-ink">No metrics yet.</p>
			<p class="text-ink-2 mt-1 text-sm">
				{note
					? 'This server is not set up to read its metrics.'
					: 'Nothing was recorded in the last 24 hours.'}
				Make a few calls on <a class="text-accent hover:underline" href="{base}/try">Try</a> and refresh.
			</p>
		</div>
	{/if}
</div>
