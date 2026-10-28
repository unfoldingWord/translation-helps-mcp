<script lang="ts">
	import { onMount } from 'svelte';
	import Callout from '$lib/components/Callout.svelte';
	import CopyPill from '$lib/components/CopyPill.svelte';
	import ToolRunner from '$lib/try/ToolRunner.svelte';
	import GuidedWalk from '$lib/try/GuidedWalk.svelte';
	import { endpoint } from '$lib/endpoint';
	import { connect } from '$lib/mcp/session';
	import type { ToolInfo } from '$lib/mcp/client';
	import { decodeTryState, encodeTryState, type TryState } from '$lib/try/hashState';
	import { SITE } from '$lib/site';

	type Tab = TryState['tab'];
	const TABS: [Tab, string][] = [
		['guided', 'Guided walk'],
		['obs', 'OBS'],
		['tools', 'Tools']
	];

	let status = $state<'connecting' | 'connected' | 'failed'>('connecting');
	let tools = $state<ToolInfo[]>([]);
	let tryState = $state<TryState>({ tab: 'guided' });
	/** The MCP address of this site. Set in the browser, where the page's own origin is known. */
	let url = $state('');

	/** Keep the page state in the address, so a link reopens the same view. */
	function save(s: TryState) {
		tryState = s;
		history.replaceState(
			history.state,
			'',
			location.pathname + location.search + encodeTryState(s)
		);
	}

	/** Read the state from the address. Tool names are only known once the server has answered. */
	function readHash(names: string[]): TryState {
		return location.hash ? decodeTryState(location.hash, names) : { tab: 'guided' };
	}

	async function start() {
		status = 'connecting';
		try {
			tools = await connect(url);
			tryState = readHash(tools.map((t) => t.name));
			status = 'connected';
		} catch {
			status = 'failed';
		}
	}

	onMount(() => {
		url = endpoint();
		tryState = readHash([]);
		void start();
	});
</script>

<svelte:head>
	<title>Try · {SITE.name}</title>
	<meta
		name="description"
		content="Call the live Translation Helps server from your browser: pick a tool, run it, and see the exact answer."
	/>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-10">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div class="min-w-0">
			<h1 class="text-ink text-3xl font-bold tracking-tight">Try it</h1>
			<p class="text-ink-2 mt-2 max-w-2xl text-sm">
				Everything here calls the live server, the same way an assistant does. No key needed. The
				server allows a limited number of calls per minute.
			</p>
		</div>
		<div class="flex max-w-full min-w-0 flex-col items-start gap-1 sm:items-end">
			{#if url}<CopyPill value={url} label="Copy the server URL" />{/if}
			<p class="text-ink-2 text-xs" aria-live="polite">
				{#if status === 'connected'}<span class="text-accent-2">●</span> Connected · {tools.length} tools
				{:else if status === 'connecting'}Connecting…
				{:else}<span class="text-danger">●</span> Not connected{/if}
			</p>
		</div>
	</div>

	<div
		class="border-line mt-6 flex gap-1 overflow-x-auto border-b"
		role="tablist"
		aria-label="Ways to try"
	>
		{#each TABS as [id, label]}
			<button
				type="button"
				role="tab"
				id="tab-{id}"
				aria-selected={tryState.tab === id}
				aria-controls="panel-try"
				onclick={() => save({ tab: id })}
				class="shrink-0 border-b-2 px-3 py-2 text-sm {tryState.tab === id
					? 'border-accent text-ink'
					: 'text-ink-2 hover:text-ink border-transparent'}">{label}</button
			>
		{/each}
	</div>

	<div class="mt-6" id="panel-try" role="tabpanel" aria-labelledby="tab-{tryState.tab}">
		{#if status === 'failed'}
			<Callout tone="warn">
				Couldn't connect to the server at {url}. Check your connection and
				<button type="button" class="underline" onclick={start}>try again</button>.
			</Callout>
		{:else if status === 'connecting'}
			<p class="text-ink-2 text-sm">Connecting to the server…</p>
		{:else if tryState.tab === 'tools'}
			<p class="text-ink-2 mb-5 max-w-2xl text-sm">
				Call any tool with your own arguments. The form comes from the tool's schema on the live
				server.
			</p>
			<ToolRunner {tools} initial={tryState} onstate={save} />
		{:else if tryState.tab === 'obs'}
			<p class="text-ink-2 text-sm">
				Coming in the next step: a short walk through an Open Bible Story.
			</p>
		{:else}
			<p class="text-ink-2 mb-5 max-w-2xl text-sm">
				One passage and all its helps, step by step, in the order an assistant asks the server for
				them.
			</p>
			<GuidedWalk initial={tryState} onstate={save} />
		{/if}
	</div>
</div>
