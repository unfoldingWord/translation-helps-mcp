<script lang="ts">
	/**
	 * ScripturePanel — renders multiple scripture versions side by side (desktop) or
	 * stacked (mobile). Optionally highlights a specific phrase across all versions.
	 *
	 * UGNT/UHB (Greek/Hebrew original-language texts) receive distinct visual treatment
	 * and right-to-left text direction.
	 */

	interface VerseEntry {
		label: string;
		text: string;
	}

	/** Scripture versions to display */
	export let verses: VerseEntry[] = [];
	/** If provided, highlight this phrase in every version where it appears */
	export let highlightPhrase: string | undefined = undefined;

	const ORIGINAL_LANG = new Set(['UGNT', 'UHB']);

	/** HTML-escape a raw string so it is safe to inject via {@html}. */
	function escapeHtml(str: string): string {
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * Return HTML for a verse text, wrapping any occurrence of `highlightPhrase`
	 * in a <mark> span (case-insensitive). The text is HTML-escaped first so we
	 * only inject safe content via {@html}.
	 */
	function getVerseHtml(text: string): string {
		const escaped = escapeHtml(text);
		if (!highlightPhrase) return escaped;

		// Escape the phrase for both HTML entities and regex meta-chars
		const escapedPhrase = escapeHtml(highlightPhrase);
		const regexSafe = escapedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		return escaped.replace(
			new RegExp(`(${regexSafe})`, 'gi'),
			'<mark class="bg-yellow-300/80 text-yellow-900 rounded-sm px-0.5 dark:bg-yellow-600/80 dark:text-yellow-100">$1</mark>'
		);
	}

	$: gridClass =
		verses.length <= 2
			? 'grid-cols-1 sm:grid-cols-2'
			: verses.length === 3
				? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
				: 'grid-cols-1 sm:grid-cols-2';
</script>

<div class="mt-3 rounded-xl border border-gray-700 bg-gray-800/50 p-3">
	<!-- Section header -->
	<div class="mb-2 flex items-center gap-2">
		<p class="text-xs font-semibold tracking-wider text-gray-500 uppercase">📖 Scripture</p>
		{#if highlightPhrase}
			<span class="rounded-full bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-400">
				highlighting: "<span class="font-semibold italic">{highlightPhrase}</span>"
			</span>
		{/if}
	</div>

	<!-- Version grid -->
	<div class="grid gap-2.5 {gridClass}">
		{#each verses as verse}
			{@const isOriginal = ORIGINAL_LANG.has(verse.label)}
			<div
				class="rounded-lg border px-3 py-2.5
					{isOriginal ? 'border-amber-700/40 bg-amber-950/30' : 'border-gray-700/60 bg-gray-900/60'}"
			>
				<!-- Label row -->
				<div class="mb-1.5 flex items-center gap-1.5">
					<span
						class="rounded px-1.5 py-0.5 text-xs font-bold tracking-wide
							{isOriginal ? 'bg-amber-900/80 text-amber-300' : 'bg-indigo-900/80 text-indigo-300'}"
					>
						{verse.label}
					</span>
					{#if isOriginal}
						<span class="text-xs text-amber-500/60">Original Language</span>
					{/if}
				</div>

				<!-- Verse text -->
				<p
					class="text-sm leading-relaxed text-gray-200
						{isOriginal ? 'font-serif tracking-wide' : ''}"
					dir={isOriginal ? 'rtl' : 'ltr'}
					lang={verse.label === 'UGNT' ? 'el' : verse.label === 'UHB' ? 'he' : undefined}
				>
					{@html getVerseHtml(verse.text)}
				</p>
			</div>
		{/each}
	</div>
</div>
