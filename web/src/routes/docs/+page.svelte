<svelte:head>
	<title>Docs — Translation Helps MCP</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-12">
	<h1 class="mb-2 text-3xl font-bold text-white">Documentation</h1>
	<p class="mb-10 text-gray-400">
		Everything you need to integrate Translation Helps MCP into your AI assistant.
	</p>

	<!-- Quickstart -->
	<section class="mb-10">
		<h2 class="mb-4 border-b border-gray-800 pb-2 text-xl font-bold text-white">Quick Start</h2>
		<div class="space-y-4">
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
				<h3 class="mb-2 font-semibold text-indigo-300">
					1. Connect via mcp-remote (Claude Desktop)
				</h3>
				<pre class="overflow-x-auto rounded bg-gray-950 p-3 font-mono text-sm text-green-300">&#123;
  "mcpServers": &#123;
    "translation-helps": &#123;
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://translation-helps-mcp.workers.dev/mcp"]
    &#125;
  &#125;
&#125;</pre>
			</div>
			<div class="rounded-xl border border-gray-800 bg-gray-900 p-6">
				<h3 class="mb-2 font-semibold text-indigo-300">2. Connect via Cursor (.cursor/mcp.json)</h3>
				<pre class="overflow-x-auto rounded bg-gray-950 p-3 font-mono text-sm text-green-300">&#123;
  "mcpServers": &#123;
    "translation-helps": &#123;
      "url": "https://translation-helps-mcp.workers.dev/mcp"
    &#125;
  &#125;
&#125;</pre>
			</div>
		</div>
	</section>

	<!-- Tool reference -->
	<section class="mb-10">
		<h2 class="mb-4 border-b border-gray-800 pb-2 text-xl font-bold text-white">Tool Reference</h2>
		<div class="space-y-4">
			{#each [{ name: 'get_bundle', desc: 'Get all translation helps for a passage in one call. The recommended starting point for translation assistance.', params: [{ n: 'reference', t: 'string', req: true, d: 'Bible passage: "JHN 3:16", "MAT 5:3-12"' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code (default: "en")' }, { n: 'includeScripture', t: 'boolean', req: false, d: 'Include ULT text (default: true)' }, { n: 'includeNotes', t: 'boolean', req: false, d: 'Include TN (default: true)' }, { n: 'includeWords', t: 'boolean', req: false, d: 'Include TW (default: true)' }] }, { name: 'fetch_scripture', desc: 'Fetch Bible text (ULT or UST) for a reference.', params: [{ n: 'reference', t: 'string', req: true, d: 'Bible passage' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code (default: "en")' }, { n: 'resourceType', t: 'ult|ust|glt|gst', req: false, d: 'Translation type (default: "ult")' }, { n: 'format', t: 'text|usfm', req: false, d: 'Output format (default: "text")' }] }, { name: 'fetch_translation_notes', desc: 'Fetch translation notes (TN) for a passage.', params: [{ n: 'reference', t: 'string', req: true, d: 'Bible passage' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code' }] }, { name: 'fetch_translation_word_links', desc: 'List translation word paths at a reference. Run before fetch_translation_word.', params: [{ n: 'reference', t: 'string', req: true, d: 'Bible passage' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code' }] }, { name: 'fetch_translation_word', desc: 'Get the dictionary article for a translation word.', params: [{ n: 'path', t: 'string', req: false, d: 'Word path from fetch_translation_word_links, e.g. "bible/kt/grace"' }, { n: 'term', t: 'string', req: false, d: 'Fallback: word or phrase, e.g. "grace"' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code' }] }, { name: 'fetch_translation_academy', desc: 'Get a Translation Academy article by path.', params: [{ n: 'path', t: 'string', req: true, d: 'Article path, e.g. "translate/figs-metaphor"' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code' }] }, { name: 'rag_query', desc: 'Semantic search over indexed translation resources.', params: [{ n: 'query', t: 'string', req: true, d: 'Natural language question or phrase' }, { n: 'reference', t: 'string', req: false, d: 'Optional Bible reference to scope results' }, { n: 'language', t: 'string', req: false, d: 'BCP-47 code' }, { n: 'resourceTypes', t: 'string[]', req: false, d: '"tn", "tw", "ta", "tq" (default: all)' }, { n: 'topK', t: 'number', req: false, d: 'Max results 1–20 (default: 5)' }] }] as tool}
				<div class="rounded-xl border border-gray-800 bg-gray-900 p-5">
					<div class="mb-2 flex items-start justify-between">
						<div class="font-mono font-semibold text-indigo-300">{tool.name}</div>
						<a
							href="/playground?tool={tool.name}"
							class="text-xs text-indigo-400 hover:text-indigo-300">Try →</a
						>
					</div>
					<p class="mb-3 text-sm text-gray-400">{tool.desc}</p>
					<table class="w-full text-xs">
						<thead>
							<tr class="text-gray-500">
								<th class="pr-3 pb-1 text-left">Parameter</th>
								<th class="pr-3 pb-1 text-left">Type</th>
								<th class="pr-3 pb-1 text-left">Req</th>
								<th class="pb-1 text-left">Description</th>
							</tr>
						</thead>
						<tbody class="font-mono">
							{#each tool.params as p}
								<tr class="border-t border-gray-800">
									<td class="py-1 pr-3 text-white">{p.n}</td>
									<td class="py-1 pr-3 text-blue-400">{p.t}</td>
									<td class="py-1 pr-3"
										>{p.req
											? '<span class="text-red-400">✓</span>'
											: '<span class="text-gray-600">–</span>'}</td
									>
									<td class="py-1 font-sans text-gray-400">{p.d}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/each}
		</div>
	</section>

	<!-- Error codes -->
	<section class="mb-10">
		<h2 class="mb-4 border-b border-gray-800 pb-2 text-xl font-bold text-white">Error Codes</h2>
		<p class="mb-4 text-sm text-gray-400">
			All errors return <code class="rounded bg-gray-800 px-1">isError: true</code> with a structured
			JSON payload containing a stable machine-readable code.
		</p>
		<div class="grid grid-cols-2 gap-2 md:grid-cols-3">
			{#each ['INVALID_REFERENCE', 'INVALID_LANGUAGE', 'INVALID_PARAMS', 'RESOURCE_NOT_FOUND', 'UPSTREAM_DCS_ERROR', 'EMBEDDING_ERROR', 'RATE_LIMITED', 'UNAUTHORIZED', 'INTERNAL_ERROR'] as code}
				<div
					class="rounded border border-gray-800 bg-gray-900 px-3 py-2 font-mono text-xs text-yellow-300"
				>
					{code}
				</div>
			{/each}
		</div>
	</section>
</div>
