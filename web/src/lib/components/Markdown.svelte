<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let { source, onrc }: { source: string; onrc?: (uri: string) => void } = $props();
	const html = $derived(renderMarkdown(source));

	/** Door43 rc:// links come out as buttons; hand the address to the page, which decides what to open. */
	function click(e: MouseEvent) {
		const el = (e.target as Element).closest<HTMLElement>('[data-rc]');
		if (el?.dataset.rc && onrc) onrc(el.dataset.rc);
	}
</script>

<!-- Sanitized in renderMarkdown (DOMPurify). The click only reads a data attribute. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="prose" onclick={click}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>
