<script lang="ts">
	// Sources: src/core/rateLimit.ts (limit, headers, 429 body), src/core/errors.ts (codes and the status of each),
	// src/mcp/agent.ts and src/worker.ts (the soft answer and how errors are sent),
	// src/mcp/manifest.ts (response notes), src/api/worker.ts (REST errors, edge cache).
	import { base } from '$app/paths';
	import CodeTabs from '$lib/components/CodeTabs.svelte';
	import { SITE } from '$lib/site';

	const rateBody = `{\n  "error": {\n    "code": "RATE_LIMITED",\n    "message": "Rate limit exceeded (90 requests per minute). Retry after 12s.",\n    "retryable": true\n  }\n}`;
	const softAnswer = `{\n  "available": false,\n  "code": "RESOURCE_NOT_AVAILABLE",\n  "message": "No translation questions available for this reference or language.",\n  "hints": ["Run list_resources to see what is available for this language."]\n}`;

	/** [code, status on /api/tool, when]. The statuses are the table in src/core/errors.ts. */
	const codes = [
		['INVALID_REFERENCE', '400', 'The reference has no chapter or verse, or is not a passage.'],
		['INVALID_LANGUAGE', '400', 'The language code is not known. Ask list_languages.'],
		['MISSING_REQUIRED_PARAM', '400', 'A required argument is missing.'],
		['INVALID_PARAMS', '400', 'An argument has the wrong shape or value.'],
		['RESOURCE_NOT_FOUND', '404', 'The thing asked for does not exist.'],
		['RATE_LIMITED', '429', 'More than the rate limit allows. Retry after the delay.'],
		['UPSTREAM_DCS_ERROR', '502', 'Door43 answered with an error. Marked retryable.'],
		['INTERNAL_ERROR', '500', 'An unexpected failure on the server.']
	];
</script>

<svelte:head>
	<title>Limits and errors · Docs · {SITE.name}</title>
	<meta
		name="description"
		content="The rate limit, the soft answer for a missing resource, the error codes, and response sizes."
	/>
</svelte:head>

<h1>Limits and errors</h1>
<p>
	Only what the server sends is listed here. The page does not describe fields that no answer
	carries.
</p>

<h2>Rate limit</h2>
<p>
	The server allows <strong class="text-ink">90 requests per minute</strong> from one address by
	default. It applies to the MCP address (<code>/mcp</code>), to <code>/api/tool</code>, and to the
	<a href="{base}/docs/api">REST API</a>. Calls made on <a href="{base}/try">Try</a> count too.
</p>
<p>
	Past the limit the answer is HTTP 429 with a <code>Retry-After</code> header in seconds, the
	headers <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>, and this body:
</p>
<div class="mt-3 min-w-0"><CodeTabs tabs={[{ label: '429', code: rateBody }]} /></div>
<p>
	The count is kept by each running copy of the server on its own, so the limit is a soft one. Wait
	the time in <code>Retry-After</code> and try again.
</p>

<h2>When a resource is not there</h2>
<p>
	A language or book that lacks a resource is not a failure. The tool answers normally, with
	<code>isError: false</code>, and the data says what is missing:
</p>
<div class="mt-3 min-w-0">
	<CodeTabs tabs={[{ label: 'structuredContent', code: softAnswer }]} />
</div>
<p>
	The code is <code>RESOURCE_NOT_AVAILABLE</code>. It is sent as an answer so that an assistant
	tells the translator the gap exists, and does not treat the server as down. <code>hints</code>
	says what to try next, usually
	<a href="{base}/tools#list_resources"><code>list_resources</code></a>.
</p>
<p>
	An empty list is also an answer. <code>notes: []</code>, <code>questions: []</code> or
	<code>results: []</code> mean there is nothing for this passage or search, and are not errors.
</p>
<p>These fields mark a partial answer, with <code>isError</code> still false:</p>
<ul>
	<li>
		<code>versionsNote</code> on <code>get_passage</code>: another version of the language stood in
		for a missing one, and says which and why.
	</li>
	<li>
		<code>notesError</code> and <code>availabilityError</code> on <code>get_passage_context</code>:
		one part failed upstream and the rest is returned.
	</li>
</ul>

<h2>Errors</h2>
<p>
	A real error has <code>isError: true</code>. Its text starts with the code, as in
	<code>Error INVALID_LANGUAGE: Unknown language code: "xx"</code>, and it carries no
	<code>structuredContent</code>. On <code>/api/tool</code> the same code comes with an HTTP status,
	shown below. Over MCP the HTTP status stays 200 and the error is in the result.
</p>
<div class="mt-3 overflow-x-auto">
	<table class="w-full min-w-[28rem] border-collapse text-left text-sm">
		<thead>
			<tr class="border-line text-ink-2 border-b text-xs">
				<th class="py-2 pr-4 font-normal">Code</th>
				<th class="py-2 pr-4 font-normal">Status</th>
				<th class="py-2 font-normal">Meaning</th>
			</tr>
		</thead>
		<tbody>
			{#each codes as [code, status, text] (code)}
				<tr class="border-line border-b align-top last:border-0">
					<td class="text-ink py-2 pr-4 font-mono text-[13px] break-all">{code}</td>
					<td class="text-ink-2 py-2 pr-4">{status}</td>
					<td class="text-ink-2 py-2">{text}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p>
	Errors can carry <code>hints</code> and a <code>retryable</code> flag. When <code>retryable</code>
	is true, the same request can succeed later. The REST API sends errors as
	<code>{'{ "error": { code, message, retryable } }'}</code>.
</p>

<h2>Response sizes</h2>
<p>
	Some assistants cut long tool results, and a long answer uses up the conversation. Ask for a verse
	or a short range rather than a whole book. For a passage, start with
	<a href="{base}/tools#get_passage_index"><code>get_passage_index</code></a>, which lists the helps
	without their text, and open only the ones you need (see the
	<a href="{base}/docs/workflow">workflow</a>). The Try page shows the size of every answer.
</p>

<h2>Caching</h2>
<p>
	Content from Door43 is cached on the server, so a repeated call is fast. Answers for a passage
	(scripture, notes, key-term links and questions) carry <code>meta.cache</code> to say where the data
	came from:
</p>
<ul>
	<li><code>memory</code>: kept in memory by the running copy of the server.</li>
	<li><code>kv</code>: a stored copy of an earlier answer or download.</li>
	<li><code>r2</code>: the stored ZIP file of the resource.</li>
	<li><code>network</code>: downloaded from Door43 for this request.</li>
	<li><code>pack</code>: read from a <a href="{base}/docs/languages">language pack</a>.</li>
	<li><code>mixed</code>: scripture only, when its parts came from different places.</li>
</ul>
<p>The REST API also lets the network edge keep a good answer for up to an hour.</p>
