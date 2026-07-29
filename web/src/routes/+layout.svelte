<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { onDestroy, onMount } from 'svelte';
	import { withBase } from '$lib/paths';
	import Menu from 'lucide-svelte/icons/menu';
	import X from 'lucide-svelte/icons/x';

	const NAV = [
		{ path: '/', label: 'Home' },
		{ path: '/playground', label: 'Playground' },
		{ path: '/rag', label: 'Article Search' },
		{ path: '/docs', label: 'Docs' }
	];

	let menuOpen = false;
	/** Visible viewport height (accounts for mobile keyboard via visualViewport). */
	let vvh = '100dvh';

	$: pathname = $page.url.pathname;
	$: isChat = pathname === withBase('/chat') || pathname.startsWith(`${withBase('/chat')}/`);

	function isActive(path: string, current: string): boolean {
		const href = withBase(path);
		if (path === '/') return current === href || current === `${href}/`;
		return current === href || current.startsWith(`${href}/`);
	}

	$: if (!isChat) menuOpen = false;

	function syncVisualViewport() {
		const vv = typeof window !== 'undefined' ? window.visualViewport : null;
		if (!vv) {
			vvh = '100dvh';
			document.documentElement.style.setProperty('--vvh', '100dvh');
			document.documentElement.style.setProperty('--vv-top', '0px');
			return;
		}
		const h = Math.max(0, vv.height);
		vvh = `${h}px`;
		document.documentElement.style.setProperty('--vvh', vvh);
		document.documentElement.style.setProperty('--vv-top', `${vv.offsetTop}px`);
	}

	let removeVvListeners: (() => void) | undefined;

	onMount(() => {
		const meta = document.querySelector('meta[name="viewport"]');
		if (meta) {
			meta.setAttribute(
				'content',
				'width=device-width, initial-scale=1, interactive-widget=resizes-content'
			);
		}

		const vv = window.visualViewport;
		syncVisualViewport();
		if (!vv) return;

		const onChange = () => syncVisualViewport();
		vv.addEventListener('resize', onChange);
		vv.addEventListener('scroll', onChange);
		window.addEventListener('resize', onChange);
		removeVvListeners = () => {
			vv.removeEventListener('resize', onChange);
			vv.removeEventListener('scroll', onChange);
			window.removeEventListener('resize', onChange);
		};
	});

	onDestroy(() => {
		removeVvListeners?.();
		if (typeof document !== 'undefined') {
			document.documentElement.style.removeProperty('--vvh');
			document.documentElement.style.removeProperty('--vv-top');
		}
	});
</script>

<svelte:head>
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
	/>
</svelte:head>

<div
	class="flex bg-slate-950 text-slate-100
		{isChat ? 'chat-shell flex-col overflow-hidden' : 'min-h-screen flex-col'}"
	style={isChat
		? 'height: var(--vvh, 100dvh); max-height: var(--vvh, 100dvh); margin-top: var(--vv-top, 0px);'
		: undefined}
>
	<header
		class="sticky top-0 z-50 shrink-0 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-md
			{isChat ? 'safe-top' : ''}"
	>
		<div
			class="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6"
		>
			<a href={withBase('/')} class="flex min-w-0 items-baseline gap-2 tracking-tight">
				<span
					class="truncate font-serif text-lg font-semibold text-slate-100 sm:text-xl"
					style="font-family: var(--font-heading);"
				>
					<span class="sm:hidden">Translation Helps</span>
					<span class="hidden sm:inline">Translation Helps</span>
				</span>
				<span
					class="hidden shrink-0 text-xs font-medium text-slate-400 sm:inline"
					style="font-family: var(--font-body);"
				>
					by
					<span class="text-sky-500 italic">BT Servant</span>
				</span>
			</a>

			<!-- Desktop nav -->
			<nav class="hidden items-center gap-1 md:flex">
				{#each NAV as { path, label }}
					{@const on = isActive(path, pathname)}
					<a
						href={withBase(path)}
						class="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition
              {on
							? 'bg-sky-500/15 text-slate-100 ring-1 ring-sky-500/40'
							: 'text-slate-300 hover:text-slate-100'}"
					>
						{label}
					</a>
				{/each}
				<a href={withBase('/chat')} class="ui-btn ui-btn-solid ml-2 !px-4 !py-2 text-sm">
					Open Chat
				</a>
			</nav>

			<!-- Mobile menu toggle -->
			<button
				type="button"
				class="inline-flex items-center justify-center rounded-lg border border-slate-700 p-2 text-slate-200 md:hidden"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
				on:click={() => (menuOpen = !menuOpen)}
			>
				{#if menuOpen}
					<X size={18} strokeWidth={2} />
				{:else}
					<Menu size={18} strokeWidth={2} />
				{/if}
			</button>
		</div>

		{#if menuOpen}
			<nav class="border-t border-slate-800 bg-slate-950 px-3 py-3 md:hidden" aria-label="Site">
				<div class="grid grid-cols-2 gap-1">
					{#each NAV as { path, label }}
						{@const on = isActive(path, pathname)}
						<a
							href={withBase(path)}
							on:click={() => (menuOpen = false)}
							class="rounded-lg px-3 py-2.5 text-sm font-medium transition
                {on
								? 'bg-sky-500/15 text-slate-100 ring-1 ring-sky-500/40'
								: 'text-slate-300 hover:bg-slate-800'}"
						>
							{label}
						</a>
					{/each}
					<a
						href={withBase('/chat')}
						on:click={() => (menuOpen = false)}
						class="ui-btn ui-btn-solid col-span-2 mt-1 justify-center"
					>
						Open Chat
					</a>
				</div>
			</nav>
		{/if}
	</header>

	<main class="min-h-0 flex-1 {isChat ? 'overflow-hidden' : ''}">
		<slot />
	</main>

	{#if !isChat}
		<footer class="bt-cta-banner mt-auto border-t border-black/20">
			<div class="mx-auto max-w-7xl px-4 py-10 sm:px-6">
				<div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p
							class="mb-1 font-serif text-lg font-medium"
							style="font-family: var(--font-heading); color: var(--bt-cream);"
						>
							Translation Helps
						</p>
						<p class="max-w-md text-sm leading-relaxed text-slate-600">
							Part of the
							<a
								href="https://www.btservant.ai/"
								target="_blank"
								rel="noopener"
								class="text-sky-400 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300"
								>BT Servant</a
							>
							ecosystem by unfoldingWord — open scripture resources for AI-powered translation coaches.
						</p>
					</div>
					<nav
						class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"
						aria-label="Footer"
					>
						<a href={withBase('/docs')} class="transition hover:text-sky-300">Docs</a>
						<a href={withBase('/status')} class="transition hover:text-sky-300">Status</a>
						<a href={withBase('/metrics')} class="transition hover:text-sky-300">Metrics</a>
						<a href={withBase('/debug')} class="transition hover:text-sky-300">Debug</a>
						<a
							href="https://github.com/unfoldingWord/translation-helps-mcp"
							target="_blank"
							rel="noopener"
							class="transition hover:text-sky-300">GitHub ↗</a
						>
					</nav>
				</div>
			</div>
		</footer>
	{/if}
</div>

<style>
	.safe-top {
		padding-top: env(safe-area-inset-top, 0px);
	}
</style>
