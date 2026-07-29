<script lang="ts">
	import { page } from '$app/stores';
	import { withBase } from '$lib/paths';

	const TABS = [
		{ path: '/status', label: 'Status' },
		{ path: '/metrics', label: 'Metrics' },
		{ path: '/debug', label: 'Debug' }
	] as const;

	function isOn(path: string, pathname: string): boolean {
		const href = withBase(path);
		return pathname === href || pathname.startsWith(`${href}/`);
	}
</script>

<div class="border-b border-slate-800/90 bg-slate-950/60">
	<div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
		<p class="text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">System</p>
		<nav class="flex gap-2 overflow-x-auto" aria-label="System pages">
			{#each TABS as { path, label }}
				{@const on = isOn(path, $page.url.pathname)}
				<a
					href={withBase(path)}
					class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition
						{on
						? 'bg-sky-500/20 text-slate-100 ring-1 ring-sky-500/40'
						: 'bg-white text-slate-400 ring-1 ring-slate-800 hover:text-slate-100'}"
				>
					{label}
				</a>
			{/each}
		</nav>
	</div>
</div>

<slot />
