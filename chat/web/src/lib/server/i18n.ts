/**
 * i18n.ts — lightweight status-string lookup for the chat pipeline.
 *
 * Only covers the handful of progress / status strings emitted by skillChat.ts
 * into the SSE stream. Full i18n is out of scope here.
 */

type StatusKey =
	| 'searching'
	| 'analyzing'
	| 'thinking'
	| 'preparing'
	| 'loading'
	| 'still_gathering'
	| 'reading';

const STATUS_STRINGS: Record<string, Record<StatusKey, string>> = {
	en: {
		searching: 'Searching resources\u2026',
		analyzing: 'Analyzing\u2026',
		thinking: 'Thinking\u2026',
		preparing: 'Preparing response\u2026',
		loading: 'Loading\u2026',
		still_gathering: 'Still gathering resources\u2026',
		reading: 'Reading passage and gathering translation resources\u2026'
	},
	es: {
		searching: 'Buscando recursos\u2026',
		analyzing: 'Analizando\u2026',
		thinking: 'Pensando\u2026',
		preparing: 'Preparando respuesta\u2026',
		loading: 'Cargando\u2026',
		still_gathering: 'Todav\u00eda recopilando recursos\u2026',
		reading: 'Leyendo el pasaje y recopilando recursos de traducci\u00f3n\u2026'
	},
	fr: {
		searching: 'Recherche de ressources\u2026',
		analyzing: 'Analyse en cours\u2026',
		thinking: 'R\u00e9flexion en cours\u2026',
		preparing: 'Pr\u00e9paration de la r\u00e9ponse\u2026',
		loading: 'Chargement\u2026',
		still_gathering: 'R\u00e9cup\u00e9ration des ressources en cours\u2026',
		reading: 'Lecture du passage et collecte des ressources de traduction\u2026'
	},
	pt: {
		searching: 'Buscando recursos\u2026',
		analyzing: 'Analisando\u2026',
		thinking: 'Pensando\u2026',
		preparing: 'Preparando resposta\u2026',
		loading: 'Carregando\u2026',
		still_gathering: 'Ainda coletando recursos\u2026',
		reading: 'Lendo a passagem e coletando recursos de tradu\u00e7\u00e3o\u2026'
	}
};

const FALLBACK = STATUS_STRINGS.en;

/** Get a localized status string. Falls back to English if language/key not found. */
export function getStatusText(language: string, key: StatusKey): string {
	// Try exact match first, then base language code (e.g. "es-419" → "es")
	const langEntry = STATUS_STRINGS[language] ?? STATUS_STRINGS[language.split('-')[0]] ?? FALLBACK;
	return langEntry[key] ?? FALLBACK[key];
}
