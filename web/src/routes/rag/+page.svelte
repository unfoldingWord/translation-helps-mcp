<script lang="ts">
	// ─── Types ────────────────────────────────────────────────────────────────
	interface ArticleResult {
		path: string;
		title: string;
		resourceType: 'ta' | 'tw';
		score: number;
	}

	// ─── State ────────────────────────────────────────────────────────────────
	let query = '';
	let language = 'en';
	let topK = 8;
	let resourceTypes: Record<string, boolean> = { ta: true, tw: true };

	let results: ArticleResult[] = [];
	let isLoading = false;
	let latencyMs = 0;
	let errorMsg = '';
	let lastQuery = '';

	// ─── Presets ──────────────────────────────────────────────────────────────
	const PRESETS = [
		{ label: 'Metonymy', query: 'metonymy figure of speech' },
		{ label: 'Translate idioms', query: 'how to translate idioms figurative language' },
		{ label: 'Eternal life', query: 'eternal life meaning' },
		{ label: 'Son of God', query: 'Son of God title' },
		{ label: 'Grace', query: 'grace forgiveness' },
		{ label: 'Hebrew poetry', query: 'Hebrew parallelism poetry' }
	];

	// ─── Resource type meta ───────────────────────────────────────────────────
	const RT_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
		ta: { label: 'TA', color: 'text-green-300', bg: 'bg-green-900/50 border-green-700', icon: '📚' },
		tw: { label: 'TW', color: 'text-amber-300', bg: 'bg-amber-900/50 border-amber-700', icon: '🔑' }
	};

	function rtMeta(type?: string) {
		return RT_META[type ?? ''] ?? { label: (type ?? '?').toUpperCase(), color: 'text-gray-300', bg: 'bg-gray-800 border-gray-700', icon: '📄' };
	}

	// ─── Search ───────────────────────────────────────────────────────────────
	async function search() {
		const q = query.trim();
		if (!q) return;
		isLoading = true;
		errorMsg = '';
		results = [];
		latencyMs = 0;
		lastQuery = q;

		const selectedTypes = Object.entries(resourceTypes)
			.filter(([, v]) => v)
			.map(([k]) => k);

		const params: Record<string, unknown> = {
			query: q,
			language,
			topK,
			resourceTypes: selectedTypes
		};

		const start = Date.now();
		try {
			const res = await fetch('/api/tool', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'search_articles', params })
			});
			latencyMs = Date.now() - start;
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json() as { error?: string; structuredContent?: { results?: ArticleResult[] } };
			if (data.error) throw new Error(data.error);
			results = data.structuredContent?.results ?? [];
		} catch (e) {
			latencyMs = Date.now() - start;
			errorMsg = e instanceof Error ? e.message : String(e);
		} finally {
			isLoading = false;
		}
	}

	function applyPreset(p: { query: string }) {
		query = p.query;
		search();
	}

	function scoreBar(score?: number): number {
		return Math.round((score ?? 0) * 100);
	}

	function scoreColor(score?: number): string {
		const s = score ?? 0;
		if (s >= 0.8) return 'bg-green-500';
		if (s >= 0.6) return 'bg-yellow-500';
		if (s >= 0.4) return 'bg-orange-500';
		return 'bg-red-500';
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') search();
	}

	function fetchLink(result: ArticleResult): string {
		if (result.resourceType === 'ta') return `/playground?tool=fetch_translation_academy&path=${encodeURIComponent(result.path)}`;
		return `/playground?tool=fetch_translation_word&path=${encodeURIComponent(result.path)}`;
	}
</script>

<svelte:head>
	<title>Article Search — Translation Helps MCP</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">

	<!-- ── Header ─────────────────────────────────────────────────────────── -->
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-white">🔍 Article Search</h1>
		<p class="mt-1 text-sm text-gray-400">
			Lexical search over Translation Academy and Translation Words catalogs.
			Find articles by concept or phrase, then fetch the full content.
		</p>
	</div>

	<!-- ── Search form ────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-lg">
		<!-- Main query input -->
		<div class="mb-3">
			<input
				type="text"
				bind:value={query}
				on:keydown={handleKey}
				placeholder="Search for a translation concept, e.g. metonymy, grace, eternal life"
				class="w-full rounded-lg border border-gray-600 bg-gray-800 px-4 py-3 text-base text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
			/>
		</div>

		<!-- Secondary controls row -->
		<div class="mb-4 flex flex-wrap gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-gray-400">Language</label>
				<select
					bind:value={language}
					class="rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
				>
					<option value="en">English (en)</option>
					<option value="es">Spanish (es)</option>
					<option value="fr">French (fr)</option>
					<option value="hi">Hindi (hi)</option>
					<option value="pt">Portuguese (pt)</option>
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-gray-400">Top-K</label>
				<input
					type="number"
					bind:value={topK}
					min={1}
					max={20}
					class="w-16 rounded border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
				/>
			</div>
		</div>

		<!-- Resource type chips -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="text-xs font-medium text-gray-400">Search in:</span>
			{#each Object.entries(RT_META) as [type, meta]}
				<button
					on:click={() => (resourceTypes[type] = !resourceTypes[type])}
					class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {resourceTypes[type]
						? `${meta.bg} ${meta.color} border-current`
						: 'border-gray-700 bg-gray-800 text-gray-500 hover:border-gray-600'}"
				>
					{meta.icon} {meta.label}
				</button>
			{/each}
		</div>

		<!-- Preset queries -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<span class="text-xs font-medium text-gray-500">Try:</span>
			{#each PRESETS as preset}
				<button
					on:click={() => applyPreset(preset)}
					class="rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs text-gray-400 transition-colors hover:border-indigo-600 hover:bg-indigo-900/30 hover:text-indigo-300"
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<!-- Submit + stats -->
		<div class="flex items-center gap-4">
			<button
				on:click={search}
				disabled={isLoading || !query.trim()}
				class="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{#if isLoading}
					<span class="inline-flex items-center gap-2">
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
						</svg>
						Searching…
					</span>
				{:else}
					🔍 Search
				{/if}
			</button>

			{#if latencyMs > 0}
				<span class="font-mono text-xs text-gray-500">⏱ {latencyMs}ms</span>
			{/if}
			{#if results.length > 0}
				<span class="text-xs text-gray-400">
					<span class="font-semibold text-white">{results.length}</span> article{results.length !== 1 ? 's' : ''} found
				</span>
			{/if}
		</div>
	</div>

	<!-- ── Error ──────────────────────────────────────────────────────────── -->
	{#if errorMsg}
		<div class="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			⚠ {errorMsg}
		</div>
	{/if}

	<!-- ── Empty state ────────────────────────────────────────────────────── -->
	{#if !isLoading && results.length === 0 && !errorMsg && latencyMs > 0}
		<div class="mt-8 text-center text-sm text-gray-500">
			No articles found for "<span class="text-gray-300">{lastQuery}</span>".
			<br class="mb-1" />
			Try a different phrase or check the resource type filters above.
		</div>
	{/if}

	{#if !isLoading && results.length === 0 && latencyMs === 0}
		<div class="mt-10 text-center text-sm text-gray-600">
			Enter a concept or phrase above, or click a preset to start searching.
		</div>
	{/if}

	<!-- ── Results ────────────────────────────────────────────────────────── -->
	{#if results.length > 0}
		<div class="mt-6 space-y-3">
			<h2 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
				Articles matching "<span class="text-gray-300 normal-case">{lastQuery}</span>"
			</h2>

			{#each results as result, i}
				{@const meta = rtMeta(result.resourceType)}
				{@const score = result.score ?? 0}

				<div class="rounded-xl border border-gray-700 bg-gray-900 p-4 transition-colors hover:border-gray-600">
					<!-- Card header -->
					<div class="mb-2 flex flex-wrap items-start justify-between gap-2">
						<div class="flex flex-wrap items-center gap-2">
							<!-- Rank badge -->
							<span class="flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 font-mono text-xs font-bold text-gray-400">
								{i + 1}
							</span>

							<!-- Resource type badge -->
							<span class="rounded border px-2 py-0.5 font-mono text-xs font-semibold {meta.bg} {meta.color}">
								{meta.icon} {meta.label}
							</span>

							<!-- Title -->
							<span class="text-sm font-medium text-white">{result.title || result.path}</span>
						</div>

						<!-- Score -->
						<div class="flex items-center gap-2">
							<div class="h-1.5 w-24 overflow-hidden rounded-full bg-gray-700">
								<div
									class="h-full rounded-full transition-all {scoreColor(score)}"
									style="width: {scoreBar(score)}%"
								></div>
							</div>
							<span class="font-mono text-xs text-gray-500">{score.toFixed(3)}</span>
						</div>
					</div>

					<!-- Path + fetch link -->
					<div class="flex items-center justify-between">
						<code class="text-xs text-gray-500">{result.path}</code>
						<a
							href={fetchLink(result)}
							class="rounded border border-indigo-800 bg-indigo-900/30 px-2.5 py-1 text-xs text-indigo-300 transition-colors hover:border-indigo-600 hover:bg-indigo-900/60"
						>
							Fetch article →
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}

</div>
