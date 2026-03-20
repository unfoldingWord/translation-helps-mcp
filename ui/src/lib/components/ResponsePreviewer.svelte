<script lang="ts">
	import { marked } from 'marked';
	import Prism from 'prismjs';
	import 'prismjs/components/prism-json';
	import 'prismjs/themes/prism-tomorrow.css';
	import { onMount } from 'svelte';

	export let result: any = null;
	export let format: 'json' | 'markdown' | 'text' | 'auto' = 'auto';

	let detectedFormat: 'json' | 'markdown' | 'text' = 'json';
	let processedContent = '';
	let rawContent = '';

	// Detect format from result
	$: {
		if (result) {
			// Extract raw content from MCP response structure
			if (typeof result === 'string') {
				rawContent = result;
				detectedFormat = 'text';
			} else if (result.data && typeof result.data === 'string') {
				// MCP response with data field (text or markdown)
				rawContent = result.data;
				// Check if it looks like markdown
				if (
					result.data.includes('# ') ||
					result.data.includes('## ') ||
					result.data.includes('**') ||
					result.data.includes('[')
				) {
					detectedFormat = 'markdown';
				} else {
					detectedFormat = 'text';
				}
			} else {
				// JSON object
				rawContent = JSON.stringify(result, null, 2);
				detectedFormat = 'json';
			}

			// Override with explicit format if provided
			if (format !== 'auto') {
				detectedFormat = format;
			}

			// Process content based on format
			processContent();
		}
	}

	function processContent() {
		if (!rawContent) {
			processedContent = '';
			return;
		}

		switch (detectedFormat) {
			case 'json':
				// Syntax highlight JSON
				try {
					const json =
						typeof result === 'string' ? JSON.parse(result) : JSON.parse(rawContent);
					const formatted = JSON.stringify(json, null, 2);
					processedContent = Prism.highlight(formatted, Prism.languages.json, 'json');
				} catch (e) {
					// If not valid JSON, just display as text
					processedContent = rawContent;
				}
				break;

			case 'markdown':
				// Render markdown
				try {
					// Configure marked options
					marked.setOptions({
						breaks: true,
						gfm: true
					});
					processedContent = marked.parse(rawContent) as string;
				} catch (e) {
					processedContent = rawContent;
				}
				break;

			case 'text':
			default:
				// Display as plain text with line numbers
				processedContent = rawContent;
				break;
		}
	}

	onMount(() => {
		processContent();
	});
</script>

<div class="response-previewer">
	{#if detectedFormat === 'json'}
		<!-- JSON Syntax Highlighted -->
		<div class="json-viewer">
			<pre class="language-json"><code class="language-json">{@html processedContent}</code></pre>
		</div>
	{:else if detectedFormat === 'markdown'}
		<!-- Markdown Rendered -->
		<div class="markdown-viewer prose prose-invert prose-sm max-w-none">
			{@html processedContent}
		</div>
	{:else}
		<!-- Plain Text with Line Numbers -->
		<div class="text-viewer">
			<pre class="text-content">{processedContent}</pre>
		</div>
	{/if}
</div>

<style>
	.response-previewer {
		width: 100%;
		overflow: hidden;
		border-radius: 0.5rem;
	}

	.json-viewer {
		background: #1e1e1e;
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.json-viewer pre {
		margin: 0;
		padding: 1rem;
		background: transparent;
		font-size: 0.875rem;
		line-height: 1.5;
		overflow-x: auto;
	}

	.json-viewer code {
		background: transparent;
		padding: 0;
		font-family: 'Fira Mono', 'Consolas', 'Monaco', monospace;
	}

	.markdown-viewer {
		background: rgb(31 41 55 / 0.5);
		border: 1px solid rgb(55 65 81);
		border-radius: 0.5rem;
		padding: 1.5rem;
		overflow-x: auto;
	}

	.markdown-viewer :global(h1) {
		color: rgb(229 231 235);
		font-size: 1.875rem;
		font-weight: 700;
		margin-top: 0;
		margin-bottom: 1rem;
		border-bottom: 1px solid rgb(75 85 99);
		padding-bottom: 0.5rem;
	}

	.markdown-viewer :global(h2) {
		color: rgb(229 231 235);
		font-size: 1.5rem;
		font-weight: 600;
		margin-top: 1.5rem;
		margin-bottom: 0.75rem;
	}

	.markdown-viewer :global(h3) {
		color: rgb(209 213 219);
		font-size: 1.25rem;
		font-weight: 600;
		margin-top: 1.25rem;
		margin-bottom: 0.5rem;
	}

	.markdown-viewer :global(h4) {
		color: rgb(209 213 219);
		font-size: 1.125rem;
		font-weight: 600;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}

	.markdown-viewer :global(p) {
		color: rgb(209 213 219);
		margin-bottom: 1rem;
		line-height: 1.75;
	}

	.markdown-viewer :global(ul),
	.markdown-viewer :global(ol) {
		color: rgb(209 213 219);
		margin-left: 1.5rem;
		margin-bottom: 1rem;
	}

	.markdown-viewer :global(li) {
		margin-bottom: 0.5rem;
	}

	.markdown-viewer :global(code) {
		background: rgb(17 24 39);
		color: rgb(147 197 253);
		padding: 0.2rem 0.4rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-family: 'Fira Mono', 'Consolas', 'Monaco', monospace;
	}

	.markdown-viewer :global(pre) {
		background: rgb(17 24 39);
		border: 1px solid rgb(55 65 81);
		border-radius: 0.5rem;
		padding: 1rem;
		overflow-x: auto;
		margin-bottom: 1rem;
	}

	.markdown-viewer :global(pre code) {
		background: transparent;
		padding: 0;
		color: rgb(229 231 235);
	}

	.markdown-viewer :global(strong) {
		color: rgb(255 255 255);
		font-weight: 600;
	}

	.markdown-viewer :global(em) {
		color: rgb(209 213 219);
		font-style: italic;
	}

	.markdown-viewer :global(a) {
		color: rgb(96 165 250);
		text-decoration: underline;
	}

	.markdown-viewer :global(a:hover) {
		color: rgb(147 197 253);
	}

	.markdown-viewer :global(blockquote) {
		border-left: 4px solid rgb(75 85 99);
		padding-left: 1rem;
		margin-left: 0;
		margin-bottom: 1rem;
		color: rgb(156 163 175);
		font-style: italic;
	}

	.markdown-viewer :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1rem;
	}

	.markdown-viewer :global(th),
	.markdown-viewer :global(td) {
		border: 1px solid rgb(75 85 99);
		padding: 0.5rem;
		text-align: left;
	}

	.markdown-viewer :global(th) {
		background: rgb(31 41 55);
		color: rgb(229 231 235);
		font-weight: 600;
	}

	.markdown-viewer :global(td) {
		color: rgb(209 213 219);
	}

	.text-viewer {
		background: rgb(17 24 39);
		border: 1px solid rgb(55 65 81);
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.text-content {
		margin: 0;
		padding: 1rem;
		color: rgb(209 213 219);
		font-family: 'Fira Mono', 'Consolas', 'Monaco', monospace;
		font-size: 0.875rem;
		line-height: 1.6;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.json-viewer pre,
		.text-content {
			font-size: 0.75rem;
			padding: 0.75rem;
		}

		.markdown-viewer {
			padding: 1rem;
		}

		.markdown-viewer :global(h1) {
			font-size: 1.5rem;
		}

		.markdown-viewer :global(h2) {
			font-size: 1.25rem;
		}

		.markdown-viewer :global(h3) {
			font-size: 1.125rem;
		}
	}
</style>
