<script lang="ts">
	interface Props {
		title: string;
		eyebrow?: string;
		description?: string;
	}

	let { title, eyebrow, description }: Props = $props();
</script>

<header class="mb-10">
	{#if eyebrow}
		<p class="mb-2 text-xs font-semibold tracking-[0.14em] text-sky-400/90 uppercase">{eyebrow}</p>
	{/if}
	<h1
		class="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl"
		style="font-family: var(--font-heading); font-weight: 500;"
	>
		{title}
	</h1>
	{#if description}
		<p class="mt-3 max-w-2xl text-base leading-relaxed text-slate-400">{description}</p>
	{/if}
</header>
