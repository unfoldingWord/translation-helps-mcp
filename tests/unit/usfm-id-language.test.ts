/**
 * A book's `\id` line sometimes says the text is in another language than the
 * catalog claims. Romans in the Arabic ARST is the English UST
 * (`en_English_ltr`); the `EN_` resource prefix is not that signal, because
 * the Arabic AVD uses it too (`EN_AVD` … `ar_Arabic_rtl`).
 */
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  declaredLanguageFromIdLine,
  sameScriptureLanguage,
} from "@translation-helps/door43";
import { scriptureVersionsForBook } from "../../src/api/routes/scripture.js";

const ARST_ROM =
  "\\id ROM EN_UST en_English_ltr Wed Dec 07 2022 14:03:42 GMT-0500 (Eastern Standard Time) tc";
const AVD_ROM =
  "\\id ROM EN_AVD ar_Arabic_rtl  Mon Nov 18 2024 09:24:23 GMT-0500 (Eastern Standard Time) tc";
const NAV_ROM = "\\id ROM - New Arabic Version (Ketab El Hayat)";
const BARE_ROM = "\\id ROM";
const GST_TIT =
  "\\id TIT EN_ARST ar_العربية_rtl EN_AST ru_Русский_ltr Simplified text Thu Nov 30 2023 tc";
const ES_419 = "\\id JHN ES_GLT es-419_Español_ltr";

function entry(owner: string, abbrev: string, books: string[]): CatalogEntry {
  return {
    owner,
    repo: `${owner}_${abbrev}`,
    name: `${owner}_${abbrev}`,
    abbreviation: abbrev,
    ingredients: books.map((book) => ({
      identifier: book.toLowerCase(),
      path: `./${book}.usfm`,
    })),
  };
}

const names = (entries: CatalogEntry[]) => entries.map((e) => e.abbreviation);

describe("declaredLanguageFromIdLine", () => {
  it("reads the tC language token and ignores the EN_ resource prefix", () => {
    expect(declaredLanguageFromIdLine(ARST_ROM)).toBe("en");
    expect(declaredLanguageFromIdLine(AVD_ROM)).toBe("ar");
  });

  it("returns nothing when the id line has no language token", () => {
    expect(declaredLanguageFromIdLine(NAV_ROM)).toBeNull();
    expect(declaredLanguageFromIdLine(BARE_ROM)).toBeNull();
    expect(declaredLanguageFromIdLine("")).toBeNull();
    expect(
      declaredLanguageFromIdLine("\\id 2SA unfoldingWord® Simplified Text"),
    ).toBeNull();
  });

  it("keeps a hyphenated code such as es-419", () => {
    expect(declaredLanguageFromIdLine(ES_419)).toBe("es-419");
  });

  it("uses the first token when a later one names another language", () => {
    expect(declaredLanguageFromIdLine(GST_TIT)).toBe("ar");
  });
});

describe("sameScriptureLanguage", () => {
  it("compares the base language, so a regional request matches the base code", () => {
    expect(sameScriptureLanguage("es-419", "es")).toBe(true);
    expect(sameScriptureLanguage("pt-br", "pt")).toBe(true);
    expect(sameScriptureLanguage("es", "es-419")).toBe(true);
  });

  it("does not treat a different base language as the one requested", () => {
    expect(sameScriptureLanguage("ar", "en")).toBe(false);
  });
});

describe("scriptureVersionsForBook", () => {
  const avd = entry("BSOJ", "avd", ["ROM", "TIT", "JHN"]);
  const arst = entry("BSOJ", "arst", ["ROM", "TIT", "JHN"]);
  const nav = entry("BSOJ", "nav", ["ROM", "TIT", "JHN"]);
  const arabic = [avd, arst, nav];

  it("drops a book that declares another language and fills its place", () => {
    const result = scriptureVersionsForBook(arabic, "ROM", "ar", (e) =>
      e.abbreviation === "arst"
        ? ARST_ROM
        : e.abbreviation === "avd"
          ? AVD_ROM
          : NAV_ROM,
    );
    expect(names(result.picked)).toEqual(["avd", "nav"]);
    expect(result.versionsNote).toBe(
      "ARST: the book is in en; the NAV is given in its place.",
    );
  });

  it("fills the same role when another version of that role has the book", () => {
    const glt = entry("ar_gt", "glt", ["ROM"]);
    const gst = entry("ar_gt", "gst", ["ROM"]);
    const result = scriptureVersionsForBook(
      [glt, arst, gst],
      "ROM",
      "ar",
      (e) => (e.abbreviation === "arst" ? ARST_ROM : BARE_ROM),
    );
    expect(names(result.picked)).toEqual(["glt", "gst"]);
    expect(result.versionsNote).toBe(
      "ARST: the book is in en; the GST (simplified) is given in its place.",
    );
  });

  it("keeps a book that does not declare a language", () => {
    const glt = entry("ar_gt", "glt", ["ROM"]);
    const result = scriptureVersionsForBook([glt], "ROM", "ar", () => BARE_ROM);
    expect(result.picked).toEqual([glt]);
    expect(result.versionsNote).toBeNull();
  });

  it("keeps a book whose declared language shares the requested base", () => {
    const glt = entry("es-419_gl", "glt", ["JHN"]);
    const result = scriptureVersionsForBook(
      [glt],
      "JHN",
      "es-419",
      () => "\\id JHN ES_GLT es_Español_ltr",
    );
    expect(result.picked).toEqual([glt]);
    expect(result.versionsNote).toBeNull();

    const pt = entry("pt-br_gl", "glt", ["JHN"]);
    const ptResult = scriptureVersionsForBook(
      [pt],
      "JHN",
      "pt-br",
      () => "\\id JHN PT_GLT pt_Portugues_ltr",
    );
    expect(ptResult.picked).toEqual([pt]);
    expect(ptResult.versionsNote).toBeNull();
  });

  it("keeps Titus when the first token is Arabic and a later token is not", () => {
    const result = scriptureVersionsForBook([arst], "TIT", "ar", () => GST_TIT);
    expect(result.picked).toEqual([arst]);
    expect(result.versionsNote).toBeNull();
  });

  it("still picks an unread book, then drops it once the id line is known", () => {
    const glt = entry("ar_gt", "glt", ["ROM"]);
    const gst = entry("ar_gt", "gst", ["ROM"]);
    const known = new Map<CatalogEntry, string>();
    const usfmOf = (e: CatalogEntry) =>
      known.has(e) ? known.get(e)! : undefined;

    const first = scriptureVersionsForBook(
      [glt, arst, gst],
      "ROM",
      "ar",
      usfmOf,
    );
    expect(names(first.picked)).toEqual(["glt", "arst"]);

    known.set(glt, BARE_ROM);
    known.set(arst, ARST_ROM);
    const second = scriptureVersionsForBook(
      [glt, arst, gst],
      "ROM",
      "ar",
      usfmOf,
    );
    expect(names(second.picked)).toEqual(["glt", "gst"]);
    expect(second.versionsNote).toBe(
      "ARST: the book is in en; the GST (simplified) is given in its place.",
    );
  });

  it("does not replace a book whose file is missing", () => {
    const ult = entry("unfoldingWord", "ult", ["JHN"]);
    const ust = entry("unfoldingWord", "ust", ["JHN"]);
    const bsb = entry("Worldview", "bsb", ["JHN"]);
    const result = scriptureVersionsForBook(
      [ult, ust, bsb],
      "JHN",
      "en",
      (e) => (e.abbreviation === "ult" ? null : "\\id JHN"),
    );
    expect(names(result.picked)).toEqual(["ult", "ust"]);
    expect(result.versionsNote).toBeNull();
  });

  it("still explains a catalog stand-in when every id line is silent", () => {
    const ult = entry("unfoldingWord", "ult", ["GEN", "RUT", "JHN"]);
    const ust = entry("unfoldingWord", "ust", ["GEN", "JHN"]);
    const bsb = entry("Worldview", "bsb", ["GEN", "RUT", "ISA", "JHN"]);
    const result = scriptureVersionsForBook(
      [ult, ust, bsb],
      "RUT",
      "en",
      () => "\\id RUT",
    );
    expect(names(result.picked)).toEqual(["ult", "bsb"]);
    expect(result.versionsNote).toBe(
      "The UST (simplified) does not include RUT yet; the BSB is given in its place.",
    );
  });

  it("omits a foreign book from the full list and says why", () => {
    const result = scriptureVersionsForBook(
      arabic,
      "ROM",
      "ar",
      (e) => (e.abbreviation === "arst" ? ARST_ROM : BARE_ROM),
      { includeAll: true },
    );
    expect(names(result.picked)).toEqual(["avd", "nav"]);
    expect(result.versionsNote).toBe("ARST: the book is in en.");
  });
});
