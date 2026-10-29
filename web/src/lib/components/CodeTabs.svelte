<script lang="ts">
	import { Check, Copy } from 'lucide-svelte';
	let { tabs }: { tabs: { label: string; code: string }[] } = $props();
	let active = $state(0);
	let copied = $state(false);
	const current = $derived(tabs[Math.min(active, tabs.length - 1)]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(current.code);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}
</script>

<div class="border-line bg-surface overflow-hidden rounded-lg border">
	<div class="border-line flex items-center gap-1 overflow-x-auto border-b px-2" role="tablist">
		{#each tabs as tab, i}
			<button
				type="button"
				role="tab"
				aria-selected={i === active}
				onclick={() => (active = i)}
				class="shrink-0 border-b-2 px-2.5 py-2 text-xs {i === active
					? 'border-accent text-ink'
					: 'text-ink-2 hover:text-ink border-transparent'}">{tab.label}</button
			>
		{/each}
		<button
			type="button"
			onclick={copy}
			class="text-ink-2 hover:text-ink ml-auto inline-flex shrink-0 items-center gap-1 px-2 py-2 text-xs"
			aria-label="Copy code"
		>
			{#if copied}<Check size={14} /> Copied{:else}<Copy size={14} /> Copy{/if}
		</button>
	</div>
	<pre class="text-ink overflow-x-auto p-3 font-mono text-[13px] leading-relaxed"><code
			>{current.code}</code
		></pre>
</div>
