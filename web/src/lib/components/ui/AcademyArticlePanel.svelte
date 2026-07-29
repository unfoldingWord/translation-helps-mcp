<script lang="ts">
	/**
	 * AcademyArticlePanel — full Translation Academy article in the resources panel.
	 * Renders markdown with the same rc:// chip behavior as TranslationNoteCard.
	 */
	import { renderMarkdown, rcLinkDisplayName, rcLinkKind } from '$lib/renderMarkdown.js';
	import { type ResourcePayload } from '$lib/stores/studySession.js';

	export let path = '';
	export let title: string | undefined = undefined;
	export let markdown = '';
	export let language: string | undefined = undefined;
	export let onSelectResource: ((payload: ResourcePayload) => void) | undefined = undefined;

	$: displayTitle = title?.trim() || path.split('/').pop()?.replace(/-/g, ' ') || 'Article';

	function handleBodyClick(e: MouseEvent) {
		const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-rc]');
		if (!target) return;
		const uri = target.getAttribute('data-rc');
		if (!uri) return;
		const kind = rcLinkKind(uri);
		const label = target.textContent?.trim() || rcLinkDisplayName(uri);
		const payload: ResourcePayload =
			kind === 'tw'
				? { kind: 'word', word: { term: label, path: uri } }
				: { kind: 'article', article: { path: uri, title: label } };
		onSelectResource?.(payload);
	}
</script>

<div class="flex h-full flex-col bg-white">
	<div class="flex shrink-0 flex-col gap-1 border-b border-violet-200 bg-violet-50 px-3 py-2.5">
		<div class="flex items-center gap-2">
			<span
				class="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700"
			>
				TA
			</span>
			{#if language && language !== 'en'}
				<span class="rounded bg-violet-200/60 px-1.5 py-0.5 font-mono text-[10px] text-violet-700">
					{language}
				</span>
			{:else if language === 'en'}
				<span class="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-800">
					en
				</span>
			{/if}
		</div>
		<p class="font-semibold text-violet-900 capitalize">{displayTitle}</p>
		{#if path}
			<p class="font-mono text-[11px] text-violet-600/80">{path}</p>
		{/if}
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3" on:click={handleBodyClick}>
		{#if markdown}
			<div class="ta-prose">
				{@html renderMarkdown(markdown)}
			</div>
		{:else}
			<p class="text-sm text-gray-500">No article content.</p>
		{/if}
	</div>
</div>

<style>
	:global(.ta-prose) {
		color: #2a2a2a;
		font-size: 0.875rem;
		line-height: 1.6;
	}
	:global(.ta-prose h1),
	:global(.ta-prose h2),
	:global(.ta-prose h3),
	:global(.ta-prose h4) {
		font-family: var(--font-heading, inherit);
		font-weight: 600;
		color: #1f1f1f;
		line-height: 1.3;
	}
	:global(.ta-prose h1) {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
	:global(.ta-prose h2) {
		margin: 1.35rem 0 0.55rem;
		font-size: 0.95rem;
	}
	:global(.ta-prose h3) {
		margin: 1.1rem 0 0.45rem;
		font-size: 0.875rem;
	}
	:global(.ta-prose h4) {
		margin: 0.9rem 0 0.4rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b6560;
	}
	:global(.ta-prose h1:first-child),
	:global(.ta-prose h2:first-child),
	:global(.ta-prose h3:first-child),
	:global(.ta-prose h4:first-child) {
		margin-top: 0;
	}
	:global(.ta-prose p) {
		margin: 0.55rem 0;
	}
	:global(.ta-prose p:first-child) {
		margin-top: 0;
	}
	:global(.ta-prose p:last-child) {
		margin-bottom: 0;
	}
	:global(.ta-prose ul),
	:global(.ta-prose ol) {
		margin: 0.5rem 0;
		padding-left: 1.25rem;
	}
	:global(.ta-prose ul) {
		list-style: disc;
	}
	:global(.ta-prose ol) {
		list-style: decimal;
	}
	:global(.ta-prose li) {
		margin: 0.25rem 0;
	}
	:global(.ta-prose strong) {
		font-weight: 700;
		color: #1f1f1f;
	}
	:global(.ta-prose em) {
		font-style: italic;
		color: #85693e;
	}
	:global(.ta-prose blockquote) {
		margin: 0.5rem 0;
		padding-left: 0.75rem;
		border-left: 3px solid #c4b5fd;
		color: #4a463f;
		font-style: italic;
	}
	:global(.ta-prose hr) {
		margin: 0.75rem 0;
		border: none;
		border-top: 1px solid rgba(31, 31, 31, 0.12);
	}
	:global(.ta-prose code) {
		border-radius: 0.25rem;
		background: rgba(31, 31, 31, 0.06);
		padding: 0.1rem 0.3rem;
		font-size: 0.8em;
	}

	:global(.ta-prose .rc-link) {
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
	:global(.ta-prose .rc-link--ta) {
		color: #6d28d9;
		background: #f3e8ff;
		border-color: #d8b4fe;
	}
	:global(.ta-prose .rc-link--tw) {
		color: #1d4ed8;
		background: #dbeafe;
		border-color: #93c5fd;
	}
	:global(.ta-prose .rc-link--other) {
		color: #047857;
		background: #d1fae5;
		border-color: #6ee7b7;
	}
	:global(.ta-prose .rc-link:hover) {
		filter: brightness(0.95);
	}
	:global(.ta-prose .rc-link:focus-visible) {
		outline: 2px solid #7c3aed;
		outline-offset: 1px;
	}
</style>
