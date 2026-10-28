<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { Menu, X } from 'lucide-svelte';
	import { SITE, nav } from '$lib/site';
	import ThemeToggle from './ThemeToggle.svelte';
	import Button from './Button.svelte';

	let open = $state(false);
	const current = (href: string) => {
		const full = `${base}${href}`;
		return page.url.pathname === full || page.url.pathname.startsWith(full + '/');
	};
	// Connect is the header button; the other pages are links.
	const links = nav.filter((n) => n.label !== 'Connect');
</script>

<header class="border-line bg-bg sticky top-0 z-20 border-b">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
		<a
			href="{base}/"
			class="text-ink flex min-w-0 items-center gap-2.5"
			aria-label="{SITE.name}, home"
		>
			<img src="{base}/favicon.svg" alt="" class="h-7 w-7 shrink-0" />
			<span class="truncate text-[15px] font-bold tracking-tight">{SITE.name}</span>
		</a>
		<nav class="ml-auto hidden items-center gap-1 md:flex" aria-label="Main">
			{#each links as item (item.href)}
				<a
					href="{base}{item.href}"
					class="hover:text-ink rounded-md px-3 py-1.5 text-sm {current(item.href)
						? 'text-ink'
						: 'text-ink-2'}"
					aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a
				>
			{/each}
			<a href={SITE.repo} class="text-ink-2 hover:text-ink rounded-md px-3 py-1.5 text-sm">GitHub</a
			>
		</nav>
		<div class="ml-auto flex shrink-0 items-center gap-2 md:ml-2">
			<ThemeToggle />
			<span class="hidden sm:inline-flex">
				<Button variant="primary" href="{base}/connect">Connect</Button>
			</span>
			<button
				type="button"
				class="border-line text-ink-2 inline-flex h-8 w-8 items-center justify-center rounded-md border md:hidden"
				aria-label={open ? 'Close menu' : 'Open menu'}
				aria-expanded={open}
				onclick={() => (open = !open)}
			>
				{#if open}<X size={16} />{:else}<Menu size={16} />{/if}
			</button>
		</div>
	</div>
	{#if open}
		<nav class="border-line border-t px-4 py-2 md:hidden" aria-label="Main">
			{#each nav as item (item.href)}
				<a
					href="{base}{item.href}"
					class="text-ink block py-2"
					aria-current={current(item.href) ? 'page' : undefined}
					onclick={() => (open = false)}>{item.label}</a
				>
			{/each}
			<a href={SITE.repo} class="text-ink block py-2">GitHub</a>
		</nav>
	{/if}
</header>
