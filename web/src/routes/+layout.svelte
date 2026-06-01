<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';

	const NAV = [
		{ href: '/', label: 'Home' },
		{ href: '/playground', label: 'Playground' },
		{ href: '/docs', label: 'Docs' },
		{ href: '/metrics', label: 'Metrics' }
	];
</script>

<div class="flex min-h-screen flex-col bg-gray-950 text-gray-100">
	<header class="sticky top-0 z-50 border-b border-gray-800 bg-gray-900/80 backdrop-blur">
		<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
			<a href="/" class="flex items-center gap-2 text-lg font-bold">
				<span class="text-2xl">📖</span>
				<span class="text-white">Translation Helps MCP</span>
				<span class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-400">v2</span>
			</a>
			<nav class="flex items-center gap-1">
				{#each NAV as { href, label }}
					<a
						{href}
						class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              {$page.url.pathname === href
							? 'bg-indigo-600 text-white'
							: 'text-gray-400 hover:bg-gray-800 hover:text-white'}"
					>
						{label}
					</a>
				{/each}
				<a
					href="https://github.com/unfoldingWord/translation-helps-mcp"
					target="_blank"
					rel="noopener"
					class="ml-2 rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
				>
					GitHub ↗
				</a>
			</nav>
		</div>
	</header>

	<main class="flex-1">
		<slot />
	</main>

	<footer class="border-t border-gray-800 py-6 text-center text-sm text-gray-500">
		Translation Helps MCP v2 · unfoldingWord ·
		<a href="/docs" class="underline hover:text-gray-300">Docs</a>
	</footer>
</div>
