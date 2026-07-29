<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import DocHeader from '$lib/components/docs/DocHeader.svelte';
	import { ArrowRight, Boxes, BookOpen, Plug, Terminal } from 'lucide-svelte';

	const builders = [
		{
			href: '/docs/sdks',
			title: 'Client SDKs',
			blurb:
				'Typed JS/TS and Python clients over the MCP endpoint — call tools from app code without speaking JSON-RPC by hand.',
			when: 'For application code that wraps the MCP server.',
			icon: BookOpen,
			meta: '@translation-helps/mcp-client'
		},
		{
			href: '/docs/api',
			title: 'REST API',
			blurb:
				'Stable JSON over Door43 with KV/R2 caching. Same data layer the MCP tools call via ApiClient.',
			when: 'For mobile apps, backends, or anything that prefers plain HTTP.',
			icon: Terminal,
			meta: '/api/v1/*'
		},
		{
			href: '/docs/library',
			title: 'Door43 library',
			blurb:
				'Catalog client, ZIP fetch, USFM/TSV/OBS parsers, and alignment. Used by the REST API under the hood.',
			when: 'Embed Door43 access inside your own Worker or Node service (internal package today).',
			icon: Boxes,
			meta: '@translation-helps/door43'
		}
	];

	const claudeConfig = `{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tc-helps.mcp.servant.bible/v2/mcp"]
    }
  }
}`;

	const cursorConfig = `{
  "mcpServers": {
    "translation-helps": {
      "url": "https://tc-helps.mcp.servant.bible/v2/mcp"
    }
  }
}`;
</script>

<svelte:head>
	<title>Docs — Translation Helps MCP</title>
</svelte:head>

<DocHeader
	eyebrow="Get started"
	title="MCP server"
	description="Progressive-disclosure tools and prompts for Claude, Cursor, and custom agents. Connect once, then fetch scripture, notes, words, and Academy articles through the MCP endpoint."
/>

<section class="mb-12">
	<a
		href={withBase('/docs/mcp')}
		class="group mb-6 flex items-start gap-4 rounded-2xl border border-sky-500/35 bg-sky-500/10 p-5 transition
			hover:border-sky-400/50 hover:bg-sky-500/15"
	>
		<div
			class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30"
		>
			<Plug class="h-6 w-6" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex flex-wrap items-center gap-2">
				<h2 class="text-lg font-semibold text-slate-100 group-hover:text-sky-50">
					Tools & prompts
				</h2>
				<code
					class="rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300/90"
					>/v2/mcp</code
				>
			</div>
			<p class="text-sm leading-relaxed text-sky-100/80">
				Full tool and prompt reference, or try calls in the Playground.
			</p>
		</div>
		<ArrowRight
			class="mt-3 h-5 w-5 shrink-0 text-sky-400/70 transition group-hover:translate-x-0.5 group-hover:text-sky-200"
		/>
	</a>

	<div class="mb-4 flex flex-wrap gap-2">
		<a
			href={withBase('/docs/mcp')}
			class="inline-flex items-center rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/20"
		>
			Tool & prompt reference →
		</a>
		<a
			href={withBase('/playground')}
			class="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-300 hover:border-sky-500/30 hover:text-sky-200"
		>
			Open Playground →
		</a>
	</div>
</section>

<section class="mb-14">
	<h2>Quick connect</h2>
	<p class="mb-4 text-sm text-slate-400">
		Add the MCP endpoint to Claude Desktop or Cursor and start calling tools immediately.
	</p>
	<div class="grid gap-4 lg:grid-cols-2">
		<div>
			<p class="mb-2 text-sm font-medium text-slate-300">Claude Desktop</p>
			<CodeBlock code={claudeConfig} lang="json" filename="claude_desktop_config.json" />
		</div>
		<div>
			<p class="mb-2 text-sm font-medium text-slate-300">Cursor</p>
			<CodeBlock code={cursorConfig} lang="json" filename=".cursor/mcp.json" />
		</div>
	</div>
</section>

<section class="mb-14">
	<h2>The data</h2>
	<div
		class="rounded-2xl border border-slate-800/90 bg-gradient-to-br from-sky-500/5 via-slate-900/40 to-transparent p-5 sm:p-6"
	>
		<p class="mb-4 max-w-2xl text-sm leading-relaxed text-slate-300">
			Tools serve unfoldingWord translation helps — open resources for mother-tongue translators,
			available in many languages (not only English). Fetched live from Door43; cached in KV/R2; not
			modified or rehosted.
		</p>
		<div class="mb-5 flex flex-wrap gap-2">
			{#each [{ abbr: 'ULT', href: 'https://unfoldingword.org/for-translators/content/#ULT' }, { abbr: 'UST', href: 'https://unfoldingword.org/for-translators/content/#UST' }, { abbr: 'TN', href: 'https://unfoldingword.org/for-translators/content/#UTN' }, { abbr: 'TW', href: 'https://unfoldingword.org/for-translators/content/#UTW' }, { abbr: 'TA', href: 'https://unfoldingword.org/for-translators/training/' }, { abbr: 'TQ', href: 'https://unfoldingword.org/for-translators/content/#UTQ' }, { abbr: 'OBS', href: 'https://unfoldingword.org/open-bible-stories/' }] as item}
				<a
					href={item.href}
					target="_blank"
					rel="noopener noreferrer"
					class="rounded-md border border-slate-700/80 bg-slate-950/70 px-2 py-1 font-mono text-[11px] tracking-wide text-emerald-300/85 transition hover:border-sky-500/40 hover:text-emerald-200"
					>{item.abbr}</a
				>
			{/each}
		</div>
		<p class="mb-3 text-xs leading-relaxed text-slate-500">
			Scripture, Translation Notes, Words, Academy, Questions, and Open Bible Stories — each chip
			links to unfoldingWord’s explanation.
		</p>
		<div class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
			<a
				href="https://git.door43.org/"
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono text-emerald-300/90 underline-offset-2 hover:underline">git.door43.org</a
			>
			<a
				href="https://door43.org/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-sky-300 underline-offset-2 hover:underline">door43.org</a
			>
			<a
				href="https://unfoldingword.org/for-translators/content/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-sky-300 underline-offset-2 hover:underline">unfoldingWord content</a
			>
		</div>
	</div>
</section>

<section>
	<h2>Also available</h2>
	<p class="mb-5 text-sm leading-relaxed text-slate-400">
		Surfaces the MCP server uses under the hood — useful if you're building something that talks
		HTTP or embeds Door43 access directly.
	</p>
	<div class="space-y-3">
		{#each builders as item}
			{@const Icon = item.icon}
			<a
				href={withBase(item.href)}
				class="group flex items-start gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/50 p-4 transition
					hover:border-sky-500/40 hover:bg-slate-900/80"
			>
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-300 ring-1 ring-slate-700"
				>
					<Icon class="h-5 w-5" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="mb-1 flex flex-wrap items-center gap-2">
						<h3 class="text-base font-semibold text-slate-100 group-hover:text-sky-100">
							{item.title}
						</h3>
						<code
							class="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300/90"
							>{item.meta}</code
						>
					</div>
					<p class="mb-2 text-sm leading-relaxed text-slate-400">{item.blurb}</p>
					<p class="text-xs leading-relaxed text-slate-500">{item.when}</p>
				</div>
				<ArrowRight
					class="mt-2 h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-sky-300"
				/>
			</a>
		{/each}
	</div>
</section>
