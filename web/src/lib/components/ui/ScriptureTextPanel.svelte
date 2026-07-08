<script lang="ts">
	/**
	 * ScriptureTextPanel — tabbed scripture viewer for the resource workbench.
	 *
	 * Displays multiple Bible versions with a tab bar for switching.
	 * Supports RTL text for original language (UGNT/UHB) versions.
	 * Optionally highlights a specific phrase.
	 */

	interface Version {
		label: string;
		text: string;
		direction?: 'ltr' | 'rtl';
		resourceType?: string;
	}

	export let reference = '';
	export let versions: Version[] = [];
	export let highlightPhrase: string | undefined = undefined;

	let activeVersion = 0;

	$: if (versions.length && activeVersion >= versions.length) activeVersion = 0;

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

	function getVerseHtml(text: string): string {
		const escaped = escapeHtml(text);
		if (!highlightPhrase) return escaped;
		const escapedPhrase = escapeHtml(highlightPhrase);
		const regexSafe = escapedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return escaped.replace(
			new RegExp(`(${regexSafe})`, 'gi'),
			'<mark class="bg-yellow-300/80 text-yellow-900 rounded-sm px-0.5">$1</mark>'
		);
	}

	function tabClass(i: number): string {
		const base = 'px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap';
		if (i === activeVersion) {
			const v = versions[i];
			return `${base} ${isOriginal(v) ? 'border-b-2 border-amber-500 text-amber-300' : 'border-b-2 border-indigo-500 text-indigo-300'}`;
		}
		return `${base} text-gray-500 hover:text-gray-300`;
	}
</script>

<div class="flex h-full flex-col">
	<!-- Reference bar -->
	<div class="flex shrink-0 items-center justify-between border-b border-gray-700/60 px-3 py-2">
		<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">📖 Scripture</p>
		{#if reference}
			<span class="rounded bg-indigo-950 px-2 py-0.5 font-mono text-xs text-indigo-300">
				{reference}
			</span>
		{/if}
	</div>

	<!-- Highlight indicator -->
	{#if highlightPhrase}
		<div class="shrink-0 border-b border-gray-700/40 bg-yellow-950/20 px-3 py-1.5">
			<span class="text-xs text-yellow-400">
				Highlighting: "<span class="font-semibold italic">{highlightPhrase}</span>"
			</span>
		</div>
	{/if}

	<!-- Version tabs -->
	{#if versions.length > 1}
		<div class="flex shrink-0 gap-0 overflow-x-auto border-b border-gray-700/40">
			{#each versions as v, i}
				<button class={tabClass(i)} on:click={() => (activeVersion = i)}>
					{v.label}
					{#if isOriginal(v)}
						<span class="ml-1 text-amber-500/60">†</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Active version text -->
	<div class="flex-1 overflow-y-auto p-3">
		{#if versions.length === 0}
			<div class="flex flex-col items-center justify-center py-12 text-center text-gray-500">
				<p class="text-2xl">📖</p>
				<p class="mt-2 text-sm">No scripture loaded</p>
			</div>
		{:else}
			{@const v = versions[activeVersion] ?? versions[0]}
			<div
				class="rounded-lg border px-4 py-3 text-sm leading-relaxed
					{isOriginal(v)
					? 'border-amber-700/30 bg-amber-950/20 font-serif tracking-wide text-amber-100'
					: 'border-gray-700/40 bg-gray-900/40 text-gray-200'}"
				dir={v.direction ?? (isOriginal(v) ? 'rtl' : 'ltr')}
				lang={v.label === 'UGNT' ? 'el' : v.label === 'UHB' ? 'he' : undefined}
			>
				{@html getVerseHtml(v.text)}
			</div>

			<!-- Version label badge below text -->
			<div class="mt-2 flex items-center gap-1.5">
				<span
					class="rounded px-2 py-0.5 text-xs font-semibold
						{isOriginal(v) ? 'bg-amber-900/60 text-amber-300' : 'bg-indigo-900/60 text-indigo-300'}"
				>
					{v.label}
				</span>
				{#if isOriginal(v)}
					<span class="text-xs text-amber-500/60">Original Language</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
