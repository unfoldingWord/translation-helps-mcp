/**
 * Language Code Mapping Utility
 * Maps common language codes to their BCP 47 catalog equivalents
 */

/**
 * Map a language code to its catalog equivalent
 * Some languages use specific variants in the Door43 catalog (e.g., es -> es-419)
 */
export function mapLanguageToCatalogCode(language: string): string {
  const languageMap: Record<string, string> = {
    es: "es-419", // Spanish -> Latin American Spanish
    "es-MX": "es-419",
    "es-AR": "es-419",
    "es-CO": "es-419",
    "es-CL": "es-419",
    "es-PE": "es-419",
  };
  return languageMap[language] || language;
}

/**
 * Label for a catalog language in tool results.
 *
 * Door43 stores the English name in `ang` ("Bengali, Bangla", "Hindi") and the
 * native-script name in `ln` ("বাংলা", "हिन्दी"). Models decide a language is
 * missing by scanning `name` for the English word, so `name` must be `ang`.
 * Falls back to the native name, then the code, when `ang` is absent.
 */
export function languageListName(
  localName: string | undefined,
  anglicizedName: string | undefined,
  code: string,
): string {
  const anglicized = anglicizedName?.trim();
  if (anglicized) return anglicized;
  const local = localName?.trim();
  if (local) return local;
  return code;
}
