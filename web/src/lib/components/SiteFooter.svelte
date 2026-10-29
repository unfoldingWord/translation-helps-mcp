<script lang="ts">
	import { base } from '$app/paths';
	import { SITE, footerNav } from '$lib/site';

	const url = (href: string) => (href.startsWith('/') ? `${base}${href}` : href);
</script>

<footer class="border-line border-t">
	<div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2">
		<div>
			<p class="text-ink font-semibold">{SITE.name}</p>
			<p class="text-ink-2 mt-2">{SITE.tagline}</p>
		</div>
		<div>
			<p class="text-accent-2 text-xs">More</p>
			<ul class="text-ink-2 mt-2 flex flex-wrap gap-x-5 gap-y-1">
				{#each footerNav as item (item.href)}
					<li><a class="hover:text-ink" href={url(item.href)}>{item.label}</a></li>
				{/each}
			</ul>
		</div>
	</div>
</footer>
