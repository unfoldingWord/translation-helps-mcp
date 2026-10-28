<script lang="ts">
	import { onMount } from 'svelte';
	import { Moon, Sun } from 'lucide-svelte';
	import { getTheme, setTheme, type Theme } from '$lib/theme';

	let theme = $state<Theme>('dark');
	onMount(() => (theme = getTheme()));

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		setTheme(theme);
	}
</script>

<button
	type="button"
	onclick={toggle}
	class="border-line text-ink-2 hover:border-line-strong hover:text-ink inline-flex h-8 w-8 items-center justify-center rounded-md border"
	aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
>
	{#if theme === 'dark'}<Sun size={16} />{:else}<Moon size={16} />{/if}
</button>
