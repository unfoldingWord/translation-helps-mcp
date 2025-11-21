/**
 * Language Code Mapping
 * Maps common language codes to their BCP 47 equivalents used in Door43 catalog
 */

/**
 * Map a language code to its catalog equivalent
 * Some languages use specific variants in the Door43 catalog (e.g., es -> es-419)
 */
export function mapLanguageToCatalogCode(language: string): string {
	const languageMap: Record<string, string> = {
		// Spanish variants
		es: 'es-419', // Spanish -> Latin American Spanish
		'es-MX': 'es-419',
		'es-AR': 'es-419',
		'es-CO': 'es-419',
		'es-CL': 'es-419',
		'es-PE': 'es-419'
		// Add other mappings as needed
	};

	return languageMap[language] || language;
}

/**
 * Get the display name for a language code
 */
export function getLanguageDisplayName(language: string): string {
	const displayNames: Record<string, string> = {
		en: 'English',
		es: 'Spanish',
		'es-419': 'Spanish (Latin America)',
		zh: 'Chinese',
		'zh-Hans': 'Simplified Chinese',
		'zh-Hant': 'Traditional Chinese',
		fr: 'French',
		pt: 'Portuguese',
		ar: 'Arabic',
		hi: 'Hindi'
	};

	return displayNames[language] || language.toUpperCase();
}
