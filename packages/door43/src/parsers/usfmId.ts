/**
 * Language a USFM `\id` line declares, or null when it declares none.
 *
 * tC writes `<code>_<name>_<ltr|rtl>` (`en_English_ltr`, `ar_العربية_rtl`,
 * `es-419_Español_ltr`). The `EN_` resource prefix is not a language: the
 * Arabic AVD is `EN_AVD` and still `ar_Arabic_rtl`. A bare `\id ROM` or
 * free text declares nothing. Two tokens: the first is the book's language
 * (Titus in the Arabic ARST is `ar_…_rtl` and then a stray `ru_…_ltr`).
 */
const ID_LANGUAGE =
  /(?:^|\s)([A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)_[^\s]+_(ltr|rtl)(?=\s|$)/i;

export function declaredLanguageFromIdLine(usfm: string): string | null {
  if (!usfm) return null;
  let idLine: string | null = null;
  for (const raw of usfm.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (/^\s*\\id\b/i.test(line)) {
      idLine = line;
      break;
    }
  }
  if (!idLine) return null;
  const match = idLine.match(ID_LANGUAGE);
  return match ? match[1].toLowerCase() : null;
}

/** Base subtag: `es-419` and `es` are `es`; `pt-br` and `pt` are `pt`. */
export function scriptureLanguageBase(code: string): string {
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  return base ?? "";
}

/**
 * Whether a requested language and the one on an `\id` line are the same
 * language. Regional tags compare by their base (`es-419` with `es`).
 */
export function sameScriptureLanguage(
  requested: string,
  declared: string,
): boolean {
  const requestedBase = scriptureLanguageBase(requested);
  const declaredBase = scriptureLanguageBase(declared);
  return requestedBase.length > 0 && requestedBase === declaredBase;
}
