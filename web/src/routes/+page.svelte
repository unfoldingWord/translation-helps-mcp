<script lang="ts">
	import { base } from '$app/paths';
	import { SITE } from '$lib/site';
	import Button from '$lib/components/Button.svelte';
</script>

<section class="mx-auto max-w-6xl px-4 py-16 sm:py-24">
	<h1 class="rise text-ink text-4xl font-bold tracking-tight sm:text-5xl">{SITE.name}</h1>
	<p class="rise rise-2 text-ink-2 mt-4 max-w-xl text-lg">{SITE.tagline}</p>
	<div class="rise rise-2 mt-8 flex flex-wrap gap-3">
		<Button variant="primary" href="{base}/try">Try it</Button>
		<Button href="{base}/connect">Connect</Button>
	</div>
</section>
