<script lang="ts">
	import { base } from '$app/paths';
	import { ArrowRight } from 'lucide-svelte';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { TOOL_GROUPS, type ToolDoc } from '$lib/catalog';
	import { encodeTryState } from '$lib/try/hashState';
	import { SITE } from '$lib/site';

	let { data } = $props();

	const tools = $derived(data.tools as ToolDoc[]);
	const groups = $derived(
		TOOL_GROUPS.map((g) => ({ ...g, docs: tools.filter((t) => t.group === g.id) })).filter(
			(g) => g.docs.length
		)
	);

	/** The first sentence of a long description; the whole text is in the JSON Schema below it. */
	const firstSentence = (text: string): string =>
		text.split(/\.\s+(?=[A-Z])/)[0].replace(/\.?$/, '.');

	const tryHref = (t: ToolDoc) =>
		`${base}/try${encodeTryState({ tab: 'tools', tool: t.name, args: t.example.args })}`;

	/** Descriptions mark code with backticks. */
	const pieces = (text: string) => text.split('`').map((t, i) => ({ text: t, code: i % 2 === 1 }));

	const callJson = (t: ToolDoc) =>
		JSON.stringify({ name: t.name, arguments: t.example.args }, null, 2);
</script>

<svelte:head>
	<title>Tools · {SITE.name}</title>
	<meta
		name="description"
		content="Every tool Translation Helps MCP offers, with its parameters and an example call you can run."
	/>
</svelte:head>

{#snippet rich(text: string)}
	{#each pieces(text) as piece, i (i)}{#if piece.code}<code class="font-mono text-[0.9em]"
				>{piece.text}</code
			>{:else}{piece.text}{/if}{/each}
{/snippet}

<div class="mx-auto max-w-5xl px-4 py-14">
	<p class="text-accent-2 font-mono text-xs tracking-wide uppercase">Reference</p>
	<h1 class="text-ink mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Tools</h1>
	<p class="text-ink-2 mt-3 max-w-2xl">
		{tools.length} read-only tools. This page is built from the server’s own tool list, so it matches
		what the server accepts. Every example opens in
		<a class="text-accent hover:underline" href="{base}/try">Try</a>, where you can run it. Not sure
		where to start? Read the
		<a class="text-accent hover:underline" href="{base}/docs/workflow">workflow</a>.
	</p>

	<nav aria-label="Tools" class="border-line bg-surface mt-8 rounded-lg border p-4">
		<ul class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
			{#each groups as g (g.id)}
				<li class="min-w-0">
					<a href="#g-{g.id}" class="text-ink text-sm font-semibold hover:underline">{g.heading}</a>
					<ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
						{#each g.docs as t (t.name)}
							<li>
								<a
									href="#{t.name}"
									class="text-ink-2 hover:text-ink font-mono text-xs break-all underline-offset-2 hover:underline"
									>{t.name}</a
								>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</nav>

	{#each groups as g (g.id)}
		<section class="mt-14" aria-labelledby="g-{g.id}">
			<h2 id="g-{g.id}" class="text-ink scroll-mt-20 text-2xl font-semibold tracking-tight">
				{g.heading}
			</h2>
			<p class="text-ink-2 mt-1 text-sm">{g.line}</p>

			<div class="mt-6 space-y-6">
				{#each g.docs as tool (tool.name)}
					<article
						id={tool.name}
						class="border-line bg-surface scroll-mt-20 rounded-lg border p-4 sm:p-6"
					>
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<h3 class="text-ink font-mono text-lg font-semibold break-all">{tool.name}</h3>
							<span class="text-ink-2 border-line-strong rounded border px-1.5 text-xs"
								>read-only</span
							>
							<a
								class="text-accent ml-auto inline-flex items-center gap-1 text-sm font-medium hover:underline"
								href={tryHref(tool)}>Run in Try <ArrowRight size={14} /></a
							>
						</div>
						<p class="text-ink mt-2">{tool.summary}</p>

						<h4 class="text-ink-2 mt-5 text-xs font-medium tracking-wide uppercase">Arguments</h4>
						{#if tool.params.length}
							<ul class="divide-line mt-2 divide-y">
								{#each tool.params as p (p.name)}
									<li class="py-2.5 first:pt-0">
										<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
											<code class="text-ink font-mono text-[13px]">{p.name}</code>
											<span class="text-ink-2 font-mono text-xs">{p.type}</span>
											<span class="text-xs {p.required ? 'text-accent-2' : 'text-ink-2'}"
												>{p.required ? 'required' : 'optional'}</span
											>
											{#if p.default !== undefined}
												<span class="text-ink-2 text-xs"
													>default <code class="font-mono">{String(p.default)}</code></span
												>
											{/if}
										</div>
										{#if p.description}
											<p class="text-ink-2 mt-1 text-sm">
												{@render rich(firstSentence(p.description))}
											</p>
										{/if}
										{#if p.options}
											<p class="text-ink-2 mt-1 font-mono text-xs break-words">
												{p.options.join(' · ')}
											</p>
										{/if}
									</li>
								{/each}
							</ul>
						{:else}
							<p class="text-ink-2 mt-2 text-sm">No arguments.</p>
						{/if}

						<h4 class="text-ink-2 mt-5 text-xs font-medium tracking-wide uppercase">
							Example: {tool.example.label}
						</h4>
						<div class="mt-2 min-w-0">
							<CodeTabs tabs={[{ label: 'tools/call', code: callJson(tool) }]} />
						</div>

						<details class="mt-4">
							<summary class="text-ink-2 hover:text-ink cursor-pointer text-sm"
								>What the assistant is told</summary
							>
							<p class="text-ink-2 mt-2 text-sm whitespace-pre-line">
								{@render rich(tool.description)}
							</p>
						</details>
						<details class="mt-2">
							<summary class="text-ink-2 hover:text-ink cursor-pointer text-sm">JSON Schema</summary
							>
							<pre
								class="border-line bg-bg text-ink mt-2 overflow-x-auto rounded-md border p-3 font-mono text-xs">{JSON.stringify(
									tool.inputSchema,
									null,
									2
								)}</pre>
						</details>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</div>
