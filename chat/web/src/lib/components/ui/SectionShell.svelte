<script lang="ts">
	/**
	 * SectionShell — collapsible section with icon, title, count chip, and caret.
	 */
	import { slide } from 'svelte/transition';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';

	export let title: string;
	export let count: number | undefined = undefined;
	export let open = false;
	export let countClass = 'bg-[var(--bt-parchment)] text-[var(--bt-taupe)]';
	export let badge: string | undefined = undefined;
	export let badgeClass = 'bg-sky-100 text-sky-800';
	export let onToggle: ((open: boolean) => void) | undefined = undefined;

	function toggle() {
		open = !open;
		onToggle?.(open);
	}
</script>

<div>
	<button
		type="button"
		class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors
			{open
			? 'bg-[var(--bt-parchment)] text-[var(--bt-black)]'
			: 'text-[var(--bt-muted)] hover:bg-[var(--bt-parchment)]/70 hover:text-[var(--bt-black)]'}"
		on:click={toggle}
		aria-expanded={open}
	>
		<span class="inline-flex shrink-0 items-center text-sky-700">
			<slot name="icon" />
		</span>
		<span>{title}</span>
		{#if count !== undefined}
			<span class="rounded-full px-1.5 {countClass}">{count}</span>
		{/if}
		{#if badge}
			<span class="rounded-full px-1.5 {badgeClass}">{badge}</span>
		{/if}
		<span class="ml-auto shrink-0 text-[var(--bt-taupe)]" aria-hidden="true">
			{#if open}
				<ChevronUp size={14} strokeWidth={2} />
			{:else}
				<ChevronDown size={14} strokeWidth={2} />
			{/if}
		</span>
	</button>
	{#if open}
		<div transition:slide={{ duration: 180 }}>
			<slot />
		</div>
	{/if}
</div>
