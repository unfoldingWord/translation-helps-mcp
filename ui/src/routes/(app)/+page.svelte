<script lang="ts">
	import { VERSION } from '$lib/version.js';
	import { onMount } from 'svelte';

	let version = '';

	onMount(() => {
		version = VERSION;
	});
</script>

<svelte:head>
	<title>TC Helps - Translation Core Helps MCP Server | servant.bible</title>
	<meta
		name="description"
		content="MCP server and clients for developers working with Bible translation resources. Access translation helps via Model Context Protocol."
	/>
	<meta
		name="keywords"
		content="MCP server, Model Context Protocol, Bible translation, translation helps, translation notes, translation words, MCP client, servant.bible, TC Helps"
	/>
</svelte:head>

<div class="container mx-auto px-4 py-8">
	<!-- Hero Section -->
	<section class="mb-16 text-center">
		<div
			class="mb-4 inline-block rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-300 backdrop-blur-xl"
		>
			Translation Core Helps
		</div>
		<h1 class="mb-8 text-5xl font-bold text-white md:text-6xl">
			<span class="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
				TC Helps
			</span>
			<br />
			<span class="text-gray-300">MCP Server & Clients</span>
		</h1>
		<p class="mx-auto mb-8 max-w-4xl text-xl leading-relaxed text-gray-300">
			MCP server and clients for <strong class="text-blue-300"
				>developers working with Bible translation resources</strong
			>
			. Access translation helps via <strong class="text-cyan-300">Model Context Protocol</strong>.
		</p>

		<div class="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
			<div class="rounded-3xl border border-blue-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-2 text-lg font-semibold text-white">MCP Server</h3>
				<p class="text-sm text-gray-300">
					Remote MCP server accessible via HTTP. Connect from any MCP-compatible client to access
					Bible translation resources.
				</p>
			</div>
			<div class="rounded-3xl border border-green-500/30 bg-green-500/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-2 text-lg font-semibold text-white">SDK Clients</h3>
				<p class="text-sm text-gray-300">
					JavaScript and Python SDKs for easy integration. Build applications that fetch translation
					helps programmatically.
				</p>
			</div>
			<div class="rounded-3xl border border-purple-500/30 bg-purple-500/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-2 text-lg font-semibold text-white">Developer-Focused</h3>
				<p class="text-sm text-gray-300">
					Built for developers working with Bible translation. REST API and MCP protocol support for
					flexible integration.
				</p>
			</div>
		</div>

		<div class="flex justify-center space-x-4">
			<a
				href="/mcp-tools"
				class="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-6 py-3 text-white transition-all hover:from-blue-600 hover:to-cyan-600 hover:shadow-lg"
			>
				Try MCP Tools
			</a>
			<a
				href="/api-explorer"
				class="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3 text-white transition-all hover:from-purple-600 hover:to-pink-600 hover:shadow-lg"
			>
				API Explorer
			</a>
			<a
				href="/chat"
				class="rounded-lg border border-blue-500/50 px-6 py-3 text-blue-300 backdrop-blur-xl transition-all hover:border-blue-400 hover:bg-blue-500/10 hover:text-blue-200"
			>
				AI Bible Assistant
			</a>
		</div>
	</section>

	<!-- Translation Approaches Section -->
	<section class="mb-16">
		<h2 class="mb-12 text-center text-3xl font-bold text-white">
			Translation Approaches Available
		</h2>

		<div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
			<!-- Form-Centric (Literal) -->
			<div class="rounded-3xl border border-orange-500/30 bg-orange-500/5 p-8 backdrop-blur-2xl">
				<div class="mb-4 flex items-center">
					<div
						class="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/20 backdrop-blur-xl"
					>
						<span class="text-xl font-bold text-orange-300">ULT</span>
					</div>
					<div>
						<h3 class="text-xl font-semibold text-white">unfoldingWord Literal Text</h3>
						<p class="text-sm text-orange-300">Form-Centric Translation</p>
					</div>
				</div>
				<p class="mb-4 text-gray-300">
					Preserves original language structure and word order. Shows how biblical authors expressed
					ideas in Hebrew and Greek.
				</p>
				<ul class="space-y-1 text-sm text-gray-300">
					<li>• Maintains source language idioms and figures of speech</li>
					<li>• Preserves grammatical structures for exegetical study</li>
					<li>• Includes embedded word alignment data</li>
					<li>• Available in English (ULT) and Strategic Languages (GLT)</li>
				</ul>
			</div>

			<!-- Meaning-Based (Simplified) -->
			<div class="rounded-3xl border border-green-500/30 bg-green-500/5 p-8 backdrop-blur-2xl">
				<div class="mb-4 flex items-center">
					<div
						class="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/20 backdrop-blur-xl"
					>
						<span class="text-xl font-bold text-green-300">UST</span>
					</div>
					<div>
						<h3 class="text-xl font-semibold text-white">unfoldingWord Simplified Text</h3>
						<p class="text-sm text-green-300">Meaning-Based Translation</p>
					</div>
				</div>
				<p class="mb-4 text-gray-300">
					Demonstrates clear, natural expression of biblical meaning. Shows how to communicate
					biblical concepts in everyday language.
				</p>
				<ul class="space-y-1 text-sm text-gray-300">
					<li>• Uses contemporary vocabulary and sentence structure</li>
					<li>• Explains cultural concepts in accessible terms</li>
					<li>• Includes clarity and readability metrics</li>
					<li>• Available in English (UST) and Strategic Languages (GST)</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- Translation Helps Section -->
	<section class="mb-16">
		<h2 class="mb-12 text-center text-3xl font-bold text-white">Comprehensive Translation Helps</h2>

		<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
			<div class="rounded-3xl border border-blue-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-3 text-lg font-semibold text-blue-300">Translation Notes (tN)</h3>
				<p class="text-sm text-gray-300">
					Verse-by-verse explanations for difficult passages with cultural background and
					alternative rendering options.
				</p>
			</div>

			<div class="rounded-3xl border border-green-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-3 text-lg font-semibold text-green-300">Translation Words (tW)</h3>
				<p class="text-sm text-gray-300">
					Comprehensive biblical term definitions with cross-references and usage examples
					throughout Scripture.
				</p>
			</div>

			<div class="rounded-3xl border border-purple-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-3 text-lg font-semibold text-purple-300">Translation Words Links (tWL)</h3>
				<p class="text-sm text-gray-300">
					Precise mapping of word occurrences to Translation Words articles for contextual term
					definitions.
				</p>
			</div>

			<div class="rounded-3xl border border-red-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-3 text-lg font-semibold text-red-300">Translation Questions (tQ)</h3>
				<p class="text-sm text-gray-300">
					Comprehension validation questions for community checking and translation quality
					assurance.
				</p>
			</div>

			<div class="rounded-3xl border border-yellow-500/30 bg-white/5 p-6 backdrop-blur-2xl">
				<h3 class="mb-3 text-lg font-semibold text-yellow-300">Translation Academy (tA)</h3>
				<p class="text-sm text-gray-300">
					Translation methodology and best practices training modules for systematic translator
					development.
				</p>
			</div>

			<div class="rounded-lg bg-white p-6 shadow-md">
				<h3 class="mb-3 text-lg font-semibold text-indigo-600">Open Bible Stories (OBS)</h3>
				<p class="text-sm text-gray-600">
					Chronological Scripture overview through 50 key Bible stories for foundational biblical
					literacy.
				</p>
			</div>
		</div>
	</section>

	<!-- Technical Features Section -->
	<section class="mb-16">
		<h2 class="mb-12 text-center text-3xl font-bold text-white">Technical Architecture</h2>

		<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
			<div class="space-y-6">
				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-blue-300">⚡</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">Edge-Optimized Performance</h3>
						<p class="text-sm text-gray-300">
							Sub-200ms typical for cached endpoints with intelligent caching and in-flight ZIP
							fetch coalescing. Deployed globally on Cloudflare Workers.
						</p>
					</div>
				</div>

				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-green-300">🔗</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">USFM 3.0 Alignment Parsing</h3>
						<p class="text-sm text-gray-300">
							Advanced word-level alignment extraction with Strong's numbers, lemmas, and
							morphological data for precision translation.
						</p>
					</div>
				</div>

				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-purple-300">🤖</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">MCP Protocol Integration</h3>
						<p class="text-sm text-gray-300">
							Native Model Context Protocol support enables AI assistants to provide contextual
							translation guidance with full resource access.
						</p>
					</div>
				</div>
			</div>

			<div class="space-y-6">
				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-orange-300">📊</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">Real-Time Analytics</h3>
						<p class="text-sm text-gray-300">
							Performance monitoring, alignment confidence scoring, and clarity metrics for
							data-driven translation quality assessment.
						</p>
					</div>
				</div>

				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-red-300">🔒</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">Production-Grade Security</h3>
						<p class="text-sm text-gray-300">
							Rate limiting, input validation, DDoS protection, and secure headers ensure reliable
							service for global translation teams.
						</p>
					</div>
				</div>

				<div class="flex items-start space-x-4">
					<div
						class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-yellow-500/20 backdrop-blur-xl"
					>
						<span class="text-sm font-bold text-yellow-300">♾️</span>
					</div>
					<div>
						<h3 class="mb-2 font-semibold text-white">Infinite Scalability</h3>
						<p class="text-sm text-gray-300">
							Serverless architecture handles 10,000+ concurrent users with automatic scaling and
							zero infrastructure management required.
						</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-white/10 pt-8 text-center text-sm text-gray-400">
		<div class="mb-4 flex items-center justify-center space-x-4">
			<span class="text-blue-300">TC Helps</span>
			<span>•</span>
			<span>Version {version}</span>
			<span>•</span>
			<span>servant.bible</span>
		</div>
		<p class="text-xs text-gray-500">
			MCP server and clients for developers working with Bible translation resources.
		</p>
	</footer>
</div>
