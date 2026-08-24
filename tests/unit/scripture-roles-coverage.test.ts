/**
 * Unit tests for scripture role heuristics and ingredient book coverage.
 */

import { describe, it, expect } from "vitest";
import {
  resolveScriptureVersionRole,
  bookCodesFromIngredients,
  ingredientCoversBook,
  pickPreferredCatalogEntry,
  type CatalogEntry,
} from "@translation-helps/door43";

describe("resolveScriptureVersionRole", () => {
  it("maps gateway literal abbreviations to literal", () => {
    expect(resolveScriptureVersionRole("ult")).toBe("literal");
    expect(resolveScriptureVersionRole("glt")).toBe("literal");
    expect(resolveScriptureVersionRole("tpl")).toBe("literal");
    expect(resolveScriptureVersionRole("TPL")).toBe("literal");
    expect(resolveScriptureVersionRole("hglt")).toBe("literal");
  });

  it("maps simplified abbreviations to simplified", () => {
    expect(resolveScriptureVersionRole("ust")).toBe("simplified");
    expect(resolveScriptureVersionRole("gst")).toBe("simplified");
  });

  it("leaves unknown abbreviations as other", () => {
    expect(resolveScriptureVersionRole("bsb")).toBe("other");
    expect(resolveScriptureVersionRole("t4t")).toBe("other");
  });
});

describe("bookCodesFromIngredients", () => {
  it("extracts USFM book codes and ignores non-books", () => {
    expect(
      bookCodesFromIngredients([
        { identifier: "act" },
        { identifier: "tit" },
        { identifier: "front" },
        { identifier: "bible/kt/grace" },
      ]),
    ).toEqual(["ACT", "TIT"]);
  });

  it("reports coverage for a requested book", () => {
    const ings = [{ identifier: "act" }];
    expect(ingredientCoversBook(ings, "ACT")).toBe(true);
    expect(ingredientCoversBook(ings, "TIT")).toBe(false);
    expect(ingredientCoversBook([], "TIT")).toBe(null);
  });
});

describe("pickPreferredCatalogEntry subject preference", () => {
  const entry = (
    name: string,
    subject: string,
    owner = "unfoldingWord",
  ): CatalogEntry => ({
    owner,
    repo: name,
    name,
    subject,
    abbreviation: "obs",
    ingredients: [],
    catalog: {
      prod: {
        branch_or_tag_name: "v1",
        zipball_url: `https://git.door43.org/${owner}/${name}/archive/v1.zip`,
      },
    },
  });

  it("prefers Open Bible Stories over OBS Theological Formation for obs", () => {
    const results = [
      entry("en_obs-tf", "OBS Theological Formation"),
      entry("en_obs", "Open Bible Stories"),
    ];
    const picked = pickPreferredCatalogEntry(
      results,
      "unfoldingWord",
      "Open Bible Stories",
    );
    expect(picked?.name).toBe("en_obs");
  });
});
