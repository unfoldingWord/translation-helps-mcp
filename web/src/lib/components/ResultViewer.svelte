<script lang="ts">
	import Markdown from './Markdown.svelte';
	import Callout from './Callout.svelte';
	import type { CallResult } from '$lib/mcp/client';
	import type { Outcome } from '$lib/mcp/outcome';
	import { renderedView } from '$lib/try/rendered';
	import { linkFromAnswer, linkTarget, type LinkTarget } from '$lib/try/links';
	import { sourceLine } from '$lib/try/sources';

	let {
		tool = '',
		result,
		outcome,
		pending = false,
		onretry,
		onlink
	}: {
		tool?: string;
		result: CallResult | null;
		outcome: Outcome | null;
		pending?: boolean;
		onretry?: () => void;
		/** Opens an Academy or Words article a link in the answer points to. Without it, links are text. */
		onlink?: (target: LinkTarget) => void;
	} = $props();

	type Tab = 'rendered' | 'json' | 'rpc';
	const TABS: [Tab, string][] = [
		['rendered', 'Rendered'],
		['json', 'JSON'],
		['rpc', 'JSON-RPC']
	];
	let tab = $state<Tab>('rendered');
	const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
	const view = $derived(result ? renderedView(result) : null);
	/** Suggestions the server adds to a "not available" answer. */
	const hints = $derived(
		Array.isArray(result?.structured?.hints)
			? (result.structured.hints as unknown[]).filter((h): h is string => typeof h === 'string')
			: []
	);
	/** Where an answer's content comes from, with its licence. Only under an answer that has content. */
	const source = $derived(
		result && outcome?.kind === 'ok' ? sourceLine(tool, result.structured) : null
	);
	/** The article this answer is, so its relative links (../kt/love.md) can be resolved. */
	const from = $derived(linkFromAnswer(tool, result?.structured));
	const follow = (href: string) => linkTarget(href, from) !== null;
	function openLink(href: string) {
		const target = linkTarget(href, from);
		if (target && onlink) onlink(target);
	}
	/** The Rendered view explains a problem; JSON and JSON-RPC still show what came back, if anything did. */
	const explain = $derived(
		outcome !== null && outcome.kind !== 'ok' && (tab === 'rendered' || !result)
	);
</script>

<section class="border-line bg-surface min-w-0 rounded-lg border" aria-live="polite">
	<div class="border-line flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3">
		<div class="flex gap-1" role="tablist" aria-label="Views of the answer">
			{#each TABS as [id, label]}
				<button
					type="button"
					role="tab"
					aria-selected={tab === id}
					onclick={() => (tab = id)}
					class="border-b-2 px-2 py-2 text-xs {tab === id
						? 'border-accent text-ink'
						: 'text-ink-2 hover:text-ink border-transparent'}">{label}</button
				>
			{/each}
		</div>
		{#if result}
			<p class="text-accent-2 ml-auto font-mono text-[11px]">
				{tool} · {kb(result.exchange.bytes)} · {result.exchange.ms} ms
			</p>
		{/if}
	</div>
	<div class="overflow-x-auto p-4 lg:max-h-[70vh] lg:overflow-y-auto" role="tabpanel">
		{#if pending}
			<p class="text-ink-2 text-sm">Calling the server…</p>
		{:else if explain && outcome && outcome.kind !== 'not-available'}
			<Callout tone="warn">
				{#if outcome.kind === 'rate-limited'}
					Too many requests. Try again in {outcome.retryAfterSeconds} seconds.
				{:else if outcome.kind === 'upstream'}
					Couldn't reach Door43. Try again in a moment.
				{:else if outcome.kind === 'error'}
					{outcome.message}
				{/if}
				{#if onretry}
					<button type="button" class="ml-2 underline" onclick={onretry}>Try again</button>
				{/if}
			</Callout>
		{:else if explain && outcome?.kind === 'not-available'}
			<!-- An answer, not a failure: the server says what it does not have. -->
			<Callout>
				<p>{outcome.message}</p>
				{#if hints.length}
					<ul class="mt-2 list-disc pl-5">
						{#each hints as h}<li>{h}</li>{/each}
					</ul>
				{/if}
			</Callout>
		{:else if !result}
			<p class="text-ink-2 text-sm">Run a call to see what the server returns.</p>
		{:else if tab === 'rendered' && view}
			{#if view.kind === 'markdown'}
				<Markdown source={view.text} {follow} onrc={onlink ? openLink : undefined} />
			{:else if view.kind === 'json'}
				{#if view.summary}<p class="text-ink mb-3 text-sm">{view.summary}</p>{/if}
				<pre class="text-ink overflow-x-auto font-mono text-xs">{view.json}</pre>
			{:else}
				<pre class="text-ink font-mono text-xs whitespace-pre-wrap">{view.text}</pre>
			{/if}
		{:else if tab === 'json'}
			<pre class="text-ink overflow-x-auto font-mono text-xs">{result.structured
					? JSON.stringify(result.structured, null, 2)
					: 'The server sent no structured data. See Rendered for its text.'}</pre>
		{:else}
			<p class="text-ink-2 mb-1 text-xs">Request</p>
			<pre class="text-ink mb-4 overflow-x-auto font-mono text-xs">{JSON.stringify(
					result.exchange.request,
					null,
					2
				)}</pre>
			<p class="text-ink-2 mb-1 text-xs">Response (HTTP {result.exchange.status})</p>
			<pre class="text-ink overflow-x-auto font-mono text-xs">{JSON.stringify(
					result.exchange.response,
					null,
					2
				)}</pre>
		{/if}
	</div>
	{#if source && !pending}
		<p class="border-line text-ink-2 border-t px-4 py-2 text-xs">
			Source on Door43:
			{#each source.sources as s, i (s.href)}{i ? ', ' : ''}<a
					class="text-accent hover:underline"
					href={s.href}
					target="_blank"
					rel="noopener noreferrer">{s.label}</a
				>{/each}
			·
			<a
				class="text-accent hover:underline"
				href={source.licence.href}
				target="_blank"
				rel="license noopener noreferrer">{source.licence.name}</a
			>
		</p>
	{/if}
</section>
