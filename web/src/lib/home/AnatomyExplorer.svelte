<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { ArrowRight, ExternalLink } from 'lucide-svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { endpoint } from '$lib/endpoint';
	import { run } from '$lib/mcp/session';
	import { encodeTryState } from '$lib/try/hashState';
	import { revealOnNarrow } from '$lib/reveal';
	import { RESOURCES } from '$lib/resources';
	import {
		ANATOMY_PARTS,
		PASSAGE,
		excerptFrom,
		type AnatomyPart,
		type HomeSnapshot
	} from './anatomy';
	import snapshotJson from './snapshot.json';

	const saved = snapshotJson as HomeSnapshot;
	let selected = $state<AnatomyPart>(ANATOMY_PARTS[1]);
	let live = $state<Partial<Record<AnatomyPart['id'], string>>>({});
	let mounted = $state(false);
	let card = $state<HTMLElement>();

	const excerpt = $derived(live[selected.id] ?? saved[selected.id]);
	const isLive = $derived(selected.id in live);
	const sources = $derived(RESOURCES.filter((r) => selected.resources.includes(r.id)));
	const callText = $derived(`${selected.call.tool} ${JSON.stringify(selected.call.args)}`);
	const walkHref = $derived(`${base}/try${encodeTryState(selected.tryState)}`);
	const toolsHref = $derived(
		`${base}/try${encodeTryState({ tab: 'tools', tool: selected.call.tool, args: selected.call.args })}`
	);

	/**
	 * Ask the live server for a part. The page shows the saved answers and opens no MCP
	 * session until someone chooses a part. A failure keeps the saved excerpt.
	 */
	const asking = new Set<AnatomyPart['id']>();
	async function load(p: AnatomyPart) {
		if (live[p.id] || asking.has(p.id)) return;
		asking.add(p.id);
		try {
			const { result, outcome } = await run(endpoint(), p.call.tool, p.call.args);
			const text = outcome.kind === 'ok' ? excerptFrom(p.id, result?.structured) : '';
			if (text) live = { ...live, [p.id]: text };
		} finally {
			asking.delete(p.id);
		}
	}

	function choose(p: AnatomyPart) {
		selected = p;
		void load(p);
		revealOnNarrow(card);
	}

	onMount(() => {
		mounted = true;
	});
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
	<ol
		class="grid grid-cols-2 content-start gap-2 self-start sm:grid-cols-3 lg:grid-cols-1"
		aria-label="Parts of the passage"
	>
		{#each ANATOMY_PARTS as p, i (p.id)}
			{@const on = selected.id === p.id}
			<li class={i === 0 ? 'col-span-2 sm:col-span-1' : ''}>
				<button
					type="button"
					onclick={() => choose(p)}
					aria-pressed={on}
					class="group flex h-full w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors {on
						? 'border-accent bg-surface'
						: 'border-line hover:border-line-strong hover:bg-surface'}"
				>
					<span
						class="mt-0.5 font-mono text-xs {on ? 'text-accent-2' : 'text-ink-2'}"
						aria-hidden="true">{String(i + 1).padStart(2, '0')}</span
					>
					<span class="min-w-0">
						<span class="text-ink block text-sm font-semibold">{p.title}</span>
						<!-- Break a long tool name only after an underscore. -->
						<span class="text-ink-2 block font-mono text-[11px]"
							>{#each p.call.tool.split('_') as w, j (j)}{j ? '_' : ''}<wbr />{w}{/each}</span
						>
					</span>
				</button>
			</li>
		{/each}
	</ol>

	<article
		bind:this={card}
		class="border-line bg-surface min-w-0 scroll-mt-20 rounded-xl border p-5 sm:p-7"
	>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<h3 class="text-ink text-xl font-semibold tracking-tight sm:text-2xl">{selected.title}</h3>
				<p class="text-ink-2 mt-1 text-sm">{selected.summary}</p>
			</div>
			<ul class="flex flex-wrap gap-1.5">
				{#each sources as r (r.id)}
					<li
						class="border-line-strong text-ink rounded border px-2 py-0.5 font-mono text-xs"
						title={r.name}
					>
						{r.short}
					</li>
				{/each}
			</ul>
		</div>

		<div class="bg-bg mt-5 rounded-lg p-4 sm:p-5">
			<p class="mb-3 flex items-center gap-2 font-mono text-[11px]">
				<span
					class="h-1.5 w-1.5 rounded-full {isLive ? 'bg-accent' : 'bg-line-strong'}"
					aria-hidden="true"
				></span>
				<span class="text-ink-2"
					>{isLive ? 'Live from the server' : `Saved answer · ${saved.capturedAt}`} · {PASSAGE.reference}</span
				>
			</p>
			{#if mounted}
				<Markdown source={excerpt} />
			{:else}
				<pre class="text-ink-2 font-sans text-sm whitespace-pre-wrap">{excerpt}</pre>
			{/if}
		</div>

		<dl class="mt-5 text-sm">
			<dt class="text-ink-2 text-xs">The assistant calls</dt>
			<dd class="text-ink mt-1 font-mono text-[13px] break-all">{callText}</dd>
		</dl>

		<div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
			<a
				href={walkHref}
				class="text-accent inline-flex items-center gap-1 font-medium hover:underline"
				>See it in the guided walk <ArrowRight size={14} /></a
			>
			<a href={toolsHref} class="text-ink-2 hover:text-ink inline-flex items-center gap-1"
				>Run this call</a
			>
			<span class="text-ink-2 text-xs sm:ml-auto">
				Source:
				{#each sources as r, i (r.id)}
					{#if i > 0},
					{/if}<a class="hover:text-ink underline underline-offset-2" href={r.door43}
						>{r.short} on Door43<ExternalLink size={11} class="ml-0.5 inline" /></a
					>
				{/each}
			</span>
		</div>
	</article>
</div>
