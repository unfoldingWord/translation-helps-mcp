<script lang="ts">
	import type { Snippet } from 'svelte';
	let { tone = 'note', children }: { tone?: 'note' | 'warn'; children: Snippet } = $props();
</script>

<div
	class="rounded-md border px-3.5 py-2.5 text-sm {tone === 'warn'
		? 'border-danger/60 text-ink'
		: 'border-line-strong text-ink-2'}"
	role={tone === 'warn' ? 'alert' : 'note'}
>
	{@render children()}
</div>
