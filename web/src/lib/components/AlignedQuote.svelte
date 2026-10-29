<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { highlight, type HeroSlide } from '$lib/home/anatomy';

	/**
	 * Two uses:
	 * - `original` + `aligned`: one pair inline (the map of helps on the Try page);
	 * - `slides` + `verse`: the home page hero. The verse in Greek and English with one note's
	 *   two quotes marked and joined by a line, the note under it, and `facts` (what the server
	 *   returns for the verse) at the foot. It cycles note by note.
	 */
	let {
		original = '',
		aligned = '',
		slides = [],
		facts = [],
		verse,
		reference = '',
		labels = { original: 'Greek', translation: 'English' },
		interval = 7000
	}: {
		original?: string;
		aligned?: string;
		slides?: HeroSlide[];
		facts?: { text: string; href: string }[];
		verse?: { original: string; translation: string };
		reference?: string;
		labels?: { original: string; translation: string };
		interval?: number;
	} = $props();
	const rows = $derived(slides);

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

		<figcaption class="border-line mt-6 border-t pt-4">
			<div class="flex items-center justify-between gap-3">
				<p class="text-accent-2 font-mono text-[11px] tracking-wide uppercase">Translation note</p>
				<div class="flex items-center gap-1" role="group" aria-label="Notes on this verse">
					{#each rows as r, i (r.id)}
						<button
							type="button"
							class="flex h-6 w-6 items-center justify-center rounded-full"
							aria-label="Show the note on “{r.aligned}”"
							aria-pressed={i === at}
							onclick={() => show(i)}
						>
							<span
								class="block h-2 rounded-full transition-all motion-reduce:transition-none {i === at
									? 'bg-accent-2 w-5'
									: 'bg-line-strong w-2'}"
							></span>
						</button>
					{/each}
				</div>
			</div>
			<!-- Every note sits in the same cell, so the box keeps the height of the longest one. -->
			<div class="mt-2 grid">
				{#each rows as r, i (r.id)}
					<div
						class="[grid-area:1/1] {i === at ? '' : 'invisible'}"
						data-slide={i === at ? 'current' : undefined}
					>
						<p class="text-sm">
							<span lang="grc" class="text-accent-2 font-serif">{r.original}</span>
							<span class="text-ink-2" aria-hidden="true"> → </span>
							<span class="text-ink font-semibold">{r.aligned}</span>
						</p>
						<p class="text-ink mt-1.5 text-sm leading-relaxed" data-note>{r.lead}</p>
						{#if r.academy}
							<p class="text-ink-2 mt-1.5 text-xs">
								Academy topic: <span class="text-ink">{r.academy}</span>
							</p>
						{/if}
					</div>
				{/each}
			</div>
			<p class="text-ink-2 mt-2 font-mono text-[11px]">
				get_passage_index <span aria-hidden="true">→</span><span class="sr-only">, then</span> get_note
			</p>
			{#if facts.length}
				<ul
					class="border-line text-ink-2 mt-4 flex flex-wrap gap-x-2 gap-y-1 border-t pt-3 text-xs"
					aria-label="What the server returns for {reference}"
				>
					{#each facts as f, i (f.text)}
						<li>
							{#if i > 0}<span aria-hidden="true">·</span>{/if}
							<a class="hover:text-ink underline underline-offset-2" href={f.href}>{f.text}</a>
						</li>
					{/each}
				</ul>
			{/if}
		</figcaption>
	</figure>
{:else}
	<span class="inline-flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5">
		{#if aligned}<span class="text-ink">“{aligned}”</span>{/if}
		{#if original}<span class="text-ink-2 break-words" dir="auto">{original}</span>{/if}
	</span>
{/if}
