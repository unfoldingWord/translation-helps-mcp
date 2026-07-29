/**
 * End-to-end quote → gateway-text resolution over a small aligned USFM fixture.
 *
 * Mirrors what `batchGatewayQuotes` does per note row:
 *   tokenizeUsfm(original) → QuoteMatcher.findOriginalTokens(quote, occurrence)
 *   → tokenizeUsfm(aligned) → QuoteMatcher.findAlignedTokens → joinAlignedTokens
 *
 * Covers: occurrence 1 vs 2 of the same Greek word, a discontinuous
 * multi-part quote (`&`) joined with `…`, and the no-alignment fallback.
 */
import { describe, it, expect } from "vitest";
import { tokenizeUsfm, QuoteMatcher } from "@translation-helps/door43";
import type { QuoteReference } from "@translation-helps/door43";
import { joinAlignedTokens } from "../../../src/api/routes/alignmentHelper.js";

// ---------------------------------------------------------------------------
// Fixtures — one verse, UGNT-style original + ULT-style aligned USFM
// ---------------------------------------------------------------------------

// "Παῦλος δοῦλος Θεοῦ ἐκλεκτῶν Θεοῦ" — Θεοῦ appears twice (occurrences 1 & 2)
const ORIGINAL_USFM = `\\id TIT
\\c 1
\\p
\\v 1 \\w Παῦλος|x-occurrence="1" x-occurrences="1" x-strong="G39720" x-lemma="Παῦλος"\\w* \\w δοῦλος|x-occurrence="1" x-occurrences="1" x-strong="G14010" x-lemma="δοῦλος"\\w* \\w Θεοῦ|x-occurrence="1" x-occurrences="2" x-strong="G23160" x-lemma="θεός"\\w* \\w ἐκλεκτῶν|x-occurrence="1" x-occurrences="1" x-strong="G15880" x-lemma="ἐκλεκτός"\\w* \\w Θεοῦ|x-occurrence="2" x-occurrences="2" x-strong="G23160" x-lemma="θεός"\\w*
`;

// Gateway words (in order): Paul(1) a(2) servant(3) of(4) God(5) chosen(6) of(7) Deity(8)
const ALIGNED_USFM = `\\id TIT
\\c 1
\\p
\\v 1 \\zaln-s |x-strong="G39720" x-lemma="Παῦλος" x-occurrence="1" x-occurrences="1" x-content="Παῦλος"\\*\\w Paul|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* \\zaln-s |x-strong="G14010" x-lemma="δοῦλος" x-occurrence="1" x-occurrences="1" x-content="δοῦλος"\\*\\w a|x-occurrence="1" x-occurrences="1"\\w* \\w servant|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* \\zaln-s |x-strong="G23160" x-lemma="θεός" x-occurrence="1" x-occurrences="2" x-content="Θεοῦ"\\*\\w of|x-occurrence="1" x-occurrences="2"\\w* \\w God|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* \\zaln-s |x-strong="G15880" x-lemma="ἐκλεκτός" x-occurrence="1" x-occurrences="1" x-content="ἐκλεκτῶν"\\*\\w chosen|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\* \\zaln-s |x-strong="G23160" x-lemma="θεός" x-occurrence="2" x-occurrences="2" x-content="Θεοῦ"\\*\\w of|x-occurrence="2" x-occurrences="2"\\w* \\w Deity|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*
`;

// ULT with no alignment markers (e.g. a GL translation without zaln data)
const PLAIN_USFM = `\\id TIT
\\c 1
\\p
\\v 1 Paul a servant of God chosen of Deity
`;

const REF: QuoteReference = {
  book: "TIT",
  startChapter: 1,
  startVerse: 1,
  endVerse: 1,
};

/** Resolve a (quote, occurrence) pair to a joined gateway string, like batchGatewayQuotes. */
function resolve(
  quote: string,
  occurrence: number,
  alignedUsfm = ALIGNED_USFM,
): string | null {
  const origChapters = tokenizeUsfm(ORIGINAL_USFM, "TIT", "el-x-koine");
  const alignedChapters = tokenizeUsfm(alignedUsfm, "TIT", "en");
  const matcher = new QuoteMatcher();

  const orig = matcher.findOriginalTokens(origChapters, quote, occurrence, REF);
  if (!orig.success || orig.totalTokens.length === 0) return null;

  const aligned = matcher.findAlignedTokens(
    orig.totalTokens,
    alignedChapters,
    REF,
  );
  if (!aligned.success || aligned.totalAlignedTokens.length === 0) return null;

  return joinAlignedTokens(aligned.totalAlignedTokens);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("quote → gateway-text resolution (aligned USFM fixture)", () => {
  it("resolves a single-word quote to its aligned gateway words (occurrence 1)", () => {
    expect(resolve("Θεοῦ", 1)).toBe("of God");
  });

  it("resolves occurrence 2 of the same word to different gateway words", () => {
    expect(resolve("Θεοῦ", 2)).toBe("of Deity");
  });

  it("resolves a contiguous multi-word quote", () => {
    expect(resolve("Παῦλος δοῦλος", 1)).toBe("Paul a servant");
  });

  it("joins a discontinuous & quote with … between gateway spans", () => {
    // Παῦλος → "Paul" (word 1); ἐκλεκτῶν → "chosen" (word 6); gap > 1 → ellipsis
    expect(resolve("Παῦλος & ἐκλεκτῶν", 1)).toBe("Paul … chosen");
  });

  it("returns null when the quote is not found in the original text", () => {
    expect(resolve("λόγος", 1)).toBeNull();
  });

  it("returns null when the gateway text has no alignment markers (fallback path)", () => {
    expect(resolve("Θεοῦ", 1, PLAIN_USFM)).toBeNull();
  });
});
