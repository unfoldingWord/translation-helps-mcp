<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { ExternalLink } from 'lucide-svelte';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { TOOL_GROUPS } from '$lib/catalog';
	import { DEFAULT_ORIGIN } from '$lib/endpoint';
	import { SITE, endpointFor } from '$lib/site';

	/** The page's own address, known only in the browser; the prerendered page shows the staging site. */
	let origin = $state(DEFAULT_ORIGIN);
	onMount(() => {
		origin = window.location.origin;
	});
	const endpoint = $derived(endpointFor(origin));

	const tree = (path: string) => `${SITE.repo}/tree/v2/packages/${path}`;

	const tools = TOOL_GROUPS.flatMap((g) => g.tools);
	/** get_passage_index → getPassageIndex (the JavaScript client names its methods this way). */
	const camel = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

	const jsTabs = $derived([
		{
			label: 'Install',
			code: 'npm install @translation-helps/mcp-client'
		},
		{
			label: 'Use',
			code: `import {\n  TranslationHelpsClient,\n  getStructuredContent,\n  isResourceNotAvailable,\n} from "@translation-helps/mcp-client";\n\nconst client = new TranslationHelpsClient({ serverUrl: "${endpoint}" });\n\nconst index = await client.getPassageIndex({ reference: "Titus 1:1", language: "en" });\nconst data = getStructuredContent(index);\n\nif (isResourceNotAvailable(data)) {\n  console.log(data.message); // an answer, not a failure\n}`
		}
	]);
	const pyTabs = $derived([
		{
			label: 'Install',
			code: 'pip install translation-helps-mcp-client\n\n# for the async client\npip install translation-helps-mcp-client httpx'
		},
		{
			label: 'Use',
			code: `from translation_helps import (\n    TranslationHelpsClient,\n    get_structured_content,\n    is_resource_not_available,\n)\n\nclient = TranslationHelpsClient(server_url="${endpoint}")\n\nindex = client.get_passage_index({"reference": "Titus 1:1", "language": "en"})\ndata = get_structured_content(index)\n\nif is_resource_not_available(data):\n    print(data["message"])  # an answer, not a failure`
		}
	]);
</script>

<svelte:head>
	<title>SDKs · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="The JavaScript, TypeScript and Python clients for Translation Helps MCP, and the library packages in the repository."
	/>
</svelte:head>

<h1>SDKs</h1>
<p>
	Two clients wrap the MCP calls, so a script or an app can use the tools without speaking the
	protocol. One is for JavaScript and TypeScript, one is for Python. They live in the repository
	under <code>packages/</code>.
</p>
<p>
	Give each client the server address. The examples below show this site’s own address. The clients
	also have a built-in default address; pass yours so that you know which server answers.
</p>

<h2>JavaScript and TypeScript</h2>
<p>
	<code>@translation-helps/mcp-client</code>, MIT licence. It has a typed method for each tool and
	helpers to read the answer.
	<a class="inline-flex items-center gap-1" href={tree('js-sdk')}
		>Source and README <ExternalLink size={12} /></a
	>
</p>
<div class="mt-3 min-w-0"><CodeTabs tabs={jsTabs} /></div>

<h2>Python</h2>
<p>
	<code>translation-helps-mcp-client</code>. It works with the standard library alone, and has an
	async client when <code>httpx</code> is installed.
	<a class="inline-flex items-center gap-1" href={tree('python-sdk')}
		>Source and README <ExternalLink size={12} /></a
	>
</p>
<div class="mt-3 min-w-0"><CodeTabs tabs={pyTabs} /></div>

<h2>One method for each tool</h2>
<p>
	Both clients follow the <a href="{base}/docs/workflow">workflow</a>: the method names are the tool
	names. Arguments are the ones on the <a href="{base}/tools">tools page</a>.
</p>
<div class="mt-3 overflow-x-auto">
	<table class="w-full min-w-[26rem] border-collapse text-left text-sm">
		<thead>
			<tr class="border-line text-ink-2 border-b text-xs">
				<th class="py-2 pr-4 font-normal">Tool</th>
				<th class="py-2 pr-4 font-normal">JavaScript</th>
				<th class="py-2 font-normal">Python</th>
			</tr>
		</thead>
		<tbody>
			{#each tools as t (t)}
				<tr class="border-line border-b last:border-0">
					<td class="py-1.5 pr-4"
						><a class="font-mono text-[13px]" href="{base}/tools#{t}">{t}</a></td
					>
					<td class="text-ink-2 py-1.5 pr-4 font-mono text-[13px]">{camel(t)}()</td>
					<td class="text-ink-2 py-1.5 font-mono text-[13px]">{t}()</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Reading an answer</h2>
<p>
	An answer has <code>content</code> (text), <code>structuredContent</code> (the data, which both
	helpers prefer), and <code>isError</code>. When a language or book lacks a resource, the answer is
	not an error: <code>isError</code> is false and the data says <code>available: false</code>. The
	helper <code>isResourceNotAvailable</code> (Python: <code>is_resource_not_available</code>) tests
	for it. <a href="{base}/docs/limits">Limits and errors</a> lists the codes.
</p>

<h2>Library packages</h2>
<p>The repository holds two more packages under <code>@translation-helps/</code>.</p>
<ul>
	<li>
		<code>door43</code>: the code the server uses to read Door43. It searches the catalog, downloads
		a resource’s ZIP file, and parses USFM and TSV into verses, notes, questions and articles. It is
		an internal workspace package, not published to npm.
		<a href={tree('door43')}>Source</a>
	</li>
	<li>
		<code>shared-prompts</code>: retired. Its system prompts moved into the two clients above.
		<a href={tree('shared-prompts')}>Notes</a>
	</li>
</ul>
