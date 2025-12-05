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
