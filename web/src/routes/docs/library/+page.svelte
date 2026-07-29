<script lang="ts">
	import { withBase } from '$lib/paths.js';
	import CodeBlock from '$lib/components/docs/CodeBlock.svelte';
	import DocHeader from '$lib/components/docs/DocHeader.svelte';

	const install = `{
  "dependencies": {
    "@translation-helps/door43": "*"
  }
}`;

	const quickstart = `import {
  catalogSearch,
  getResourceZipUrl,
  ZipResourceFetcher2,
  parseTranslationNotesTsv,
} from "@translation-helps/door43";

const entries = await catalogSearch({
  lang: "en",
  subject: "Aligned Bible",
});

const resolved = await getResourceZipUrl("en", "Translation Notes");
if (!resolved) throw new Error("TN not found");

const fetcher = new ZipResourceFetcher2({
  // Optional Cloudflare bindings:
  // R2: env.ZIP_FILES,
  // KV: env.TRANSLATION_HELPS_CACHE,
  // waitUntil: (p) => ctx.waitUntil(p),
});
const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);
const tsv = await fetcher.extractFileFromZip(zip, "tn_TIT.tsv");
const notes = parseTranslationNotesTsv(tsv ?? "", {
  book: "TIT",
  chapter: 2,
  verse: 12,
});`;

	const modules = [
		{
			name: 'Catalog',
			items: 'catalogSearch, listLanguages, getResourceZipUrl'
		},
		{
			name: 'ZIP',
			items: 'ZipResourceFetcher2 (memory → R2 → network, single-flight)'
		},
		{
			name: 'Parsers',
			items: 'USFM, TSV (TN/TWL/TQ), TA/TW catalog, OBS'
		},
		{
			name: 'Alignment',
			items: 'QuoteMatcher, USFM tokenizer'
		},
		{
			name: 'Contracts',
			items: 'Shared TypeScript shapes for API + MCP'
		}
	];
</script>

<svelte:head>
	<title>Door43 library — Docs</title>
</svelte:head>

<DocHeader
	eyebrow="Library"
	title="@translation-helps/door43"
	description="Catalog client, ZIP resource fetcher, and parsers for Door43 / DCS Bible translation resources. Used by the REST API worker; MCP tools reach that API via ApiClient."
/>

<div
	class="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm leading-relaxed text-slate-300"
>
	For AI assistants, see the
	<a
		href={withBase('/docs/mcp')}
		class="font-medium text-sky-300 underline-offset-2 hover:underline">MCP tools</a
	>. Use this package to embed Door43 access in your own Worker or Node service.
</div>

<div
	class="mb-8 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100"
>
	<strong class="font-semibold text-amber-50">Status:</strong> internal workspace package (<code
		>private: true</code
	>). Not on npm yet — import from the monorepo. Publishing later is
	<code>private: false</code> + build + publish.
</div>

<section class="mb-10">
	<h2>Install (workspace)</h2>
	<CodeBlock code={install} lang="json" filename="package.json" />
</section>

<section class="mb-10">
	<h2>Quickstart</h2>
	<CodeBlock code={quickstart} lang="typescript" filename="example.ts" />
</section>

<section class="mb-10">
	<h2>Platform injection</h2>
	<p class="mb-4 text-sm text-slate-400">
		No Cloudflare types are required. Bindings are duck-typed structural interfaces:
	</p>
	<div class="overflow-hidden rounded-xl border border-slate-800">
		<table class="w-full text-left text-sm">
			<thead class="bg-slate-900/80 text-xs tracking-wider text-slate-500 uppercase">
				<tr>
					<th class="px-4 py-3 font-medium">Need</th>
					<th class="px-4 py-3 font-medium">Interface</th>
					<th class="px-4 py-3 font-medium">Typical CF source</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-800 text-slate-300">
				<tr class="bg-slate-950/40">
					<td class="px-4 py-3">Catalog / TOC cache</td>
					<td class="px-4 py-3 font-mono text-sky-300">KvLike</td>
					<td class="px-4 py-3 font-mono text-xs text-slate-400">env.TRANSLATION_HELPS_CACHE</td>
				</tr>
				<tr>
					<td class="px-4 py-3">ZIP persistence</td>
					<td class="px-4 py-3 font-mono text-sky-300">BucketLike</td>
					<td class="px-4 py-3 font-mono text-xs text-slate-400">env.ZIP_FILES</td>
				</tr>
				<tr class="bg-slate-950/40">
					<td class="px-4 py-3">Background R2 writes</td>
					<td class="px-4 py-3 font-mono text-sky-300">waitUntil</td>
					<td class="px-4 py-3 font-mono text-xs text-slate-400">(p) =&gt; ctx.waitUntil(p)</td>
				</tr>
			</tbody>
		</table>
	</div>
</section>

<section class="mb-10">
	<h2>Modules</h2>
	<ul class="space-y-2">
		{#each modules as mod}
			<li class="rounded-lg border border-slate-800/80 bg-slate-900/30 px-4 py-3">
				<span class="font-semibold text-slate-100">{mod.name}</span>
				<span class="text-slate-500"> — </span>
				<span class="text-sm text-slate-400">{mod.items}</span>
			</li>
		{/each}
	</ul>
</section>

<p class="text-sm text-slate-500">
	Source: <code>packages/door43/</code> ·
	<a href={withBase('/docs/api')}>Next: REST API →</a>
</p>
