<script lang="ts">
	/**
	 * ScriptureTextPanel — tabbed scripture viewer for the resource workbench.
	 *
	 * Displays multiple Bible versions with a tab bar for switching.
	 * Supports RTL text for original language (UGNT/UHB) versions.
	 * Optionally highlights a specific phrase and marks challenge phrases as clickable.
	 */

	import BookOpen from 'lucide-svelte/icons/book-open';
	import type { ChallengeItem } from '$lib/stores/studySession.js';

	interface Version {
		label: string;
		text: string;
		direction?: 'ltr' | 'rtl';
		resourceType?: string;
	}

	export let reference = '';
	export let versions: Version[] = [];
	export let highlightPhrase: string | undefined = undefined;
	export let challenges: ChallengeItem[] = [];
	export let exploredIndices: number[] = [];
	export let selectedPhrase: string | undefined = undefined;
	export let onSelectChallenge: ((c: ChallengeItem) => void) | undefined = undefined;

	let activeVersion = 0;

	$: if (versions.length && activeVersion >= versions.length) activeVersion = 0;
	$: exploredSet = new Set(exploredIndices);
	$: selected = selectedPhrase ?? highlightPhrase;

	const ORIGINAL_LABELS = new Set(['UGNT', 'UHB']);

	function isOriginal(v: Version): boolean {
		return ORIGINAL_LABELS.has(v.label) || v.direction === 'rtl';
	}

	/** HTML-escape a string for safe injection. */
	function escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/**
	 * Build verse HTML with clickable challenge phrases.
	 * Longer phrases first to avoid partial overlaps.
	 */
	function getVerseHtml(text: string): string {
		const escaped = escapeHtml(text);
		const clickable = challenges
			.filter((c) => c.phrase && c.phrase.trim().length > 0)
			.slice()
			.sort((a, b) => b.phrase.length - a.phrase.length);

		if (clickable.length === 0 && !selected) return escaped;

		type Span = { start: number; end: number; challenge?: ChallengeItem; selected?: boolean };
		const spans: Span[] = [];

		function overlaps(a: number, b: number): boolean {
			return spans.some((s) => a < s.end && b > s.start);
		}

		if (selected) {
			const esc = escapeHtml(selected);
			const re = new RegExp(escapeRegex(esc), 'gi');
			let m: RegExpExecArray | null;
			while ((m = re.exec(escaped)) !== null) {
				spans.push({ start: m.index, end: m.index + m[0].length, selected: true });
			}
		}

		for (const c of clickable) {
			const esc = escapeHtml(c.phrase);
			const re = new RegExp(escapeRegex(esc), 'gi');
			let m: RegExpExecArray | null;
			while ((m = re.exec(escaped)) !== null) {
				const start = m.index;
				const end = start + m[0].length;
				if (overlaps(start, end)) continue;
				spans.push({ start, end, challenge: c });
			}
		}

		spans.sort((a, b) => a.start - b.start);

		if (spans.length === 0) return escaped;

		let out = '';
		let cursor = 0;
		for (const s of spans) {
			if (s.start > cursor) out += escaped.slice(cursor, s.start);
			const chunk = escaped.slice(s.start, s.end);
			if (s.selected) {
				out += `<mark class="bg-sky-200 text-[var(--bt-black)] rounded-sm px-0.5">${chunk}</mark>`;
			} else if (s.challenge) {
				const explored = exploredSet.has(s.challenge.index);
				const cls = explored
					? 'challenge-phrase explored inline underline decoration-dotted decoration-sky-500/70 bg-sky-100 text-sky-900 rounded-sm cursor-pointer appearance-none border-0 p-0 font-inherit'
					: 'challenge-phrase inline underline decoration-dotted decoration-sky-600/80 hover:bg-sky-100 rounded-sm cursor-pointer appearance-none border-0 bg-transparent p-0 font-inherit text-[var(--bt-black)]';
				out += `<button type="button" class="${cls}" data-challenge-index="${s.challenge.index}" aria-label="Explore: ${escapeHtml(s.challenge.phrase)}">${chunk}</button>`;
			}
			cursor = s.end;
		}
		if (cursor < escaped.length) out += escaped.slice(cursor);
		return out;
	}

	function onVerseClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		const btn = target?.closest?.('[data-challenge-index]') as HTMLElement | null;
		if (!btn || !onSelectChallenge) return;
		const idx = Number(btn.getAttribute('data-challenge-index'));
		if (Number.isNaN(idx)) return;
		const c = challenges.find((ch) => ch.index === idx);
		if (c) onSelectChallenge(c);
	}

	function tabClass(i: number): string {
		const base = 'px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap';
		if (i === activeVersion) {
			const v = versions[i];
			return `${base} ${isOriginal(v) ? 'border-b-2 border-amber-600 text-amber-800' : 'border-b-2 border-sky-500 text-sky-800'}`;
		}
		return `${base} text-[var(--bt-taupe)] hover:text-[var(--bt-black)]`;
	}

	$: verseHtml = versions.length ? getVerseHtml((versions[activeVersion] ?? versions[0]).text) : '';
</script>

<div class="flex h-full flex-col bg-[var(--bt-parchment)]">
	<!-- Reference bar -->
	<div
		class="flex shrink-0 items-center justify-between border-b border-[var(--bt-border)] px-3 py-2"
	>
		<p
			class="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-[var(--bt-taupe)] uppercase"
		>
			<BookOpen size={14} strokeWidth={2} class="text-sky-600" />
			Scripture
		</p>
		{#if reference}
			<span
				class="rounded bg-[var(--bt-black)] px-2 py-0.5 font-mono text-xs text-[var(--bt-cream)]"
			>
				{reference}
			</span>
		{/if}
	</div>

	<!-- Highlight indicator -->
	{#if selected}
		<div class="shrink-0 border-b border-sky-200 bg-sky-50 px-3 py-1.5">
			<span class="text-xs text-sky-800">
				Highlighting: "<span class="font-semibold italic">{selected}</span>"
			</span>
		</div>
	{/if}

	<!-- Version tabs -->
	{#if versions.length > 1}
		<div class="flex shrink-0 gap-0 overflow-x-auto border-b border-[var(--bt-border)] bg-white/60">
			{#each versions as v, i}
				<button type="button" class={tabClass(i)} on:click={() => (activeVersion = i)}>
					{v.label}
					{#if isOriginal(v)}
						<span class="ml-1 text-amber-600/70">†</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Active version text -->
	<div class="flex-1 overflow-y-auto p-3">
		{#if versions.length === 0}
			<div
				class="flex flex-col items-center justify-center py-12 text-center text-[var(--bt-taupe)]"
			>
				<BookOpen size={28} strokeWidth={1.5} class="opacity-40" />
				<p class="mt-2 text-sm">No scripture loaded</p>
			</div>
		{:else}
			{@const v = versions[activeVersion] ?? versions[0]}
			<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
			<div
				class="rounded-lg border px-4 py-3 text-sm leading-relaxed
					{isOriginal(v)
					? 'border-amber-200 bg-amber-50/80 font-serif tracking-wide text-amber-950'
					: 'border-[var(--bt-border)] bg-white text-[var(--bt-black)]'}"
				dir={v.direction ?? (isOriginal(v) ? 'rtl' : 'ltr')}
				lang={v.label === 'UGNT' ? 'el' : v.label === 'UHB' ? 'he' : undefined}
				on:click={onVerseClick}
			>
				{@html verseHtml}
			</div>

			<!-- Version label badge below text -->
			<div class="mt-2 flex items-center gap-1.5">
				<span
					class="rounded px-2 py-0.5 text-xs font-semibold
						{isOriginal(v) ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-800'}"
				>
					{v.label}
				</span>
				{#if isOriginal(v)}
					<span class="text-xs text-amber-700/70">Original Language</span>
				{/if}
				{#if challenges.length > 0}
					<span class="ml-auto text-xs text-[var(--bt-taupe)]">
						Tap underlined phrases to explore
					</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
