<script lang="ts">
	/** The words a help covers: the translation's wording, then the original-language words it renders. */
	let { original = '', aligned = '' }: { original?: string; aligned?: string } = $props();
</script>

<span class="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
	{#if aligned}<span class="text-ink">“{aligned}”</span>{/if}
	{#if original}<span class="text-ink-2 break-words" dir="auto">{original}</span>{/if}
</span>
