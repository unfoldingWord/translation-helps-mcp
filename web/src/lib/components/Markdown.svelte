<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let {
		source,
		follow,
		onrc
	}: {
		source: string;
		/** Which Door43 links (rc://… or relative) the page can open. The others show as text. */
		follow?: (href: string) => boolean;
		onrc?: (href: string) => void;
	} = $props();
	const html = $derived(renderMarkdown(source, onrc ? follow : undefined));

	/** Door43 links the page can open come out as buttons; hand the address to the page. */
	function click(e: MouseEvent) {
		const el = (e.target as Element).closest<HTMLElement>('[data-rc]');
		const href = el?.dataset.rc;
		// Only an address the page said it can open: the HTML came from the server.
		if (href && onrc && follow?.(href)) onrc(href);
	}
</script>

<!-- Sanitized in renderMarkdown (DOMPurify). The links inside are real buttons, so keys work. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="prose" onclick={click}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>
