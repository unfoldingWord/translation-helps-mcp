<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import CopyPill from '$lib/components/CopyPill.svelte';
	import Button from '$lib/components/Button.svelte';
	import { CLIENTS } from '$lib/connect/clients';
	import { DEFAULT_ORIGIN } from '$lib/endpoint';
	import { API, SITE, endpointFor } from '$lib/site';

	/** The page's own address, known only in the browser; the prerendered page shows the staging site. */
	let origin = $state(DEFAULT_ORIGIN);
	onMount(() => {
		origin = window.location.origin;
	});

	const endpoint = $derived(endpointFor(origin));
	const clients = $derived(CLIENTS(endpoint));
	let active = $state('claude-desktop');
	const current = $derived(clients.find((c) => c.id === active) ?? clients[0]);

	const apiBase = `${API.origin}${API.basePath}`;
	const restTabs = [
		{
			label: 'curl',
			code: `curl "${apiBase}/scripture?reference=JHN%203:16&language=en"`
		},
		{
			label: 'JavaScript',
			code: `const res = await fetch(\n  "${apiBase}/scripture?reference=JHN%203:16&language=en"\n);\nconst passage = await res.json();`
		}
	];
	const sdkTabs = $derived([
		{
			label: 'JavaScript',
			code: `npm install @translation-helps/mcp-client\n\nimport { TranslationHelpsClient } from "@translation-helps/mcp-client";\n\nconst client = new TranslationHelpsClient({ serverUrl: "${endpoint}" });\nconst passage = await client.getPassage({ reference: "John 3:16", language: "en" });`
		},
		{
			label: 'Python',
			code: `pip install translation-helps-mcp-client\n\nfrom translation_helps import TranslationHelpsClient\n\nclient = TranslationHelpsClient(server_url="${endpoint}")\npassage = client.get_passage({"reference": "John 3:16", "language": "en"})`
		}
	]);

	const troubles = [
		[
			'The client says it cannot connect',
			'This server speaks MCP over Streamable HTTP at the URL above. A client that can only start local programs needs mcp-remote (see Other clients).'
		],
		[
			'The server never shows up, and there is no error',
			'Check the key name in your config file. Cursor and Claude Desktop read "mcpServers", VS Code reads "servers", and a server under the wrong key can be skipped without a warning.'
		],
		[
			'A request from curl or a script fails',
			'MCP over HTTP needs both content types in the Accept header: application/json, text/event-stream. For plain requests without MCP, use the REST API below.'
		],
		[
			'“Rate limit exceeded”',
			'The server allows 90 requests per minute from one address by default. Wait the number of seconds in the Retry-After header and try again.'
		],
		[
			'An answer says the resource is not available',
			'That language or book has no such resource yet. It is an answer, not an error: try English, or ask list_resources what the language has.'
		]
	];
</script>

<svelte:head>
	<title>Connect · {SITE.name}</title>
	<meta
		name="description"
		content="Add Translation Helps MCP to Claude, Cursor, VS Code, ChatGPT or any MCP client, or call the REST API or an SDK. No key needed."
	/>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-14">
	<p class="text-accent-2 font-mono text-xs tracking-wide uppercase">MCP · REST API · SDKs</p>
	<h1 class="text-ink mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
		Connect your assistant
	</h1>
	<p class="text-ink-2 mt-3 max-w-2xl">
		The server has one URL and needs no key or account. Add it to your client, then ask about a
		passage. Prefer plain HTTP or code? The REST API and the SDKs are further down.
	</p>
	<div class="mt-6 min-w-0"><CopyPill value={endpoint} label="Copy the server URL" /></div>

	<div
		class="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
	>
		<nav aria-label="Clients" class="min-w-0">
			<ul class="flex gap-1 overflow-x-auto md:flex-col">
				{#each clients as c (c.id)}
					<li class="shrink-0">
						<button
							type="button"
							onclick={() => (active = c.id)}
							aria-current={active === c.id ? 'true' : undefined}
							class="w-full rounded-md px-3 py-1.5 text-left text-sm whitespace-nowrap {active ===
							c.id
								? 'bg-surface text-ink'
								: 'text-ink-2 hover:text-ink'}">{c.label}</button
						>
					</li>
				{/each}
			</ul>
		</nav>

		<section class="min-w-0" aria-live="polite">
			<h2 class="text-ink text-xl font-semibold">{current.label}</h2>
			<p class="text-ink-2 mt-2">{current.steps}</p>
			{#if current.install}
				<div class="mt-4">
					<Button variant="primary" href={current.install.href}>{current.install.label}</Button>
				</div>
			{/if}
			<div class="mt-5">
				{#key current.id}<CodeTabs tabs={current.tabs} />{/key}
			</div>
			<p class="text-ink-2 mt-5 text-sm">
				Then ask, for example: “What do the notes say about ‘the world’ in John 3:16?”
				<a class="text-accent hover:underline" href="{base}/try">Or try it here first.</a>
			</p>
		</section>
	</div>

	<section class="border-line mt-16 border-t pt-12" aria-labelledby="rest">
		<h2 id="rest" class="text-ink text-2xl font-semibold tracking-tight">The REST API</h2>
		<p class="text-ink-2 mt-2 max-w-2xl">
			The same data over plain HTTP: GET requests that answer in JSON, with no key. The MCP tools
			call this API underneath.
		</p>
		<div class="mt-4 min-w-0"><CopyPill value={apiBase} label="Copy the API base URL" /></div>
		<div class="mt-5"><CodeTabs tabs={restTabs} /></div>
		<p class="text-ink-2 mt-4 text-sm">
			Every endpoint, with its parameters and an example answer, is on <a
				class="text-accent hover:underline"
				href="{base}/docs/api">the REST API page</a
			>.
		</p>
	</section>

	<section class="border-line mt-14 border-t pt-12" aria-labelledby="sdks">
		<h2 id="sdks" class="text-ink text-2xl font-semibold tracking-tight">SDKs</h2>
		<p class="text-ink-2 mt-2 max-w-2xl">
			A JavaScript and TypeScript client and a Python client wrap the MCP calls. Pass the server URL
			shown above.
		</p>
		<div class="mt-5"><CodeTabs tabs={sdkTabs} /></div>
		<p class="text-ink-2 mt-4 text-sm">
			More in <a class="text-accent hover:underline" href="{base}/docs/sdks">the SDKs page</a>.
		</p>
	</section>

	<section class="mt-16" aria-labelledby="trouble">
		<h2 id="trouble" class="text-ink text-xl font-semibold">Troubleshooting</h2>
		<div class="divide-line border-line mt-4 divide-y rounded-lg border">
			{#each troubles as [q, a] (q)}
				<details class="group p-4">
					<summary class="text-ink cursor-pointer">{q}</summary>
					<p class="text-ink-2 mt-2 text-sm">{a}</p>
				</details>
			{/each}
		</div>
		<p class="text-ink-2 mt-4 text-sm">
			Limits and error codes are listed under <a
				class="text-accent hover:underline"
				href="{base}/docs/limits">Limits and errors</a
			>.
		</p>
	</section>
</div>
