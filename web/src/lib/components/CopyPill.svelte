<script lang="ts">
	import { Check, Copy } from 'lucide-svelte';
	let { value, label = 'Copy' }: { value: string; label?: string } = $props();
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<div
	class="border-line-strong bg-surface inline-flex max-w-full items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3"
>
	<code class="text-ink truncate font-mono text-[13px]">{value}</code>
	<button
		type="button"
		onclick={copy}
		class="text-ink-2 hover:text-ink inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs"
		aria-label={copied ? 'Copied' : label}
	>
		{#if copied}<Check size={14} /> Copied{:else}<Copy size={14} />{/if}
	</button>
</div>
