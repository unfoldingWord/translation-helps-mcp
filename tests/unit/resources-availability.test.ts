/**
 * Unit tests for list_resources availability builder (OBS subject aliases +
 * per-abbreviation dedupe preferring unfoldingWord).
 */

import { describe, it, expect } from "vitest";
import { buildAvailabilityForEntries } from "../../src/api/routes/resources.js";
import type { CatalogEntry } from "@translation-helps/door43";

function entry(
  overrides: Partial<CatalogEntry> &
    Pick<CatalogEntry, "owner" | "repo" | "name">,
): CatalogEntry {
  return {
    ingredients: [],
    ...overrides,
  };
}

describe("buildAvailabilityForEntries", () => {
  it("dedupes multiple OBS owners to one row, preferring unfoldingWord", () => {
    const items = buildAvailabilityForEntries("obs", [
      entry({
        owner: "BSA",
        repo: "es-419_obs",
        name: "es-419_obs",
        subject: "Open Bible Stories",
        abbreviation: "obs",
      }),
      entry({
        owner: "unfoldingWord",
        repo: "es-419_obs",
        name: "es-419_obs",
        subject: "Open Bible Stories",
        abbreviation: "obs",
      }),
      entry({
        owner: "growing-church",
        repo: "es-419_obs",
        name: "es-419_obs",
        subject: "Open Bible Stories",
        abbreviation: "obs",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].abbreviation).toBe("obs");
    expect(items[0].type).toBe("obs");
    expect(items[0].owner).toBe("unfoldingWord");
  });

  it("keeps non-UW owner when UW is absent", () => {
    const items = buildAvailabilityForEntries("obs", [
      entry({
        owner: "es-419_gl",
        repo: "es-419_obs",
        name: "es-419_obs",
        subject: "Open Bible Stories",
        abbreviation: "obs",
      }),
      entry({
        owner: "BSA",
        repo: "es-419_obs",
        name: "es-419_obs",
        subject: "Open Bible Stories",
        abbreviation: "obs",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].owner).toBe("es-419_gl");
  });

  it("keeps obs-tq from non-TSV subject label", () => {
    const items = buildAvailabilityForEntries("obsQuestions", [
      entry({
        owner: "es-419_gl",
        repo: "es-419_obs-tq",
        name: "es-419_obs-tq",
        subject: "OBS Translation Questions",
        abbreviation: "obs-tq",
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("obsQuestions");
    expect(items[0].abbreviation).toBe("obs-tq");
    expect(items[0].subject).toBe("OBS Translation Questions");
  });

  it("keeps distinct scripture abbreviations", () => {
    const items = buildAvailabilityForEntries("scripture", [
      entry({
        owner: "unfoldingWord",
        repo: "en_ult",
        name: "en_ult",
        subject: "Aligned Bible",
        abbreviation: "ult",
        ingredients: [{ identifier: "TIT", path: "./57-TIT.usfm" }],
      }),
      entry({
        owner: "unfoldingWord",
        repo: "en_ust",
        name: "en_ust",
        subject: "Aligned Bible",
        abbreviation: "ust",
        ingredients: [{ identifier: "TIT", path: "./57-TIT.usfm" }],
      }),
    ]);

    expect(items.map((i) => i.abbreviation).sort()).toEqual(["ult", "ust"]);
  });
});
