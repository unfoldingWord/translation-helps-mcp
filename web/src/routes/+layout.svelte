<script lang="ts">
	import '../app.css';
	import SiteHeader from '$lib/components/SiteHeader.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { SITE } from '$lib/site';

	let { children } = $props();
</script>

<svelte:head>
	<title>{SITE.name}</title>
	<meta name="description" content={SITE.tagline} />
</svelte:head>

<SiteHeader />
<main>
	{@render children()}
</main>
<SiteFooter />
