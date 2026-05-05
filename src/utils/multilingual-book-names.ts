/**
 * Localized Bible book display names → USFM 3-letter codes (from src/data/book-names-by-language.json).
 * Supports major languages; lookup is accent-insensitive and ignores spaces in the input.
 */

import bookNamesData from "../data/book-names-by-language.json";

/** Fold accents and lowercase for stable matching (Génesis / genesis) */
function normalizeForLookup(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s.]+/g, "");
}

/**
 * Primary language subtag for book-name lookup: `es-419` → `es`, `pt-BR` → `pt`, `zh-Hans` → `zh`.
 * Keys in book-names-by-language.json use these 2-letter (or `zh`) bases only.
 */
export function languageBaseForBookNames(bcp47?: string): string | undefined {
  if (!bcp47 || typeof bcp47 !== "string") return undefined;
  const trimmed = bcp47.trim();
  if (!trimmed) return undefined;
  const base = trimmed.split(/[-_]/)[0]?.toLowerCase();
  return base || undefined;
}

type RawBundle = { _comment?: string } & Record<
  string,
  Record<string, string> | string | undefined
>;

const raw = bookNamesData as RawBundle;
const { _comment: _c, ...langTables } = raw;

const byLanguage = new Map<string, Map<string, string>>();
/** All languages merged: normalized display name → code (last write wins; collisions logged in dev) */
const merged = new Map<string, string>();

function buildMaps(): void {
  for (const [lang, table] of Object.entries(langTables)) {
    if (typeof table !== "object" || !table) continue;
    const m = new Map<string, string>();
    for (const [displayName, code] of Object.entries(table)) {
      if (typeof code !== "string") continue;
      const k = normalizeForLookup(displayName);
      m.set(k, code);
      const prev = merged.get(k);
      if (prev !== undefined && prev !== code) {
        console.warn(
          `[multilingual-book-names] Ambiguous name "${displayName}" → ${prev} vs ${code} (using ${code})`,
        );
      }
      merged.set(k, code);
    }
    byLanguage.set(lang.toLowerCase(), m);
  }
}

buildMaps();

/**
 * Resolve a book title in a given language to a 3-letter USFM code.
 * If `languageBcp47` is set, uses its **primary subtag** only (BCP 47): `es-419` / `es_419` → `es`,
 * `pt-BR` / `pt-br` → `pt`, then looks up that key in the JSON. Fallback: `en`, then merged all locales.
 */
export function resolveLocalizedBookNameToCode(
  bookTitle: string,
  languageBcp47?: string,
): string | undefined {
  if (!bookTitle || typeof bookTitle !== "string") return undefined;
  const k = normalizeForLookup(bookTitle);
  if (!k) return undefined;

  const tryLang = (lang: string | undefined) => {
    if (!lang) return undefined;
    return byLanguage.get(lang)?.get(k);
  };

  const base = languageBaseForBookNames(languageBcp47);
  return tryLang(base) || tryLang("en") || merged.get(k) || undefined;
}
