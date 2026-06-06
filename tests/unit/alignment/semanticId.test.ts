import { describe, it, expect } from "vitest";
import { generateSemanticId } from "../../../src/core/alignment/semanticId.js";

describe("generateSemanticId", () => {
  it("returns a non-negative integer", () => {
    const id = generateSemanticId("Παῦλος", "tit 1:1", 1);
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThan(1_000_000);
  });

  it("is deterministic — same inputs always produce same output", () => {
    const a = generateSemanticId("Παῦλος", "tit 1:1", 1);
    const b = generateSemanticId("Παῦλος", "tit 1:1", 1);
    expect(a).toBe(b);
  });

  it("differs for different words", () => {
    const a = generateSemanticId("Παῦλος", "tit 1:1", 1);
    const b = generateSemanticId("δοῦλος", "tit 1:1", 1);
    expect(a).not.toBe(b);
  });

  it("differs for different occurrences", () => {
    const a = generateSemanticId("Θεοῦ", "tit 1:1", 1);
    const b = generateSemanticId("Θεοῦ", "tit 1:1", 2);
    expect(a).not.toBe(b);
  });

  it("differs for different verse references", () => {
    const a = generateSemanticId("Παῦλος", "tit 1:1", 1);
    const b = generateSemanticId("Παῦλος", "tit 1:2", 1);
    expect(a).not.toBe(b);
  });

  it("defaults occurrence to 1", () => {
    const a = generateSemanticId("word", "jhn 3:16");
    const b = generateSemanticId("word", "jhn 3:16", 1);
    expect(a).toBe(b);
  });
});
