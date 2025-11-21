<script lang="ts">
	import { onMount } from 'svelte';
	import {
		discoverLanguageOrgs,
		getOrganizationsForLanguage,
		getLanguageDisplayName,
		type LanguageOrgDiscoveryResult
	} from '$lib/languageOrgDiscovery.js';
	import { mapLanguageToCatalogCode } from '$lib/languageMapping.js';

	export let selectedLanguage: string = 'en';
	export let selectedOrganization: string = 'unfoldingWord';
	export let onSelectionChange: (language: string, organization: string) => void = () => {};

	let discoveryResult: LanguageOrgDiscoveryResult | null = null;
	let isLoading = true;
	let error: string | null = null;
	let availableOrgs: string[] = [];

	// Load discovery data on mount
	onMount(async () => {
		try {
			discoveryResult = await discoverLanguageOrgs();
			updateAvailableOrgs();
			isLoading = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load language options';
			isLoading = false;
		}
	});

	// Update available organizations when language changes
	function updateAvailableOrgs() {
		if (discoveryResult) {
			availableOrgs = getOrganizationsForLanguage(discoveryResult, selectedLanguage);
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
	$: displayText = discoveryResult
		? `${getLanguageDisplayName(discoveryResult, selectedLanguage)} (${selectedOrganization})`
		: `${selectedLanguage} (${selectedOrganization})`;
</script>

<div class="flex items-center gap-2 text-sm">
	{#if isLoading}
		<div class="flex items-center gap-2 text-gray-400">
			<div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"></div>
			<span>Loading languages...</span>
		</div>
	{:else if error}
		<div class="text-red-400" title={error}>
			⚠️ Language selection unavailable
		</div>
	{:else if discoveryResult}
		<!-- Language Selector -->
		<select
			class="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
				class="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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

