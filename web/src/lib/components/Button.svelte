<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		variant = 'secondary',
		href,
		type = 'button',
		onclick,
		children
	}: {
		variant?: 'primary' | 'secondary';
		href?: string;
		type?: 'button' | 'submit';
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
	const cls = $derived(
		'inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm transition-colors ' +
			(variant === 'primary'
				? 'bg-accent text-on-accent hover:opacity-90'
				: 'border border-line-strong text-ink hover:bg-surface')
	);
</script>

{#if href}
	<a {href} class={cls}>{@render children()}</a>
{:else}
	<button {type} class={cls} {onclick}>{@render children()}</button>
{/if}
