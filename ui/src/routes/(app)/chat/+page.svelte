<script>
	import ChatInterface from './ChatInterface.svelte';
</script>

<svelte:head>
	<title>TC Helps Chat - AI Bible Assistant | servant.bible</title>
	<meta
		name="description"
		content="Chat with our AI-powered Bible assistant. Access translation helps via TC Helps MCP server."
	/>
</svelte:head>

<div class="h-[calc(100svh-4rem)]" style="background-color: #0f172a;">
	<ChatInterface />
</div>

<style>
	/* Hide the global footer on the chat page so only the conversation scrolls */
	:global(footer) {
		display: none;
	}
</style>
