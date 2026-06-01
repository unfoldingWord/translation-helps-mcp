<script lang="ts">
	const TOOLS = [
		{ name: 'fetch_scripture', emoji: '📖', desc: 'Bible text (ULT / UST) for any reference' },
		{
			name: 'fetch_translation_notes',
			emoji: '📝',
			desc: 'Exegetical notes explaining difficult phrases'
		},
		{
			name: 'fetch_translation_word_links',
			emoji: '🔗',
			desc: 'Translation Words at a specific reference'
		},
		{ name: 'fetch_translation_word', emoji: '📚', desc: 'Full dictionary article for a word' },
		{
			name: 'fetch_translation_academy',
			emoji: '🎓',
			desc: 'Translation Academy articles by path'
		},
		{
			name: 'fetch_translation_questions',
			emoji: '❓',
			desc: 'Comprehension questions for a passage'
		},
		{ name: 'list_languages', emoji: '🌍', desc: 'All available language codes' },
		{
			name: 'list_resources_for_language',
			emoji: '📋',
			desc: 'Resources available for a language'
		},
		{ name: 'rag_query', emoji: '🔍', desc: 'Semantic search over all resources' },
		{ name: 'get_bundle', emoji: '📦', desc: 'All helps for a passage in one call' },
		{ name: 'index_resource', emoji: '⚡', desc: 'Admin: index a resource for RAG' }
	];

	const CONNECT_EXAMPLES = [
		{
			label: 'Claude Desktop / mcp-remote',
			code: `{
  "mcpServers": {
    "translation-helps": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://translation-helps-mcp.workers.dev/mcp"]
    }
  }
}`
		},
		{
			label: 'Cursor (.cursor/mcp.json)',
			code: `{
  "mcpServers": {
    "translation-helps": {
      "url": "https://translation-helps-mcp.workers.dev/mcp"
    }
  }
}`
		},
		{
			label: 'Direct HTTP (Streamable MCP)',
			code: `POST https://translation-helps-mcp.workers.dev/mcp
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
		}
	];

	let selectedConnect = 0;
</script>

<svelte:head>
	<title>Translation Helps MCP — Bible Translation Resources</title>
</svelte:head>

<!-- Hero -->
<section
	class="border-b border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 py-20 text-center"
>
	<div class="mx-auto max-w-4xl px-4">
		<div class="mb-4 text-6xl">📖</div>
		<h1 class="mb-4 text-5xl leading-tight font-bold text-white">
			Translation Helps <span class="text-indigo-400">MCP</span>
		</h1>
		<p class="mx-auto mb-8 max-w-2xl text-xl text-gray-300">
			A proper MCP server giving LLMs direct access to Bible translation resources — scripture text,
			notes, words, and Academy articles from unfoldingWord.
		</p>
		<div class="flex flex-wrap items-center justify-center gap-4">
			<a
				href="/playground"
				class="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition-colors hover:bg-indigo-500"
			>
				Try the Playground →
			</a>
			<a
				href="/docs"
				class="rounded-lg border border-gray-600 px-6 py-3 font-medium text-gray-300 transition-colors hover:border-gray-400 hover:text-white"
			>
				Read the Docs
			</a>
		</div>
		<p class="mt-6 text-sm text-gray-500">
			Streamable HTTP + SSE · McpAgent on Cloudflare Workers · Structured outputs · RAG
		</p>
	</div>
</section>

<!-- Tools grid -->
<section class="mx-auto max-w-7xl px-4 py-16">
	<h2 class="mb-2 text-2xl font-bold text-white">Available Tools</h2>
	<p class="mb-8 text-gray-400">
		All tools return structured JSON + human-readable text. Errors include machine-readable codes
		and actionable hints.
	</p>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
		{#each TOOLS as tool}
			<a
				href="/playground?tool={tool.name}"
				class="group block rounded-lg border border-gray-800 bg-gray-900 p-4 transition-all hover:border-indigo-600 hover:bg-gray-800"
			>
				<div class="flex items-start gap-3">
					<span class="text-2xl">{tool.emoji}</span>
					<div>
						<div
							class="font-mono text-sm font-semibold text-indigo-300 group-hover:text-indigo-200"
						>
							{tool.name}
						</div>
						<div class="mt-0.5 text-sm text-gray-400">{tool.desc}</div>
					</div>
				</div>
			</a>
		{/each}
	</div>
</section>

<!-- Connection instructions -->
<section class="border-t border-gray-800 bg-gray-900/40 py-16">
	<div class="mx-auto max-w-4xl px-4">
		<h2 class="mb-2 text-2xl font-bold text-white">Connect</h2>
		<p class="mb-6 text-gray-400">Add this server to any MCP-compatible AI assistant.</p>

		<div class="mb-4 flex flex-wrap gap-2">
			{#each CONNECT_EXAMPLES as ex, i}
				<button
					on:click={() => (selectedConnect = i)}
					class="rounded px-3 py-1.5 text-sm font-medium transition-colors
            {selectedConnect === i
						? 'bg-indigo-600 text-white'
						: 'bg-gray-800 text-gray-400 hover:text-white'}"
				>
					{ex.label}
				</button>
			{/each}
		</div>

		<pre
			class="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-sm whitespace-pre text-green-300">{CONNECT_EXAMPLES[
				selectedConnect
			].code}</pre>
	</div>
</section>

<!-- Feature highlights -->
<section class="mx-auto max-w-7xl px-4 py-16">
	<div class="grid grid-cols-1 gap-8 md:grid-cols-3">
		<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
			<div class="mb-3 text-3xl">⚡</div>
			<h3 class="mb-2 font-bold text-white">Cloudflare Workers</h3>
			<p class="text-sm text-gray-400">
				Deployed on Cloudflare Workers with Durable Objects for the McpAgent, KV caching, R2 zip
				storage, and Vectorize for RAG.
			</p>
		</div>
		<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
			<div class="mb-3 text-3xl">🔍</div>
			<h3 class="mb-2 font-bold text-white">RAG-Powered Search</h3>
			<p class="text-sm text-gray-400">
				Semantic search across Translation Notes, Words, and Academy using Workers AI embeddings and
				Vectorize vector store.
			</p>
		</div>
		<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
			<div class="mb-3 text-3xl">📊</div>
			<h3 class="mb-2 font-bold text-white">Observable</h3>
			<p class="text-sm text-gray-400">
				Per-request trace IDs, Analytics Engine metrics, and automated error→GitHub-Issues reporting
				via structured JSON logs.
			</p>
		</div>
	</div>
</section>
