<script lang="ts">
	import { onMount } from 'svelte';
	import { TranslationHelpsClient } from '@translation-helps/mcp-client';
	import { mapLanguageToCatalogCode } from '$lib/languageMapping.js';

	export let selectedLanguage: string = 'en';
	export let selectedOrganization: string = 'unfoldingWord';
	export let onSelectionChange: (language: string, organization: string) => void = () => {};

	interface LanguageOption {
		language: string;
		displayName?: string;
		organizations: string[];
	}

	interface DiscoveryResult {
		options: LanguageOption[];
		metadata: {
			responseTime: number;
			timestamp: string;
			totalLanguages: number;
			totalOrganizations: number;
		};
	}

	let discoveryResult: DiscoveryResult | null = null;
	let isLoading = true;
	let error: string | null = null;
	let availableOrgs: string[] = [];

	// Load discovery data on mount using new list_languages and list_subjects tools
	onMount(async () => {
		try {
			// Use the MCP client to call list_languages
			const client = new TranslationHelpsClient({
				serverUrl: '/api/mcp',
				enableMetrics: false
			});

			await client.connect();

			// Get all languages (no organization filter to get all)
			const languagesResponse = await client.listLanguages({
				stage: 'prod'
			});

			// Transform the response to match the expected format
			const languages = languagesResponse.languages || [];

			// Group languages and their organizations
			const languageMap = new Map<string, { displayName?: string; organizations: Set<string> }>();

			// Initialize all languages from the list
			for (const lang of languages) {
				languageMap.set(lang.code, {
					displayName: lang.name || lang.displayName,
					organizations: new Set()
				});
			}

			// Discover organizations per language by querying list_languages with organization filters
			// We'll check common organizations to see which ones have resources for each language
			const commonOrgs = ['unfoldingWord', 'Door43-Catalog'];

			// For each language, check which organizations have resources
			// We do this by querying list_languages with each organization filter
			// and seeing if the language appears in the results
			const orgLanguageMap = new Map<string, Set<string>>();

			// Query each organization to see which languages it has
			for (const org of commonOrgs) {
				try {
					const orgLanguagesResponse = await client.listLanguages({
						organization: org,
						stage: 'prod'
					});
					const orgLanguages = orgLanguagesResponse.languages || [];
					const langCodes = new Set(orgLanguages.map((l: any) => l.code));
					orgLanguageMap.set(org, langCodes);
				} catch (err) {
					console.warn(`Failed to get languages for organization ${org}:`, err);
				}
			}

			// Map languages to organizations
			for (const [langCode, data] of languageMap.entries()) {
				for (const [org, langSet] of orgLanguageMap.entries()) {
					if (langSet.has(langCode)) {
						data.organizations.add(org);
					}
				}
				// Always include unfoldingWord as a fallback (most common)
				if (data.organizations.size === 0) {
					data.organizations.add('unfoldingWord');
				}
			}

			// Convert to options format
			const options: LanguageOption[] = Array.from(languageMap.entries()).map(
				([language, data]) => ({
					language,
					displayName: data.displayName,
					organizations: Array.from(data.organizations).sort()
				})
			);

			// Sort by language code
			options.sort((a, b) => a.language.localeCompare(b.language));

			// Calculate totals
			const allOrgs = new Set<string>();
			options.forEach((opt) => {
				opt.organizations.forEach((org) => allOrgs.add(org));
			});

			discoveryResult = {
				options,
				metadata: {
					responseTime: languagesResponse.metadata?.responseTime || 0,
					timestamp: languagesResponse.metadata?.timestamp || new Date().toISOString(),
					totalLanguages: options.length,
					totalOrganizations: allOrgs.size
				}
			};

			updateAvailableOrgs();
			isLoading = false;
		} catch (err) {
			console.error('Failed to load languages:', err);
			error = err instanceof Error ? err.message : 'Failed to load language options';
			isLoading = false;
		}
	});

	// Update available organizations when language changes
	function updateAvailableOrgs() {
		if (discoveryResult) {
			const option = discoveryResult.options.find((opt) => opt.language === selectedLanguage);
			availableOrgs = option?.organizations || [];
			// If current org is not available for selected language, reset to first available
			if (availableOrgs.length > 0 && !availableOrgs.includes(selectedOrganization)) {
				selectedOrganization = availableOrgs[0];
				onSelectionChange(selectedLanguage, selectedOrganization);
			}
		}
	}

	function handleLanguageChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		const rawLanguage = target.value;
		// Map to catalog code (e.g., es -> es-419)
		selectedLanguage = mapLanguageToCatalogCode(rawLanguage);
		updateAvailableOrgs();
		onSelectionChange(selectedLanguage, selectedOrganization);
	}

	function handleOrganizationChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		selectedOrganization = target.value;
		onSelectionChange(selectedLanguage, selectedOrganization);
	}

	// Get display text for current selection
	$: displayText = (() => {
		if (discoveryResult) {
			const option = discoveryResult.options.find((opt) => opt.language === selectedLanguage);
			const displayName = option?.displayName || selectedLanguage.toUpperCase();
			return `${displayName} (${selectedOrganization})`;
		}
		return `${selectedLanguage} (${selectedOrganization})`;
	})();
</script>

<div class="flex items-center gap-2 text-sm">
	{#if isLoading}
		<div class="flex items-center gap-2 text-gray-400">
			<div
				class="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"
			></div>
			<span>Loading languages...</span>
		</div>
	{:else if error}
		<div class="text-red-400" title={error}>⚠️ Language selection unavailable</div>
	{:else if discoveryResult}
		<!-- Language Selector -->
		<select
			class="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
			value={selectedLanguage}
			on:change={handleLanguageChange}
			title="Select language"
		>
			{#each discoveryResult.options as option}
				<option value={option.language}>
					{option.displayName || option.language.toUpperCase()}
				</option>
			{/each}
		</select>

		<!-- Organization Selector -->
		{#if availableOrgs.length > 0}
			<select
				class="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
				value={selectedOrganization}
				on:change={handleOrganizationChange}
				title="Select organization"
			>
				{#each availableOrgs as org}
					<option value={org}>{org}</option>
				{/each}
			</select>
		{:else}
			<span class="text-gray-500">No organizations available</span>
		{/if}

		<!-- Display current selection (compact) -->
		<span class="text-gray-400" title="Current selection: {displayText}">
			{displayText}
		</span>
	{/if}
</div>

<style>
	select {
		cursor: pointer;
	}

	select:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
