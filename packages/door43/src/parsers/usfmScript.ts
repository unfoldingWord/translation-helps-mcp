/**
 * Script of the verse letters when an `\id` line names no language.
 *
 * A declared language already decided, so this returns nothing then.
 * Latin is not judged: it cannot tell English from Spanish. A sample
 * shorter than 50 letters is not judged. The book is in another script
 * only when fewer than 20% of those letters use the script
 * `Intl.Locale(language).maximize()` expects (`ar` → Arab, `hi` → Deva).
 */
import { stripUsfm } from "./usfm.js";
import { declaredLanguageFromIdLine, scriptureLanguageBase } from "./usfmId.js";

const SAMPLE_LETTERS = 2000;
const MIN_LETTERS = 50;
const MIN_SHARE = 0.2;

/**
 * Used only when `Intl.Locale.maximize` is missing (older Workers).
 * Latin languages are absent on purpose: that script is not a signal.
 */
const SCRIPT_WITHOUT_MAXIMIZE: Record<string, string> = {
  ar: "Arab",
  hi: "Deva",
  bn: "Beng",
  ur: "Arab",
  fa: "Arab",
  he: "Hebr",
  ru: "Cyrl",
  zh: "Hans",
  ne: "Deva",
};

/** Names that read naturally after "not in … script". */
const SCRIPT_LABEL: Record<string, string> = {
  Arab: "Arabic",
  Deva: "Devanagari",
  Beng: "Bangla",
  Hebr: "Hebrew",
  Cyrl: "Cyrillic",
  Hans: "Han",
  Hant: "Han",
  Grek: "Greek",
};

function localeMaximizeWorks(): boolean {
  try {
    return typeof new Intl.Locale("en").maximize === "function";
  } catch {
    return false;
  }
}

const MAXIMIZE_WORKS = localeMaximizeWorks();

/** Unicode script `language` is written in, or null when it cannot be known. */
export function expectedScript(language: string): string | null {
  if (!MAXIMIZE_WORKS) {
    const code = language.trim().toLowerCase();
    return (
      SCRIPT_WITHOUT_MAXIMIZE[code] ??
      SCRIPT_WITHOUT_MAXIMIZE[scriptureLanguageBase(code)] ??
      null
    );
  }
  try {
    return new Intl.Locale(language).maximize().script ?? null;
  } catch {
    return null;
  }
}

/**
 * Letters (`\p{L}`) of the verse text. Alignment attributes do not count:
 * `\w palabra|...\w*` contributes `palabra`. At most the first 2000.
 */
export function scriptureLetterSample(
  usfm: string,
  limit = SAMPLE_LETTERS,
): string {
  if (!usfm) return "";
  const verseAt = usfm.search(/\\v\s+\d+/);
  const body = verseAt >= 0 ? usfm.slice(verseAt) : usfm;
  const letters = stripUsfm(body).match(/\p{L}/gu) ?? [];
  return letters.slice(0, limit).join("");
}

function shareInScript(sample: string, script: string): number | null {
  if (!/^[A-Za-z]+$/.test(script)) return null;
  let matched: RegExpMatchArray | null;
  try {
    matched = sample.match(new RegExp(`\\p{Script=${script}}`, "gu"));
  } catch {
    return null;
  }
  const total = [...sample].length;
  if (total === 0) return null;
  return (matched?.length ?? 0) / total;
}

function scriptLabel(script: string): string {
  const known = SCRIPT_LABEL[script];
  if (known) return known;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "script" }).of(script);
    if (name && name.toLowerCase() !== script.toLowerCase()) return name;
  } catch {
    // The script code still names it in the note.
  }
  return script;
}

/**
 * English name of the expected script when the verse letters are not in it
 * ("Arabic"), or null when the book should still be served. Null when the
 * `\id` line already declares a language: that signal wins.
 */
export function foreignScriptName(
  usfm: string,
  language: string,
): string | null {
  if (declaredLanguageFromIdLine(usfm)) return null;
  const script = expectedScript(language);
  if (!script || script === "Latn") return null;
  const sample = scriptureLetterSample(usfm);
  if ([...sample].length < MIN_LETTERS) return null;
  const share = shareInScript(sample, script);
  if (share === null || share >= MIN_SHARE) return null;
  return scriptLabel(script);
}
