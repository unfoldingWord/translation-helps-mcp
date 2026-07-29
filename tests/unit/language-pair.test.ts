import { describe, expect, it } from "vitest";
import {
  isGatewayLanguage,
  isNeutralTarget,
  isSameLanguageFamily,
  languagePairPromptGuidance,
  NEUTRAL_TARGET_LABEL,
  primarySubtag,
  resolveLanguagePair,
} from "../../src/core/harness/languagePair.js";

describe("resolveLanguagePair", () => {
  it("defaults source en + neutral target when nothing is set", () => {
    expect(resolveLanguagePair({})).toEqual({
      sourceLanguage: "en",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
  });

  it("maps legacy gateway language to SOURCE with neutral target", () => {
    expect(resolveLanguagePair({ language: "es-419" })).toEqual({
      sourceLanguage: "es-419",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
  });

  it("maps legacy en to source with neutral target", () => {
    expect(resolveLanguagePair({ language: "en" })).toEqual({
      sourceLanguage: "en",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
  });

  it("keeps legacy non-gateway (heart) language as receptor target", () => {
    expect(resolveLanguagePair({ language: "tzo" })).toEqual({
      sourceLanguage: "en",
      targetLanguage: "tzo",
    });
  });

  it("source-only onboarding pick leaves target neutral", () => {
    const pair = resolveLanguagePair({ sourceLanguage: "es-419" });
    expect(pair).toEqual({
      sourceLanguage: "es-419",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
    expect(isNeutralTarget(pair.targetLanguage)).toBe(true);
  });

  it("honors explicit source + target", () => {
    expect(
      resolveLanguagePair({
        sourceLanguage: "es-419",
        targetLanguage: "es-419",
      }),
    ).toEqual({
      sourceLanguage: "es-419",
      targetLanguage: "es-419",
    });
  });

  it("legacy gateway language becomes source alongside explicit target", () => {
    expect(
      resolveLanguagePair({
        language: "fr",
        targetLanguage: "es-419",
      }),
    ).toEqual({
      sourceLanguage: "fr",
      targetLanguage: "es-419",
    });
  });

  it("allows English source with Spanish target for EN→ES", () => {
    const pair = resolveLanguagePair({
      sourceLanguage: "en",
      targetLanguage: "es-419",
    });
    expect(pair).toEqual({ sourceLanguage: "en", targetLanguage: "es-419" });
    expect(isSameLanguageFamily(pair)).toBe(false);
  });

  it("trims whitespace and ignores empty explicit source", () => {
    expect(
      resolveLanguagePair({
        language: "  pt-br  ",
        sourceLanguage: "   ",
      }),
    ).toEqual({
      sourceLanguage: "pt-br",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
  });

  it("never treats the neutral label as a language code", () => {
    expect(
      resolveLanguagePair({
        language: NEUTRAL_TARGET_LABEL,
        sourceLanguage: "es-419",
      }),
    ).toEqual({
      sourceLanguage: "es-419",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
  });
});

describe("isGatewayLanguage / isNeutralTarget", () => {
  it("recognizes gateway languages by primary subtag", () => {
    expect(isGatewayLanguage("en")).toBe(true);
    expect(isGatewayLanguage("es-419")).toBe(true);
    expect(isGatewayLanguage("pt-br")).toBe(true);
    expect(isGatewayLanguage("tzo")).toBe(false);
  });

  it("recognizes the neutral target placeholder", () => {
    expect(isNeutralTarget(NEUTRAL_TARGET_LABEL)).toBe(true);
    expect(isNeutralTarget("")).toBe(true);
    expect(isNeutralTarget(undefined)).toBe(true);
    expect(isNeutralTarget("es-419")).toBe(false);
  });
});

describe("primarySubtag", () => {
  it("extracts primary subtag", () => {
    expect(primarySubtag("es-419")).toBe("es");
    expect(primarySubtag("EN")).toBe("en");
  });
});

describe("languagePairPromptGuidance", () => {
  it("makes coach speak source and treats target as metadata for EN→ES", () => {
    const text = languagePairPromptGuidance({
      sourceLanguage: "en",
      targetLanguage: "es-419",
    });
    expect(text).toMatch(/SOURCE \/ CONVERSATION LANGUAGE: en/);
    expect(text).toMatch(/TARGET \/ RECEPTOR LANGUAGE/);
    expect(text).toMatch(/es-419/);
    expect(text).toMatch(/Never reply in the target language/i);
    expect(text).toMatch(/Always reply in sourceLanguage \(en\)/i);
    expect(text).toMatch(/receptor metadata only/i);
    expect(text).toMatch(
      /Never praise, correct, translate-for-them, or evaluate/i,
    );
    expect(text).not.toMatch(
      /reply entirely in this language; the user's draft/i,
    );
  });

  it("uses source conversation line when same family", () => {
    const text = languagePairPromptGuidance({
      sourceLanguage: "en",
      targetLanguage: "en",
    });
    expect(text).toMatch(/SOURCE \/ CONVERSATION LANGUAGE: en/);
    expect(text).toMatch(/do not evaluate target-language/i);
    expect(text).toMatch(/Always reply in sourceLanguage \(en\)/i);
  });

  it("describes an unknown receptor when the target is neutral", () => {
    const text = languagePairPromptGuidance({
      sourceLanguage: "es-419",
      targetLanguage: NEUTRAL_TARGET_LABEL,
    });
    expect(text).toMatch(/SOURCE \/ CONVERSATION LANGUAGE: es-419/);
    expect(text).toMatch(/the user's own language, unknown to you/i);
    expect(text).toMatch(/never need to ask what it is/i);
  });

  it("treats quoted target words as content, never a language-switch cue", () => {
    for (const pair of [
      { sourceLanguage: "en", targetLanguage: "es-419" },
      { sourceLanguage: "en", targetLanguage: "en" },
    ]) {
      const text = languagePairPromptGuidance(pair);
      expect(text).toMatch(/Quoted words or phrases/i);
      expect(text).toMatch(/NEVER a signal to switch/i);
      expect(text).toMatch(/framing language/i);
      expect(text).toMatch(/explicitly asks/i);
    }
  });
});
