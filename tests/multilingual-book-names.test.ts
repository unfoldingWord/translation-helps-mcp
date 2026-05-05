import { describe, expect, it } from "vitest";
import {
  getBookCodeFromName,
  normalizeReference,
} from "../src/utils/book-codes.js";
import { parseReference } from "../src/functions/reference-parser.js";
import {
  languageBaseForBookNames,
  resolveLocalizedBookNameToCode,
} from "../src/utils/multilingual-book-names.js";

describe("Localized book name → USFM code", () => {
  it("maps BCP-47 tags to JSON language keys (primary subtag only)", () => {
    expect(languageBaseForBookNames("es-419")).toBe("es");
    expect(languageBaseForBookNames("es_419")).toBe("es");
    expect(languageBaseForBookNames("pt-BR")).toBe("pt");
    expect(languageBaseForBookNames("pt-br")).toBe("pt");
    expect(languageBaseForBookNames("  zh-Hans  ")).toBe("zh");
  });

  it("resolves Spanish names", () => {
    expect(resolveLocalizedBookNameToCode("Génesis", "es")).toBe("GEN");
    expect(resolveLocalizedBookNameToCode("Mateo", "es-419")).toBe("MAT");
    expect(resolveLocalizedBookNameToCode("Génesis", "es_419")).toBe("GEN");
    expect(resolveLocalizedBookNameToCode("1 Corintios", "es")).toBe("1CO");
  });

  it("resolves Portuguese (Brazil) using pt book names with pt-br tag", () => {
    expect(resolveLocalizedBookNameToCode("Gênesis", "pt-br")).toBe("GEN");
    expect(resolveLocalizedBookNameToCode("Mateus", "pt-BR")).toBe("MAT");
    expect(getBookCodeFromName("João", "pt-br")).toBe("JHN");
  });

  it("resolves without language (merged locales)", () => {
    expect(resolveLocalizedBookNameToCode("Génesis")).toBe("GEN");
    expect(resolveLocalizedBookNameToCode("Genèse", "fr")).toBe("GEN");
  });

  it("getBookCodeFromName uses locale data", () => {
    expect(getBookCodeFromName("Génesis", "es")).toBe("GEN");
    expect(getBookCodeFromName("Apocalipsis", "es")).toBe("REV");
  });

  it("parseReference accepts Unicode book titles", () => {
    const r = parseReference("Génesis 1:1");
    expect(r).not.toBeNull();
    expect(r!.book).toBe("GEN");
    expect(r!.chapter).toBe(1);
    expect(r!.verse).toBe(1);
  });

  it("parseReference accepts Spanish book titles", () => {
    const r = parseReference("Juan 3:16", { language: "es" });
    expect(r?.book).toBe("JHN");
  });

  it("parseReference uses primary language for es-419 and pt-br", () => {
    expect(parseReference("Juan 3:16", { language: "es-419" })?.book).toBe(
      "JHN",
    );
    expect(parseReference("João 3:16", { language: "pt-br" })?.book).toBe(
      "JHN",
    );
  });

  it("normalizeReference normalizes localized titles", () => {
    expect(normalizeReference("Génesis 1:1", "es")).toBe("GEN 1:1");
  });
});
