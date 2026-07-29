<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import DocHeader from '$lib/components/docs/DocHeader.svelte';

	const MCP_URL = 'https://tc-helps.mcp.servant.bible/v2/mcp';
	const WORKERS_MCP = 'https://translation-helps-mcp-v2.unfoldingword.workers.dev/v2/mcp';

	const jsInstall = `npm install @translation-helps/mcp-client`;

	const jsExample = `import { TranslationHelpsClient } from "@translation-helps/mcp-client";

const client = new TranslationHelpsClient({
  serverUrl: "${MCP_URL}",
});

const passage = await client.getPassage({
  reference: "TIT 2:12",
  language: "en",
});

const index = await client.getPassageIndex({
  reference: "TIT 2:12",
  language: "en",
});`;

	const pyInstall = `pip install translation-helps-mcp-client`;

	const pyExample = `from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient(
    server_url="${MCP_URL}",
)

passage = await client.get_passage({
    "reference": "TIT 2:12",
    "language": "en",
})`;
</script>

<svelte:head>
	<title>Client SDKs — Docs</title>
</svelte:head>

<DocHeader
	eyebrow="SDKs"
	title="Client SDKs"
	description="Typed JS/TS and Python clients over the MCP endpoint — so application code doesn't speak JSON-RPC by hand."
/>

<div
	class="mb-8 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm leading-relaxed text-slate-300"
>
	Wraps the
	<a
		href={withBase('/docs/mcp')}
		class="font-medium text-sky-300 underline-offset-2 hover:underline">MCP tools</a
	>. Prefer plain HTTP? See the
	<a
		href={withBase('/docs/api')}
		class="font-medium text-sky-300 underline-offset-2 hover:underline">REST API</a
	>. Need raw Door43 access?
	<a
		href={withBase('/docs/library')}
		class="font-medium text-sky-300 underline-offset-2 hover:underline">Door43 library</a
	>
	(internal today).
</div>

<section class="mb-12">
	<h2>JavaScript / TypeScript</h2>
	<p class="mb-3 text-sm text-slate-400">
		Package: <code>@translation-helps/mcp-client</code>
	</p>
	<div class="mb-4">
		<CodeBlock code={jsInstall} lang="bash" filename="terminal" />
	</div>
	<CodeBlock code={jsExample} lang="typescript" filename="example.ts" />
</section>

<section class="mb-12">
	<h2>Python</h2>
	<p class="mb-3 text-sm text-slate-400">
		Package: <code>translation-helps-mcp-client</code>
	</p>
	<div class="mb-4">
		<CodeBlock code={pyInstall} lang="bash" filename="terminal" />
	</div>
	<CodeBlock code={pyExample} lang="python" filename="example.py" />
</section>

<section class="mb-10">
	<h2>MCP URLs</h2>
	<div class="space-y-3">
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
			<p class="mb-2 text-xs font-medium tracking-wider text-slate-500 uppercase">
				Production (custom domain)
			</p>
			<code class="font-mono text-sm break-all text-emerald-300">{MCP_URL}</code>
		</div>
		<div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
			<p class="mb-2 text-xs font-medium tracking-wider text-slate-500 uppercase">
				Direct workers.dev
			</p>
			<code class="font-mono text-sm break-all text-emerald-300">{WORKERS_MCP}</code>
		</div>
	</div>
</section>

<p class="text-sm text-slate-500">
	Source: <code>packages/js-sdk/</code>, <code>packages/python-sdk/</code> ·
	<a href={withBase('/docs/mcp')}>← MCP server</a>
</p>
