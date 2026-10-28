<script lang="ts">
	import { onMount } from 'svelte';
	import { CircleCheck, CircleAlert, CircleX, Circle, LoaderCircle, RotateCw } from 'lucide-svelte';
	import { endpoint } from '$lib/endpoint';
	import { McpHttpClient } from '$lib/mcp/client';
	import { run } from '$lib/mcp/session';
	import { REST_HEALTH_URL, STATUS_CHECKS, runCheck, type CheckResult } from '$lib/status';
	import { SITE } from '$lib/site';

	/** `waiting` and `running` are states of the page; the rest come from the check. */
	type Row = { state: 'waiting' | 'running' | CheckResult['state']; ms: number; note: string };

	const blank = (): Row[] => STATUS_CHECKS.map(() => ({ state: 'waiting', ms: 0, note: '' }));
	let rows = $state<Row[]>(blank());
	let running = $state(false);
	let finished = $state(false);

	const WORDS: Record<Row['state'], string> = {
		waiting: 'Waiting',
		running: 'Checking',
		ok: 'OK',
		'not-available': 'Not available',
		failed: 'Failed'
	};

	const count = (state: Row['state']) => rows.filter((r) => r.state === state).length;
	const summary = $derived(
		count('failed')
			? `${count('failed')} failed, ${count('ok')} OK`
			: count('not-available')
				? `${count('ok')} OK, ${count('not-available')} not available`
				: `All ${rows.length} OK`
	);

	/** One after another: the server allows 90 requests a minute from one address. */
	async function runAll() {
		if (running) return;
		running = true;
		finished = false;
		rows = blank();
		const where = endpoint();
		const io = {
			now: () => performance.now(),
			initialize: () => new McpHttpClient(where).initialize(),
			fetchHealth: (signal: AbortSignal) => fetch(REST_HEALTH_URL, { cache: 'no-store', signal }),
			callTool: async (tool: string, args: Record<string, unknown>) =>
				(await run(where, tool, args)).outcome
		};
		try {
			for (const [i, check] of STATUS_CHECKS.entries()) {
				rows[i].state = 'running';
				const result = await runCheck(check, io);
				rows[i] = { ...result, ms: Math.round(result.ms) };
			}
			finished = true;
		} finally {
			running = false;
		}
	}

	onMount(runAll);

	const tone = (state: Row['state']) =>
		state === 'ok'
			? 'text-accent'
			: state === 'failed'
				? 'text-danger'
				: state === 'not-available'
					? 'text-accent-2'
					: 'text-ink-2';
	const done = (state: Row['state']) => state !== 'waiting' && state !== 'running';
</script>

<svelte:head>
	<title>Status · {SITE.name}</title>
	<meta
		name="description"
		content="Whether the server, the REST API and every tool answer right now."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-14">
	<p class="text-accent-2 font-mono text-xs tracking-wide uppercase">System</p>
	<h1 class="text-ink mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Status</h1>
	<p class="text-ink-2 mt-3 max-w-2xl">
		Each check calls the live server, one after another, with the same example the Tools page shows.
		“Not available” means the server answered and has nothing for that example. It is not a failure.
	</p>

	<div class="mt-8 flex flex-wrap items-center justify-between gap-3">
		<p class="text-ink text-sm" aria-live="polite">
			{#if finished}{summary}{:else if running}Checking…{/if}
		</p>
		<button
			type="button"
			onclick={runAll}
			disabled={running}
			class="border-line-strong bg-surface text-ink hover:border-accent inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm disabled:opacity-60"
		>
			<RotateCw size={15} class={running ? 'animate-spin' : ''} aria-hidden="true" />
			Run again
		</button>
	</div>

	<ul class="border-line bg-surface mt-4 rounded-lg border">
		{#each STATUS_CHECKS as check, i (check.id)}
			{@const row = rows[i]}
			<li class="border-line border-b px-4 py-3 last:border-0">
				<div class="flex items-center justify-between gap-3">
					<span class="text-ink min-w-0 font-mono text-[13px] break-all">{check.label}</span>
					<span class="flex shrink-0 items-center gap-3 text-sm">
						<span class="flex items-center gap-1.5 {tone(row.state)}">
							{#if row.state === 'ok'}
								<CircleCheck size={16} aria-hidden="true" />
							{:else if row.state === 'failed'}
								<CircleX size={16} aria-hidden="true" />
							{:else if row.state === 'not-available'}
								<CircleAlert size={16} aria-hidden="true" />
							{:else if row.state === 'running'}
								<LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
							{:else}
								<Circle size={16} aria-hidden="true" />
							{/if}
							{WORDS[row.state]}
						</span>
						<span class="text-ink-2 w-[4.5rem] text-right font-mono text-xs whitespace-nowrap">
							{#if done(row.state)}{row.ms} ms{/if}
						</span>
					</span>
				</div>
				{#if row.note}
					<p class="text-ink-2 mt-1.5 text-sm break-words">{row.note}</p>
				{/if}
			</li>
		{/each}
	</ul>

	<p class="text-ink-2 mt-4 text-xs">
		The REST API check reads <span class="font-mono break-all">{REST_HEALTH_URL}</span>. The checks
		count toward the rate limit of 90 requests a minute.
	</p>
</div>
