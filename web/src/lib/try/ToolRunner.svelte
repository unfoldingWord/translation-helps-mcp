<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import ResultViewer from '$lib/components/ResultViewer.svelte';
	import ToolForm from '$lib/components/ToolForm.svelte';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { endpoint } from '$lib/endpoint';
	import { run, type RunResult } from '$lib/mcp/session';
	import type { ToolInfo } from '$lib/mcp/client';
	import { argsFromValues, fieldsFromSchema } from './fields';
	import { visiblePresets, type Preset } from './presets';
	import { curlFor, jsonRpcFor, mcpConfigFor } from './copyAs';
	import type { TryState } from './hashState';
	import { revealOnNarrow } from '$lib/reveal';

	let {
		tools,
		initial,
		onstate
	}: { tools: ToolInfo[]; initial: TryState; onstate: (s: TryState) => void } = $props();

	// Read once: the runner keeps its own state and reports it through onstate.
	const init = untrack(() => ({
		tool: initial.tool,
		args: initial.args,
		names: tools.map((t) => t.name)
	}));
	const fallback = init.names.includes('get_passage') ? 'get_passage' : (init.names[0] ?? '');
	const start = init.tool && init.names.includes(init.tool) ? init.tool : fallback;
	let selected = $state(start);
	let values = $state<Record<string, unknown>>({ ...(init.args ?? {}) });
	let pending = $state(false);
	let answer = $state<RunResult | null>(null);
	/** What the answer on screen was asked, so Try again repeats that call and not the edited form. */
	let asked = $state<{ tool: string; args: Record<string, unknown> } | null>(null);

	const tool = $derived(tools.find((t) => t.name === selected));
	const fields = $derived(tool ? fieldsFromSchema(tool.inputSchema) : []);
	const presets = $derived(visiblePresets(tools).filter((p) => p.tool === selected));
	const formArgs = $derived(argsFromValues(fields, values));

	// A call can finish after the tab changes; a closed runner must not report state.
	let alive = true;
	onDestroy(() => (alive = false));
	// Answers can arrive out of order; only the latest call may show.
	let latest = 0;

	function choose(name: string) {
		selected = name;
		values = {};
		answer = null;
		asked = null;
		latest++;
		pending = false;
		onstate({ tab: 'tools', tool: name });
	}

	async function exec(call: { tool: string; args: Record<string, unknown> }) {
		const mine = ++latest;
		asked = call;
		pending = true;
		const next = await run(endpoint(), call.tool, call.args);
		if (!alive || mine !== latest) return;
		answer = next;
		pending = false;
		onstate({ tab: 'tools', tool: call.tool, args: call.args });
	}

	let resultEl = $state<HTMLElement>();

	/** Run because the person asked: on a phone, scroll to the answer. */
	async function runAndReveal() {
		void exec({ tool: selected, args: formArgs });
		// Let the form and result settle first (an example can switch the tool).
		await tick();
		revealOnNarrow(resultEl);
	}

	function usePreset(p: Preset) {
		selected = p.tool;
		values = { ...p.args };
		answer = null;
		// The form updates on the next tick; run with the preset's own arguments.
		void exec({ tool: p.tool, args: p.args });
		void tick().then(() => revealOnNarrow(resultEl));
	}

	// A shared link with arguments runs right away.
	if (init.tool && init.names.includes(init.tool) && init.args) {
		void exec({ tool: start, args: init.args });
	}

	const copyTabs = $derived([
		{ label: 'curl', code: curlFor(endpoint(), selected, formArgs) },
		{ label: 'JSON-RPC', code: jsonRpcFor(selected, formArgs) },
		{ label: 'MCP config', code: mcpConfigFor(endpoint()) }
	]);

	/** First sentence of the description, then the rest behind a button: some run to a paragraph. */
	const about = $derived.by(() => {
		const text = (tool?.description ?? '').trim();
		const cut = text.search(/[.!?](\s|$)/);
		if (cut === -1 || cut + 1 >= text.length) return { head: text, rest: '' };
		return { head: text.slice(0, cut + 1), rest: text.slice(cut + 1).trim() };
	});
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,20rem)_minmax(0,1fr)]">
	<nav aria-label="Tools">
		<div class="lg:hidden">
			<label for="t-tool" class="text-ink-2 text-xs">Tool</label>
			<select
				id="t-tool"
				class="border-line-strong bg-bg text-ink w-full rounded-md border px-2.5 py-1.5 font-mono text-[13px]"
				value={selected}
				onchange={(e) => choose(e.currentTarget.value)}
			>
				{#each tools as t (t.name)}<option value={t.name}>{t.name}</option>{/each}
			</select>
		</div>
		<p class="text-ink-2 mb-2 hidden text-xs lg:block">Tools</p>
		<ul class="hidden space-y-0.5 lg:block">
			{#each tools as t (t.name)}
				<li>
					<button
						type="button"
						onclick={() => choose(t.name)}
						aria-current={t.name === selected ? 'true' : undefined}
						class="w-full truncate rounded px-2 py-1 text-left font-mono text-[13px] {t.name ===
						selected
							? 'bg-surface text-ink'
							: 'text-ink-2 hover:text-ink'}">{t.name}</button
					>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="min-w-0 space-y-5">
		{#if tool}
			<div>
				<h2 class="text-ink font-mono text-sm">{tool.name}</h2>
				<p class="text-ink-2 mt-1 text-xs">{about.head}</p>
				{#if about.rest}
					<details class="mt-1">
						<summary class="text-ink-2 hover:text-ink cursor-pointer text-xs">More</summary>
						<p class="text-ink-2 mt-1 text-xs whitespace-pre-line">{about.rest}</p>
					</details>
				{/if}
			</div>
		{/if}
		{#if presets.length}
			<div>
				<p class="text-ink-2 mb-2 text-xs">Examples</p>
				<div class="flex flex-wrap gap-1.5">
					{#each presets as p (p.label)}
						<button
							type="button"
							class="border-line-strong text-ink-2 hover:text-ink rounded-full border px-2.5 py-1 text-xs"
							onclick={() => usePreset(p)}>{p.label}</button
						>
					{/each}
				</div>
			</div>
		{/if}
		{#if tool}
			{#key selected}
				<ToolForm {fields} bind:values onrun={runAndReveal} />
			{/key}
		{/if}
	</div>

	<div class="min-w-0 space-y-4">
		<div class="scroll-mt-20" bind:this={resultEl} data-result>
			<ResultViewer
				tool={asked?.tool ?? selected}
				result={answer?.result ?? null}
				outcome={answer?.outcome ?? null}
				{pending}
				onretry={() => asked && exec(asked)}
			/>
		</div>
		<div>
			<p class="text-ink-2 mb-2 text-xs">Copy as</p>
			<CodeTabs tabs={copyTabs} />
		</div>
	</div>
</div>
