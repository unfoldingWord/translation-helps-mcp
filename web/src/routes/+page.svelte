<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import {
		BookOpen,
		ExternalLink,
		Library,
		MessageCircleQuestion,
		NotebookPen,
		ScrollText
	} from 'lucide-svelte';

	interface Props {
		data: {
			manifest: {
				tools: Array<{ name: string; summary: string; description: string; category: string }>;
			};
		};
	}

	let { data }: Props = $props();

	const CONNECT_EXAMPLES = [
		{
			label: 'Claude Desktop / mcp-remote',
			lang: 'json' as const,
			code: `{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tc-helps.mcp.servant.bible/v2/mcp"]
    }
  }
}`
		},
		{
			label: 'Cursor (.cursor/mcp.json)',
			lang: 'json' as const,
			code: `{
  "mcpServers": {
    "translation-helps": {
      "url": "https://tc-helps.mcp.servant.bible/v2/mcp"
    }
  }
}`
		},
		{
			label: 'Direct HTTP (Streamable MCP)',
			lang: 'bash' as const,
			code: `POST https://tc-helps.mcp.servant.bible/v2/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
		}
	];

	let selectedConnect = $state(0);

	const CONTENT_BASE = 'https://unfoldingword.org/for-translators/content';

	const RESOURCE_TYPES = [
		{
			abbr: 'ULT · UST',
			title: 'Scripture text',
			body: 'Literal and simplified source texts in many languages, plus Hebrew and Greek originals.',
			icon: BookOpen,
			links: [
				{ label: 'ULT', href: `${CONTENT_BASE}/#ULT` },
				{ label: 'UST', href: `${CONTENT_BASE}/#UST` }
			]
		},
		{
			abbr: 'TN',
			title: 'Translation Notes',
			body: 'Verse-by-verse help on meaning, grammar, and wording choices — available in many languages.',
			icon: NotebookPen,
			links: [{ label: 'Learn more', href: `${CONTENT_BASE}/#UTN` }]
		},
		{
			abbr: 'TW',
			title: 'Translation Words',
			body: 'Short articles on key biblical terms and how they are used — available in many languages.',
			icon: Library,
			links: [{ label: 'Learn more', href: `${CONTENT_BASE}/#UTW` }]
		},
		{
			abbr: 'TA',
			title: 'Translation Academy',
			body: 'A craft manual for process, checking, and common issues — available in many languages.',
			icon: ScrollText,
			links: [
				{
					label: 'Learn more',
					href: 'https://unfoldingword.org/for-translators/training/'
				}
			]
		},
		{
			abbr: 'TQ',
			title: 'Translation Questions',
			body: 'Comprehension checks that a draft communicates clearly — available in many languages.',
			icon: MessageCircleQuestion,
			links: [{ label: 'Learn more', href: `${CONTENT_BASE}/#UTQ` }]
		},
		{
			abbr: 'OBS',
			title: 'Open Bible Stories',
			body: 'Fifty key stories for oral translation and community checking — in many languages.',
			icon: BookOpen,
			links: [
				{ label: 'unfoldingWord', href: 'https://unfoldingword.org/open-bible-stories/' },
				{ label: 'Content catalog', href: `${CONTENT_BASE}/#OBS` }
			]
		}
	];

	const STEPS = [
		{
			n: '1',
			title: 'Connect an assistant',
			body: 'Point Claude, Cursor, or any MCP client at this server — or open Chat on the web.'
		},
		{
			n: '2',
			title: 'Ask about a passage',
			body: 'Request scripture, notes, key terms, or Academy guidance in the language you serve.'
		},
		{
			n: '3',
			title: 'Get grounded helps',
			body: 'Answers cite unfoldingWord resources — the same open catalog that powers BT Servant.'
		}
	];
</script>

<svelte:head>
	<title>Translation Helps — BT Servant ecosystem</title>
</svelte:head>

<div class="page-shell">
	<!-- Hero -->
	<section class="py-16 sm:py-24">
		<div class="mx-auto max-w-4xl px-4 text-center sm:px-6">
			<p class="bt-eyebrow mb-4">BT Servant · Translation Helps</p>
			<h1
				class="mb-4 text-4xl tracking-tight text-slate-100 sm:text-5xl md:text-[3.4rem]"
				style="font-family: var(--font-heading); font-weight: 500;"
			>
				The translation resources behind your
				<span class="bt-accent">translation coach</span>
			</h1>
			<p
				class="mx-auto mb-3 max-w-xl text-lg text-slate-400 italic"
				style="font-family: var(--font-heading);"
			>
				Open scripture helps for AI-powered Bible translation.
			</p>
			<p class="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-slate-400">
				Translation Helps MCP is the resource layer in the
				<a
					href="https://www.btservant.ai/"
					target="_blank"
					rel="noopener"
					class="font-medium text-sky-500 underline-offset-2 hover:underline">BT Servant</a
				>
				ecosystem — giving assistants live access to scripture text, notes, words, questions, and Academy
				articles from unfoldingWord.
			</p>
			<div class="mb-8 flex flex-wrap items-center justify-center gap-3">
				<a href={withBase('/chat')} class="ui-btn ui-btn-solid px-6 py-3"> Open the Chat </a>
				<a href={withBase('/docs')} class="ui-btn px-4 py-3 text-slate-300 hover:text-slate-100">
					Read the Docs →
				</a>
			</div>
			<ul class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
				<li class="inline-flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full bg-sky-500" aria-hidden="true"></span>
					Open licensed (CC BY-SA)
				</li>
				<li class="inline-flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full bg-sky-500" aria-hidden="true"></span>
					60+ languages
				</li>
				<li class="inline-flex items-center gap-2">
					<span class="inline-block h-2 w-2 rounded-full bg-sky-500" aria-hidden="true"></span>
					MCP standard
				</li>
			</ul>
		</div>
	</section>

	<!-- Trust strip -->
	<section class="border-y border-slate-800 bg-slate-900 py-6 text-center">
		<p
			class="mx-auto max-w-3xl px-4 text-base text-slate-400 italic sm:text-lg"
			style="font-family: var(--font-heading);"
		>
			Built on unfoldingWord’s open translation helps — the same resources that power BT Servant.
		</p>
	</section>

	<!-- What are translation helps? -->
	<section class="py-16 sm:py-20">
		<div class="mx-auto max-w-7xl px-4 sm:px-6">
			<div class="mb-10 max-w-2xl">
				<p class="bt-eyebrow mb-3">Resources</p>
				<h2 class="mb-4 text-3xl text-slate-100 sm:text-4xl">What are translation helps?</h2>
				<p class="text-lg leading-relaxed text-slate-400">
					Open Bible resources for mother-tongue translators — a literal text, a simplified text,
					and the notes, words, and questions that go with them. Available in many languages through
					Door43.
				</p>
				<p class="mt-3 text-sm leading-relaxed text-slate-500">
					Created by
					<a
						href="https://www.unfoldingword.org/"
						target="_blank"
						rel="noopener noreferrer"
						class="text-sky-500 underline-offset-2 hover:underline">unfoldingWord</a
					>, licensed CC BY-SA. Fetched live from
					<a
						href="https://git.door43.org/"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 text-sky-500 underline-offset-2 hover:underline"
						>Door43 <ExternalLink class="h-3 w-3" /></a
					>
					— never modified or rehosted.
				</p>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{#each RESOURCE_TYPES as resource}
					{@const Icon = resource.icon}
					<div class="ui-card flex flex-col p-5">
						<div class="mb-3 flex items-center gap-3">
							<div
								class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-900"
								style="background: var(--bt-black); color: var(--bt-cream);"
							>
								<Icon class="h-5 w-5" />
							</div>
							<code
								class="rounded-md bg-sky-50 px-2 py-0.5 font-mono text-[11px] tracking-wide text-emerald-300"
								>{resource.abbr}</code
							>
						</div>
						<h3 class="mb-1.5 text-base font-semibold text-slate-100">{resource.title}</h3>
						<p class="mb-4 flex-1 text-sm leading-relaxed text-slate-400">{resource.body}</p>
						<div class="flex flex-wrap gap-x-3 gap-y-1">
							{#each resource.links as link}
								<a
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-xs font-medium text-sky-500 underline-offset-2 hover:underline"
								>
									{link.label}
									<ExternalLink class="h-3 w-3 opacity-60" />
								</a>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- From server to answer -->
	<section class="border-y border-slate-800 bg-slate-900 py-16 sm:py-20">
		<div class="mx-auto max-w-7xl px-4 sm:px-6">
			<div class="section-head mb-12 text-center">
				<h2 class="mb-3 text-3xl text-slate-100 sm:text-4xl">
					From server to <span class="bt-accent">answer</span>
				</h2>
				<p class="mx-auto max-w-xl text-slate-400">
					Three steps. No friction. Ground every translation question in trusted helps.
				</p>
			</div>
			<div class="relative mx-auto grid max-w-4xl grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
				{#each STEPS as step}
					<div class="relative pt-4 text-center md:text-left">
						<div
							class="mx-auto mb-4 flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold md:mx-0"
							style="background: var(--bt-black); color: var(--bt-cream);"
						>
							{step.n}
						</div>
						<h3 class="mb-2 text-lg font-semibold text-slate-100">{step.title}</h3>
						<p class="text-sm leading-relaxed text-slate-400">{step.body}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Tools grid -->
	<section class="py-16 sm:py-20">
		<div class="mx-auto max-w-7xl px-4 sm:px-6">
			<p class="bt-eyebrow mb-3">Catalog</p>
			<h2 class="mb-2 text-3xl text-slate-100">Available tools</h2>
			<p class="mb-8 max-w-2xl text-slate-400">
				Structured JSON plus human-readable text. Errors include machine-readable codes and
				actionable hints — ready for BT Servant–style assistants.
			</p>
			<div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
				{#each data.manifest.tools as tool}
					<a href="{withBase('/playground')}?tool={tool.name}" class="ui-card group block p-4">
						<div class="mb-1 font-mono text-sm font-semibold text-sky-500 group-hover:text-sky-600">
							{tool.name}
						</div>
						<div class="text-sm text-slate-400">{tool.summary}</div>
					</a>
				{/each}
			</div>
		</div>
	</section>

	<!-- Connect -->
	<section class="border-t border-slate-800 bg-slate-900 py-16">
		<div class="mx-auto max-w-4xl px-4 sm:px-6">
			<p class="bt-eyebrow mb-3">Setup</p>
			<h2 class="mb-2 text-3xl text-slate-100">Connect</h2>
			<p class="mb-6 text-slate-400">
				Add this server to any MCP-compatible AI assistant — the same protocol BT Servant uses to
				ground answers in translation helps.
			</p>

			<div class="mb-4 flex flex-wrap gap-2">
				{#each CONNECT_EXAMPLES as ex, i}
					<button
						onclick={() => (selectedConnect = i)}
						class="ui-chip {selectedConnect === i ? 'ui-chip-active' : ''}"
					>
						{ex.label}
					</button>
				{/each}
			</div>

			<div class="overflow-hidden rounded-2xl border border-slate-800 shadow-sm">
				<CodeBlock
					code={CONNECT_EXAMPLES[selectedConnect].code}
					lang={CONNECT_EXAMPLES[selectedConnect].lang}
				/>
			</div>
		</div>
	</section>

	<!-- CTA banner -->
	<section class="bt-cta-banner py-16">
		<div
			class="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 sm:flex-row sm:items-center sm:px-6"
		>
			<h2
				class="max-w-xl text-2xl sm:text-3xl"
				style="font-family: var(--font-heading); color: var(--bt-cream); font-weight: 500;"
			>
				Bring translation helps into your assistant.
			</h2>
			<div class="flex flex-wrap gap-3">
				<a
					href={withBase('/chat')}
					class="inline-flex items-center rounded-full px-5 py-3 text-sm font-medium transition"
					style="background: var(--bt-cream); color: var(--bt-black);"
				>
					Open Chat
				</a>
				<a
					href={withBase('/docs')}
					class="inline-flex items-center rounded-full border px-5 py-3 text-sm font-medium transition"
					style="border-color: rgba(237,236,232,0.35); color: var(--bt-cream);"
				>
					Read the Docs →
				</a>
			</div>
		</div>
	</section>
</div>
