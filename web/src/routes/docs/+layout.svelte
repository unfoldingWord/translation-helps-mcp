<script lang="ts">
	import { page } from '$app/stores';
	import { withBase } from '$lib/paths';
	import { BookOpen, Boxes, Layers, Plug, Terminal } from 'lucide-svelte';

	type NavItem = {
		path: string;
		label: string;
		exact?: boolean;
		icon: typeof Layers;
	};

	type NavGroup = {
		label: string;
		items: NavItem[];
	};

	const GROUPS: NavGroup[] = [
		{
			label: 'MCP',
			items: [
				{ path: '/docs', label: 'Overview', exact: true, icon: Layers },
				{ path: '/docs/mcp', label: 'Tools & prompts', icon: Plug }
			]
		},
		{
			label: 'Also available',
			items: [
				{ path: '/docs/sdks', label: 'Client SDKs', icon: BookOpen },
				{ path: '/docs/api', label: 'REST API', icon: Terminal },
				{ path: '/docs/library', label: 'Door43 library', icon: Boxes }
			]
		}
	];

	const FLAT = GROUPS.flatMap((g) => g.items);

	function active(path: string, exact: boolean | undefined, pathname: string): boolean {
		const href = withBase(path);
		if (exact) return pathname === href || pathname === `${href}/`;
		return pathname === href || pathname.startsWith(`${href}/`);
	}
</script>

<div
	class="relative min-h-[calc(100vh-8rem)] bg-[radial-gradient(ellipse_at_top,_rgba(178,145,89,0.08),_transparent_55%)]"
>
	<div class="mx-auto flex max-w-6xl gap-10 px-4 py-10 lg:px-6">
		<aside class="hidden w-60 shrink-0 md:block">
			<nav class="sticky top-20 space-y-6">
				<p class="px-3 text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
					Documentation
				</p>
				{#each GROUPS as group}
					<div class="space-y-1">
						<p
							class="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-slate-600 uppercase"
						>
							{group.label}
						</p>
						{#each group.items as { path, label, exact, icon: Icon }}
							{@const isOn = active(path, exact, $page.url.pathname)}
							<a
								href={withBase(path)}
								class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition
									{isOn
									? 'bg-sky-500/15 text-slate-100 ring-1 ring-sky-500/40'
									: 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'}"
							>
								<Icon class="h-4 w-4 shrink-0 {isOn ? 'text-sky-500' : 'text-slate-500'}" />
								{label}
							</a>
						{/each}
					</div>
				{/each}
			</nav>
		</aside>

		<div class="min-w-0 flex-1">
			<nav class="mb-8 flex gap-2 overflow-x-auto pb-1 md:hidden">
				{#each FLAT as { path, label, exact }}
					{@const isOn = active(path, exact, $page.url.pathname)}
					<a
						href={withBase(path)}
						class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition
							{isOn ? 'bg-sky-500/20 text-slate-100 ring-1 ring-sky-500/40' : 'bg-slate-800 text-slate-400'}"
					>
						{label}
					</a>
				{/each}
			</nav>

			<div class="docs-prose">
				<slot />
			</div>
		</div>
	</div>
</div>
