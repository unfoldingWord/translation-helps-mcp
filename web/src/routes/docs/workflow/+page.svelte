<script lang="ts">
	import { base } from '$app/paths';
	import { ArrowRight } from 'lucide-svelte';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { WHY_INDEX, WORKFLOW, type WorkflowCall } from '$lib/docs/workflow';
	import { encodeTryState } from '$lib/try/hashState';
	import { SITE } from '$lib/site';

	const tryHref = (c: WorkflowCall) =>
		`${base}/try${encodeTryState({ tab: 'tools', tool: c.tool, args: c.args })}`;
	const callJson = (c: WorkflowCall) =>
		JSON.stringify({ name: c.tool, arguments: c.args }, null, 2);
</script>

<svelte:head>
	<title>Workflow · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="The order the server recommends for a passage: text, background, index, then each help, then questions."
	/>
</svelte:head>

<h1>Workflow</h1>
<p>
	The server tells every assistant the same order for working through a passage, and the tools are
	built for it. You can follow it by hand as well. Each step gives its output to the next. The
	examples use Titus 1:1 in English; the two article paths are samples, and a real run takes them
	from the index.
</p>
<p>
	Want to see it first? The <a href="{base}/try">guided walk on Try</a> runs these steps for any passage.
</p>

<ol class="mt-8 list-none p-0">
	{#each WORKFLOW as step, i (step.id)}
		<li
			id={step.id}
			class="border-line mt-0 scroll-mt-20 border-t py-8 first:border-t-0 first:pt-0"
		>
			<p class="text-accent-2 font-mono text-xs">Step {i + 1}</p>
			<h2 class="mt-1">{step.title}</h2>
			<p>{step.text}</p>
			{#each step.calls as call (call.tool)}
				<div class="mt-4 min-w-0">
					<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
						<p class="text-ink m-0 text-sm">
							<code>{call.tool}</code> <span class="text-ink-2">· {call.label}</span>
						</p>
						<a class="inline-flex items-center gap-1 text-sm font-medium" href={tryHref(call)}>
							Run in Try <ArrowRight size={14} />
						</a>
					</div>
					<div class="mt-2">
						<CodeTabs tabs={[{ label: 'tools/call', code: callJson(call) }]} />
					</div>
				</div>
			{/each}
		</li>
	{/each}
</ol>

<h2>Why the index saves tokens</h2>
<p>{WHY_INDEX}</p>
<p>
	The same idea explains the other two habits in the order. The passage text is cheap, so it is
	fetched again whenever it is needed. The questions come last because they check a draft, and a
	draft does not exist before the helps have been read.
</p>

<h2>Searching instead</h2>
<p>
	When no note points to the article you want, <a href="{base}/tools#search_articles"
		><code>search_articles</code></a
	>
	finds Translation Academy lessons and Translation Words articles by topic. It can be called at any
	step, and gives back paths that <code>get_academy_article</code> and <code>get_word_article</code>
	accept.
</p>
