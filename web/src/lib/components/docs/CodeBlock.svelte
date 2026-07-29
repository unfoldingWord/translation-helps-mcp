<script lang="ts">
	import { browser } from '$app/environment';
	import Prism from 'prismjs';
	import 'prismjs/components/prism-json.js';
	import 'prismjs/components/prism-typescript.js';
	import 'prismjs/components/prism-javascript.js';
	import 'prismjs/components/prism-bash.js';
	import 'prismjs/components/prism-python.js';
	import { Check, Copy } from 'lucide-svelte';

	interface Props {
		code: string;
		lang?: 'json' | 'typescript' | 'javascript' | 'bash' | 'python' | 'text';
		filename?: string;
		class?: string;
	}

	let { code, lang = 'text', filename, class: className = '' }: Props = $props();

	let copied = $state(false);

	const highlighted = $derived.by(() => {
		const grammar = Prism.languages[lang];
		if (!grammar) {
			return escapeHtml(code);
		}
		try {
			return Prism.highlight(code, grammar, lang);
		} catch {
			return escapeHtml(code);
		}
	});

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	async function copy() {
		if (!browser) return;
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* ignore */
		}
	}
</script>

<div
	class="docs-code group relative overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950 {className}"
>
	<div
		class="flex items-center justify-between gap-3 border-b border-slate-800/90 bg-slate-900/80 px-3 py-2"
	>
		<div class="flex min-w-0 items-center gap-2">
			<span class="flex gap-1" aria-hidden="true">
				<span class="h-2 w-2 rounded-full bg-slate-600"></span>
				<span class="h-2 w-2 rounded-full bg-slate-600"></span>
				<span class="h-2 w-2 rounded-full bg-slate-600"></span>
			</span>
			{#if filename}
				<span class="truncate font-mono text-xs text-slate-300">{filename}</span>
			{:else}
				<span class="font-mono text-[10px] tracking-wider text-slate-500 uppercase">{lang}</span>
			{/if}
		</div>
		<button
			type="button"
			onclick={copy}
			class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 transition
				hover:bg-slate-800 hover:text-slate-200"
			title="Copy code"
			aria-label="Copy code"
		>
			{#if copied}
				<Check class="h-3.5 w-3.5 text-emerald-400" />
				<span class="text-emerald-400">Copied</span>
			{:else}
				<Copy class="h-3.5 w-3.5" />
				<span>Copy</span>
			{/if}
		</button>
	</div>
	<pre class="overflow-x-auto p-4 text-[13px] leading-relaxed"><code
			class="language-{lang} font-mono text-slate-200">{@html highlighted}</code
		></pre>
</div>
