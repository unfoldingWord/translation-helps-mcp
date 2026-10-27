/**
 * The published ULT and UST do not have every book yet (no Isaiah in release
 * v91). For a book they lack, the scripture route must give another version
 * of the language and say so, not the original text alone (#64). When no
 * version has the book, the note also lists which books the catalog covers.
 */
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  describeStandIns,
  pickPrimaryScriptureEntries,
} from "../../src/api/routes/scripture.js";

function entry(owner: string, abbrev: string, books: string[]): CatalogEntry {
  return {
    owner,
    repo: `en_${abbrev}`,
    name: `en_${abbrev}`,
    abbreviation: abbrev,
    // The catalog writes book identifiers in lower case.
    ingredients: books.map((book) => ({
      identifier: book.toLowerCase(),
      path: `./${book}.usfm`,
    })),
  };
}

const ULT = entry("unfoldingWord", "ult", ["GEN", "RUT", "JHN"]);
const UST = entry("unfoldingWord", "ust", ["GEN", "JHN"]);
const BSB = entry("Worldview", "bsb", ["GEN", "RUT", "ISA", "JHN"]);
const T4T = entry("unfoldingWord", "t4t", ["GEN", "ISA", "JHN"]);
// The catalog's own order, which puts the BSB before the T4T.
const POOL = [ULT, UST, BSB, T4T];

const names = (entries: CatalogEntry[]) => entries.map((e) => e.abbreviation);

describe("pickPrimaryScriptureEntries", () => {
  it("gives the literal and the simplified version when both have the book", () => {
    const picked = pickPrimaryScriptureEntries(POOL, "JHN");
    expect(names(picked)).toEqual(["ult", "ust"]);
    expect(describeStandIns(POOL, picked, "JHN", "en")).toBeNull();
  });

  it("gives other versions for a book neither has, unfoldingWord's first", () => {
    const picked = pickPrimaryScriptureEntries(POOL, "ISA");
    expect(names(picked)).toEqual(["t4t", "bsb"]);
    expect(describeStandIns(POOL, picked, "ISA", "en")).toBe(
      "The ULT (literal) and UST (simplified) do not include Isaiah yet; the T4T and BSB are given in their place.",
    );
  });

  it("keeps the one that has the book and replaces only the other", () => {
    const picked = pickPrimaryScriptureEntries(POOL, "RUT");
    expect(names(picked)).toEqual(["ult", "bsb"]);
    expect(describeStandIns(POOL, picked, "RUT", "en")).toBe(
      "The UST (simplified) does not include Ruth yet; the BSB is given in its place.",
    );
  });

  it("gives none, and says so with the books that are available, when no version has the book", () => {
    const picked = pickPrimaryScriptureEntries(POOL, "NUM");
    expect(picked).toEqual([]);
    expect(describeStandIns(POOL, picked, "NUM", "en")).toBe(
      'The ULT (literal) and UST (simplified) do not include Numbers yet, and no other "en" version has it. Books available in en: Genesis, Ruth, Isaiah, John.',
    );
  });

  it("lists no books when one of the usual versions has the book", () => {
    const ult = entry("unfoldingWord", "ult", ["GEN", "ISA"]);
    const ust = entry("unfoldingWord", "ust", ["GEN"]);
    const picked = pickPrimaryScriptureEntries([ult, ust], "ISA");
    expect(picked).toEqual([ult]);
    expect(describeStandIns([ult, ust], picked, "ISA", "en")).toBe(
      'The UST (simplified) does not include Isaiah yet, and no other "en" version has it.',
    );
  });

  it("leaves the message without a book list when no version lists ingredients", () => {
    const bare = entry("unfoldingWord", "ult", []);
    expect(describeStandIns([bare], [], "JHN", "yy")).toBe(
      'The ULT (literal) does not include John yet, and no other "yy" version has it.',
    );
  });

  it("ignores a version with empty ingredients when building the available-books list", () => {
    const listed = entry("unfoldingWord", "ult", ["RUT", "TIT"]);
    const bare = entry("someone", "xyz", []);
    // Usual pair is ULT + XYZ (no simplified); XYZ lists no books so the
    // available list comes only from ULT's ingredients.
    expect(describeStandIns([listed, bare], [], "JHN", "es-419")).toBe(
      'The ULT (literal) and XYZ do not include John yet, and no other "es-419" version has it. Books available in es-419: Ruth, Titus.',
    );
  });

  it("takes a version that lists no books to have the book", () => {
    const unlisted = entry("unfoldingWord", "ult", []);
    const picked = pickPrimaryScriptureEntries([unlisted, UST], "ISA");
    expect(picked).toEqual([unlisted]);
  });

  it("prefers unfoldingWord's version of a role over another owner's", () => {
    const fork = entry("someone", "ult", ["GEN", "ISA", "JHN"]);
    expect(pickPrimaryScriptureEntries([fork, ULT, UST], "JHN")).toEqual([
      ULT,
      UST,
    ]);
    // For a book unfoldingWord's lacks, the other owner's is the literal one.
    expect(pickPrimaryScriptureEntries([fork, ULT, UST], "ISA")).toEqual([
      fork,
    ]);
  });

  it("does not invent a second version for a language that has one", () => {
    const glt = entry("es-419_gl", "glt", ["TIT"]);
    const picked = pickPrimaryScriptureEntries([glt], "TIT");
    expect(picked).toEqual([glt]);
    expect(describeStandIns([glt], picked, "TIT", "es-419")).toBeNull();
  });

  it("without a book, picks by role alone", () => {
    expect(names(pickPrimaryScriptureEntries(POOL))).toEqual(["ult", "ust"]);
  });

  it("names only the stand-in when one of the usual versions is itself an 'other'", () => {
    // No simplified version in this language: the usual pair is ULT and T4T.
    const pool = [ULT, BSB, T4T];
    const picked = pickPrimaryScriptureEntries(pool, "ISA");
    expect(names(picked)).toEqual(["t4t", "bsb"]);
    expect(describeStandIns(pool, picked, "ISA", "en")).toBe(
      "The ULT (literal) does not include Isaiah yet; the BSB is given in its place.",
    );
  });
});
