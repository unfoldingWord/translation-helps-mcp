/**
 * Language Detection Utility
 * Detects language from user message and maps to catalog codes
 */

import { mapLanguageToCatalogCode } from './languageMapping.js';

/**
 * Detect language from user message
 * Returns detected language code or null if cannot detect
 */
export function detectLanguageFromMessage(message: string): string | null {
	if (!message || typeof message !== 'string') {
		return null;
	}

	const msg = message.trim().toLowerCase();

	// Common language indicators (words/phrases that strongly indicate a language)
	const languageIndicators: Record<string, string[]> = {
		es: [
			'hola',
			'gracias',
			'por favor',
			'definición',
			'definir',
			'significa',
			'qué es',
			'quien es',
			'amor',
			'gracia',
			'fe',
			'biblia',
			'versículo',
			'pasaje',
			'notas',
			'palabras',
			'traducción',
			'español'
		],
		en: [
			'hello',
			'thanks',
			'please',
			'definition',
			'define',
			'means',
			'what is',
			'who is',
			'love',
			'grace',
			'faith',
			'bible',
			'verse',
			'passage',
			'notes',
			'words',
			'translation',
			'english'
		],
		fr: [
			'bonjour',
			'merci',
			"s'il vous plaît",
			'définition',
			'définir',
			'signifie',
			"qu'est-ce que",
			'qui est',
			'amour',
			'grâce',
			'foi',
			'bible',
			'verset',
			'passage',
			'notes',
			'mots',
			'traduction',
			'français'
		],
		pt: [
			'olá',
			'obrigado',
			'por favor',
			'definição',
			'definir',
			'significa',
			'o que é',
			'quem é',
			'amor',
			'graça',
			'fé',
			'bíblia',
			'versículo',
			'passagem',
			'notas',
			'palavras',
			'tradução',
			'português'
		]
	};

	// Check for language indicators
	for (const [lang, indicators] of Object.entries(languageIndicators)) {
		for (const indicator of indicators) {
			if (msg.includes(indicator)) {
				return mapLanguageToCatalogCode(lang);
			}
		}
	}

	// Check for explicit language mentions
	const explicitPatterns: Record<string, RegExp> = {
		es: /(?:en|in)\s+(?:español|spanish)/i,
		en: /(?:en|in)\s+(?:inglés|english)/i,
		fr: /(?:en|in)\s+(?:français|french)/i,
		pt: /(?:en|in)\s+(?:português|portuguese)/i
	};

	for (const [lang, pattern] of Object.entries(explicitPatterns)) {
		if (pattern.test(message)) {
			return mapLanguageToCatalogCode(lang);
		}
	}

	return null;
}

/**
 * Extract language code from user's explicit request
 * Examples: "use Spanish", "in español", "switch to es-419"
 */
export function extractLanguageFromRequest(message: string): string | null {
	if (!message || typeof message !== 'string') {
		return null;
	}

	// Pattern: "use [language]", "in [language]", "switch to [language]", "[language] resources"
	const patterns = [
		/(?:use|switch to|change to|set to|in|with)\s+(?:language\s+)?(es|es-419|en|fr|pt|spanish|english|french|portuguese|español|français|português)/i,
		/(es|es-419|en|fr|pt|spanish|english|french|portuguese|español|français|português)\s+(?:language|resources|resources?)/i
	];

	for (const pattern of patterns) {
		const match = message.match(pattern);
		if (match) {
			const langCode = match[1].toLowerCase();
			// Map language names to codes
			const langMap: Record<string, string> = {
				spanish: 'es',
				español: 'es',
				english: 'en',
				inglés: 'en',
				french: 'fr',
				français: 'fr',
				portuguese: 'pt',
				português: 'pt'
			};
			const code = langMap[langCode] || langCode;
			return mapLanguageToCatalogCode(code);
		}
	}

	return null;
}
