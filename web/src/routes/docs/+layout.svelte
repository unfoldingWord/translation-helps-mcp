<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { ChevronDown } from 'lucide-svelte';
	import { DOCS_PAGES } from '$lib/docs/pages';
	import { SITE } from '$lib/site';

	let { children } = $props();

	/** Overview first, then the pages, then the tool reference that lives outside /docs. */
	const items = [
		{ href: '/docs', label: 'Overview' },
		...DOCS_PAGES.map((p) => ({ href: p.href, label: p.label })),
		{ href: '/tools', label: 'All tools' }
	];
	const isCurrent = (href: string) => page.url.pathname === base + href;
	const currentLabel = $derived(items.find((i) => isCurrent(i.href))?.label ?? 'Docs');
</script>

<svelte:head><title>Docs · {SITE.name}</title></svelte:head>

<div
	class="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] md:gap-10 md:py-12"
>
	<!-- Phones: the menu folds into one line that shows where you are. It closes when the page changes. -->
	{#key page.url.pathname}
		<details class="border-line bg-surface group rounded-lg border md:hidden">
			<summary
				class="text-ink flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm"
			>
				<span><span class="text-ink-2">Docs:</span> {currentLabel}</span>
				<ChevronDown size={16} class="text-ink-2 transition-transform group-open:rotate-180" />
			</summary>
			<nav aria-label="Docs" class="border-line border-t px-1.5 py-1.5 text-sm">
				<ul>
					{#each items as item (item.href)}
						<li>
							<a
								href="{base}{item.href}"
								aria-current={isCurrent(item.href) ? 'page' : undefined}
								class="block rounded px-2.5 py-1.5 {isCurrent(item.href)
									? 'bg-bg text-ink'
									: 'text-ink-2 hover:text-ink'}">{item.label}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
		</details>
	{/key}

	<nav aria-label="Docs" class="hidden text-sm md:block">
		<div class="sticky top-20">
			<p class="text-accent-2 mb-1 font-mono text-xs">Docs</p>
			<ul>
				{#each items as item (item.href)}
					<li>
						<a
							href="{base}{item.href}"
							aria-current={isCurrent(item.href) ? 'page' : undefined}
							class="block rounded px-2 py-1 {isCurrent(item.href)
								? 'bg-surface text-ink'
								: 'text-ink-2 hover:text-ink'}">{item.label}</a
						>
					</li>
				{/each}
			</ul>
		</div>
	</nav>

	<article class="docs max-w-3xl min-w-0">
		{@render children()}
	</article>
</div>
