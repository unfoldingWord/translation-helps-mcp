<script context="module" lang="ts">
	export interface RcLinkSelection {
		uri: string;
		label: string;
		kind: 'ta' | 'tw' | 'other';
	}
</script>

<script lang="ts">
	/**
	 * TranslationNoteCard — a rich card for a single translation note.
	 *
	 * Shows the original-language quote at the top, a category pill,
	 * a markdown-rendered note body (with Door43 [[rc://]] links), and an optional TA link.
	 *
	 * rc:// links (TA articles, TW terms) don't resolve to a public URL, so they're
	 * rendered as in-app chips (see renderMarkdown.ts). Clicking one asks the assistant
	 * to explain that specific article/term in chat instead of dead-ending on a 404.
	 */

	import { renderMarkdown, rcLinkDisplayName, rcLinkKind } from '$lib/renderMarkdown.js';

	interface Note {
		id: string;
		quote?: string;
		gatewayQuote?: { original?: string; aligned?: string };
		noteText: string;
		supportReference?: string;
		category?: string;
		verse?: string;
	}

	export let note: Note;

	/**
	 * Heading shows the alignment-resolved gateway-language quote when
	 * available (users shouldn't read raw Greek/Hebrew); falls back to the
	 * original-language quote. When both exist the original is kept as a
	 * smaller secondary line for reference.
	 */
	$: displayQuote = note.gatewayQuote?.aligned?.trim() || note.quote || '';
	$: originalQuote =
		note.gatewayQuote?.aligned?.trim() && (note.gatewayQuote?.original || note.quote)
			? (note.gatewayQuote?.original ?? note.quote ?? '')
			: '';
	export let selected = false;
	export let threadCount = 0;
	export let onSelect: ((note: Note) => void) | undefined = undefined;
	export let onLinkSelect: ((rc: RcLinkSelection) => void) | undefined = undefined;

	function taLinkLabel(ref: string): string {
		const match = ref.match(/([^/]+)$/);
		return match ? match[1].replace(/-/g, ' ') : ref;
	}

	const CATEGORY_COLORS: Record<string, string> = {
		'figs-metaphor': 'bg-sky-100 text-sky-800',
		'figs-simile': 'bg-sky-100 text-sky-800',
		'figs-idiom': 'bg-amber-100 text-amber-900',
		'figs-parallelism': 'bg-amber-100 text-amber-900',
		'figs-personification': 'bg-sky-100 text-sky-800',
		'figs-synecdoche': 'bg-sky-100 text-sky-800',
		'figs-explicit': 'bg-emerald-100 text-emerald-800',
		'figs-extrainfo': 'bg-emerald-100 text-emerald-800',
		'grammar-connect': 'bg-emerald-100 text-emerald-800',
		'translate-names': 'bg-amber-100 text-amber-900',
		'translate-unknown': 'bg-amber-100 text-amber-900',
		'writing-background': 'bg-[var(--bt-parchment)] text-[var(--bt-muted)]',
		'Book intro': 'bg-sky-100 text-sky-800',
		'Chapter intro': 'bg-sky-100 text-sky-800'
	};

	function categoryColor(cat?: string): string {
		if (!cat) return 'bg-gray-200 text-gray-600';
		if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
		for (const [key, cls] of Object.entries(CATEGORY_COLORS)) {
			if (cat.toLowerCase().includes(key.toLowerCase())) return cls;
		}
		return 'bg-gray-200 text-gray-600';
	}

	function handleSelect() {
		onSelect?.(note);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleSelect();
		}
	}

	/** Delegated click handler for rc:// link chips rendered inside the markdown body. */
	function handleBodyClick(e: MouseEvent) {
		e.stopPropagation();
		const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-rc]');
		if (!target) return;
		const uri = target.getAttribute('data-rc');
		if (!uri) return;
		onLinkSelect?.({
			uri,
			label: target.textContent?.trim() || rcLinkDisplayName(uri),
			kind: rcLinkKind(uri)
		});
	}

	function handleSupportRefClick(e: MouseEvent) {
		e.stopPropagation();
		if (!note.supportReference) return;
		onLinkSelect?.({
			uri: note.supportReference,
			label: taLinkLabel(note.supportReference),
			kind: rcLinkKind(note.supportReference)
		});
	}
</script>

<!--
  Use a div (not a wrapping <button>) so markdown links/chips inside the body are
  valid HTML and remain clickable — same idea as tc-study's note cards.
-->
<div
	role="button"
	tabindex="0"
	on:click={handleSelect}
	on:keydown={handleKeydown}
	class="relative w-full rounded-lg border text-left text-sm transition-all
		{selected
		? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/30'
		: 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'}"
>
	{#if threadCount > 0}
		<span
			class="absolute top-2 right-2 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1 text-xs font-bold text-white"
		>
			{threadCount}
		</span>
	{/if}

	{#if displayQuote}
		<div class="rounded-t-lg border-b border-amber-200 bg-amber-50 px-3 py-2">
			<div class="mb-1 flex items-center gap-2">
				{#if note.verse}
					<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
						v.{note.verse}
					</span>
				{/if}
				{#if note.category}
					<span class="rounded-full px-2 py-0.5 text-xs font-medium {categoryColor(note.category)}">
						{note.category}
					</span>
				{/if}
			</div>
			<p class="font-medium text-amber-900 italic">"{displayQuote}"</p>
			{#if originalQuote}
				<p class="mt-0.5 text-xs text-amber-700/80">{originalQuote}</p>
			{/if}
		</div>
	{:else if note.verse || note.category}
		<div class="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5">
			{#if note.verse}
				<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
					v.{note.verse}
				</span>
			{/if}
			{#if note.category}
				<span class="rounded-full px-2 py-0.5 text-xs font-medium {categoryColor(note.category)}">
					{note.category}
				</span>
			{/if}
		</div>
	{/if}

	<!-- stopPropagation so clicking links / chips / selecting text doesn't toggle card selection -->
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div class="note-body px-3 py-3" on:click={handleBodyClick}>
		<div class="tn-prose">
			{@html renderMarkdown(note.noteText)}
		</div>

		{#if note.supportReference && note.supportReference.includes('ta/')}
			<div class="mt-3 flex items-center gap-1.5">
				<button
					type="button"
					class="rc-link rc-link--ta"
					title={note.supportReference}
					on:click={handleSupportRefClick}
				>
					{taLinkLabel(note.supportReference)}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Scoped markdown typography for note bodies — deliberately not using the
	   Tailwind Typography plugin (not registered app-wide) so headings/lists get
	   real spacing + correct contrast on this light card, independent of the
	   brand's remapped slate/sky palette. */
	:global(.tn-prose) {
		color: #2a2a2a;
		font-size: 0.875rem;
		line-height: 1.6;
	}
	:global(.tn-prose h1),
	:global(.tn-prose h2),
	:global(.tn-prose h3),
	:global(.tn-prose h4) {
		font-family: var(--font-heading, inherit);
		font-weight: 600;
		color: #1f1f1f;
		line-height: 1.3;
	}
	:global(.tn-prose h1) {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
	:global(.tn-prose h2) {
		margin: 1.35rem 0 0.55rem;
		font-size: 0.95rem;
	}
	:global(.tn-prose h3) {
		margin: 1.1rem 0 0.45rem;
		font-size: 0.875rem;
	}
	:global(.tn-prose h4) {
		margin: 0.9rem 0 0.4rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b6560;
	}
	:global(.tn-prose h1:first-child),
	:global(.tn-prose h2:first-child),
	:global(.tn-prose h3:first-child),
	:global(.tn-prose h4:first-child) {
		margin-top: 0;
	}
	:global(.tn-prose p) {
		margin: 0.55rem 0;
	}
	:global(.tn-prose p:first-child) {
		margin-top: 0;
	}
	:global(.tn-prose p:last-child) {
		margin-bottom: 0;
	}
	:global(.tn-prose ul),
	:global(.tn-prose ol) {
		margin: 0.5rem 0;
		padding-left: 1.25rem;
	}
	:global(.tn-prose ul) {
		list-style: disc;
	}
	:global(.tn-prose ol) {
		list-style: decimal;
	}
	:global(.tn-prose li) {
		margin: 0.25rem 0;
	}
	:global(.tn-prose strong) {
		font-weight: 700;
		color: #1f1f1f;
	}
	:global(.tn-prose em) {
		font-style: italic;
		color: #85693e;
	}
	:global(.tn-prose blockquote) {
		margin: 0.5rem 0;
		padding-left: 0.75rem;
		border-left: 3px solid #d4bc8a;
		color: #4a463f;
		font-style: italic;
	}
	:global(.tn-prose hr) {
		margin: 0.75rem 0;
		border: none;
		border-top: 1px solid rgba(31, 31, 31, 0.12);
	}
	:global(.tn-prose code) {
		border-radius: 0.25rem;
		background: rgba(31, 31, 31, 0.06);
		padding: 0.1rem 0.3rem;
		font-size: 0.8em;
	}

	/* rc:// chips — in-app buttons, not real links (see renderMarkdown.ts). */
	:global(.rc-link) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0 0.1rem;
		padding: 0.1rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.35;
		vertical-align: baseline;
		border: 1px solid transparent;
		cursor: pointer;
		transition: filter 0.15s ease;
	}
	:global(.rc-link--ta) {
		color: #85693e;
		background: #f5efe3;
		border-color: #d4bc8a;
	}
	:global(.rc-link--tw) {
		color: #8f5234;
		background: #faf4ef;
		border-color: #e0c4a8;
	}
	:global(.rc-link--other) {
		color: #6b6560;
		background: #f5f2ea;
		border-color: #ddd6c8;
	}
	:global(.rc-link:hover) {
		filter: brightness(0.95);
	}
	:global(.rc-link:focus-visible) {
		outline: 2px solid #b29159;
		outline-offset: 1px;
	}
</style>
