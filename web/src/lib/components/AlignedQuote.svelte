<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { highlight, type AlignmentRow } from '$lib/home/anatomy';

	/**
	 * Two uses:
	 * - `original` + `aligned`: one pair inline (the map of helps on the Try page);
	 * - `rows` + `verse`: the verse in Greek and English with each aligned phrase marked
	 *   and joined by a line, cycling through `rows` (the home page hero).
	 */
	let {
		original = '',
		aligned = '',
		rows = [],
		verse,
		reference = '',
		labels = { original: 'Greek', translation: 'English' },
		interval = 4200
	}: {
		original?: string;
		aligned?: string;
		rows?: AlignmentRow[];
		verse?: { original: string; translation: string };
		reference?: string;
		labels?: { original: string; translation: string };
		interval?: number;
	} = $props();

	let at = $state(0);
	let paused = $state(false);
	let box = $state<HTMLElement>();
	let lines = $state<string[]>([]);

	const row = $derived(rows.length ? rows[at % rows.length] : null);
	const top = $derived(verse && row ? highlight(verse.original, row.original) : []);
	const bottom = $derived(verse && row ? highlight(verse.translation, row.aligned) : []);

	/**
	 * Threads across the gap between the two verses: from under each marked Greek piece
	 * to above the English one. They stay in the gap, so they never cross the words.
	 */
	function measure() {
		if (!box) return;
		const origin = box.getBoundingClientRect();
		const upper = box.querySelector<HTMLElement>('[data-line="original"]');
		const lower = box.querySelector<HTMLElement>('[data-line="translation"]');
		const from = [...box.querySelectorAll<HTMLElement>('[data-mark="original"]')];
		const to = box.querySelector<HTMLElement>('[data-mark="translation"]');
		if (!upper || !lower || !to || !from.length) {
			lines = [];
			return;
		}
		const centre = (el: HTMLElement) => {
			const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
			return r.left + r.width / 2 - origin.left;
		};
		const y1 = upper.getBoundingClientRect().bottom - origin.top + 6;
		const y2 = lower.getBoundingClientRect().top - origin.top - 6;
		const x2 = centre(to);
		const mid = (y1 + y2) / 2;
		const n = (v: number) => v.toFixed(1);
		lines = from.map((el) => {
			const x1 = centre(el);
			return `M ${n(x1)} ${n(y1)} C ${n(x1)} ${n(mid)}, ${n(x2)} ${n(mid)}, ${n(x2)} ${n(y2)}`;
		});
	}

	function show(i: number) {
		at = i;
	}

	$effect(() => {
		void at;
		if (!verse) return;
		void tick().then(measure);
	});

	onMount(() => {
		if (!verse || !box) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(box);
		// Fonts change the width of the words; measure again once they are in.
		void document.fonts?.ready.then(measure);
		const still = window.matchMedia('(prefers-reduced-motion: reduce)');
		const timer = setInterval(() => {
			if (paused || still.matches || document.hidden || rows.length < 2) return;
			at = (at + 1) % rows.length;
		}, interval);
		return () => {
			ro.disconnect();
			clearInterval(timer);
		};
	});
</script>

{#if verse && row}
	<figure
		bind:this={box}
		class="aligned border-line bg-surface relative rounded-xl border p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)] sm:p-7"
		onmouseenter={() => (paused = true)}
		onmouseleave={() => (paused = false)}
		onfocusin={() => (paused = true)}
		onfocusout={() => (paused = false)}
	>
		<svg
			class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
			aria-hidden="true"
		>
			{#each lines as d, i (i)}
				<path {d} class="stroke-accent-2" fill="none" stroke-width="1.5" stroke-linecap="round" />
				<circle cx={d.split(' ')[1]} cy={d.split(' ')[2]} r="2.5" class="fill-accent-2" />
			{/each}
		</svg>

		<div class="text-ink-2 flex items-baseline justify-between gap-3 text-xs">
			<span class="text-ink font-semibold">{reference}</span>
			<span>{labels.original} <span aria-hidden="true">→</span> {labels.translation}</span>
		</div>
		<p
			data-line="original"
			lang="grc"
			class="text-ink mt-2 font-serif text-xl leading-[1.9] sm:text-[1.65rem]"
		>
			{#each top as p, i (i)}{#if p.mark}<mark
						data-mark="original"
						class="text-accent-2 decoration-accent-2 bg-transparent underline decoration-2 underline-offset-[6px]"
						>{p.text}</mark
					>{:else}{p.text}{/if}{/each}
		</p>

		<p
			data-line="translation"
			class="text-ink mt-12 font-serif text-lg leading-[1.8] sm:mt-14 sm:text-xl"
		>
			{#each bottom as p, i (i)}{#if p.mark}<mark
						data-mark="translation"
						class="bg-accent/15 text-ink rounded-sm px-0.5 font-semibold">{p.text}</mark
					>{:else}{p.text}{/if}{/each}
		</p>

		<figcaption
			class="border-line mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
		>
			<p class="min-w-0 text-sm">
				<span lang="grc" class="text-accent-2 font-serif">{row.original}</span>
				<span class="text-ink-2" aria-hidden="true"> → </span>
				<span class="text-ink font-semibold">{row.aligned}</span>
			</p>
			<div class="flex items-center gap-1.5" role="group" aria-label="Aligned phrases">
				{#each rows as r, i (r.original)}
					<button
						type="button"
						class="flex h-6 w-6 items-center justify-center rounded-full"
						aria-label="Show “{r.aligned}”"
						aria-pressed={i === at}
						onclick={() => show(i)}
					>
						<span
							class="block h-2 rounded-full transition-all {i === at
								? 'bg-accent-2 w-5'
								: 'bg-line-strong w-2'}"
						></span>
					</button>
				{/each}
			</div>
		</figcaption>
	</figure>
{:else}
	<span class="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
		{#if aligned}<span class="text-ink">“{aligned}”</span>{/if}
		{#if original}<span class="text-ink-2 break-words" dir="auto">{original}</span>{/if}
	</span>
{/if}
