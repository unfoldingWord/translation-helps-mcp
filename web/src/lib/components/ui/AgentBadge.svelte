<script lang="ts">
	/**
	 * AgentBadge — identity chip for Guide / Scholar / Checker agents.
	 * Earthy light chips: gold / taupe / terracotta.
	 */
	import Compass from 'lucide-svelte/icons/compass';
	import GraduationCap from 'lucide-svelte/icons/graduation-cap';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';

	export let agent: 'guide' | 'scholar' | 'checker';
	export let size: 'sm' | 'md' = 'sm';

	const CONFIG = {
		guide: {
			label: 'Guide',
			icon: Compass,
			classes: 'border-sky-300 bg-sky-50 text-sky-800'
		},
		scholar: {
			label: 'Scholar',
			icon: GraduationCap,
			classes: 'border-amber-300 bg-amber-50 text-amber-900'
		},
		checker: {
			label: 'Checker',
			icon: ShieldCheck,
			classes: 'border-emerald-300 bg-emerald-50 text-emerald-800'
		}
	} as const;

	$: cfg = CONFIG[agent];
	$: Icon = cfg.icon;
	$: pad = size === 'md' ? 'px-2 py-1 gap-1.5' : 'px-1.5 py-0.5 gap-1';
	$: iconSize = size === 'md' ? 14 : 12;
	$: textSize = size === 'md' ? 'text-xs' : 'text-[10px]';
</script>

<span
	class="inline-flex items-center rounded-full border font-medium tracking-wide {pad} {textSize} {cfg.classes}"
	title={cfg.label}
>
	<Icon size={iconSize} strokeWidth={2.25} class="shrink-0" aria-hidden="true" />
	<span>{cfg.label}</span>
</span>
