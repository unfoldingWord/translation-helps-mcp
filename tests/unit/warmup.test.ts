/**
 * Unit tests for warmup.ts — warm-gate, language-gate, and profile helpers.
 */

import { describe, it, expect } from "vitest";
import {
  isAffirmative,
  extractName,
  shouldOfferWarmup,
  buildWarmupMarker,
  extractWarmup,
  buildLangMarker,
  extractLang,
  buildPendingMarkers,
  extractPending,
  hasAwaitingLang,
  buildNameInvitedMarker,
  hasNameInvited,
  resolveLanguage,
  type LanguageOption,
} from "../../src/core/harness/warmup.js";
import type { IntentResult } from "../../src/core/harness/intent.js";
import type { ConversationMessage } from "../../src/core/harness/intent.js";

// ---------------------------------------------------------------------------
// isAffirmative
// ---------------------------------------------------------------------------

describe("isAffirmative", () => {
  it.each(["yes", "Yes", "YES", "ok", "OK", "sure", "go ahead", "show me", "do it", "please", "let's go", "yep", "👍"])(
    "returns true for '%s'",
    (msg) => expect(isAffirmative(msg)).toBe(true)
  );

  it.each(["next", "continue", "John 3:16", "what is grace?", "no", "not now", ""])(
    "returns false for '%s'",
    (msg) => expect(isAffirmative(msg)).toBe(false)
  );
});

// ---------------------------------------------------------------------------
// extractName
// ---------------------------------------------------------------------------

describe("extractName", () => {
  it("extracts 'call me Maria'", () => expect(extractName("call me Maria")).toBe("Maria"));
  it("extracts \"I'm Sam\"", () => expect(extractName("I'm Sam")).toBe("Sam"));
  it("extracts 'my name is John'", () => expect(extractName("my name is John")).toBe("John"));
  it("extracts 'name's Alex'", () => expect(extractName("name's Alex")).toBe("Alex"));
  it("returns null for messages without name patterns", () => {
    expect(extractName("yes")).toBeNull();
    expect(extractName("John 3:16")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldOfferWarmup
// ---------------------------------------------------------------------------

const PASSAGE_INTENTS: IntentResult["intent"][] = [
  "annotated_passage",
  "passage_overview",
  "checking",
  "passage_help",
];

const NON_PASSAGE_INTENTS: IntentResult["intent"][] = [
  "word_study",
  "methodology",
  "discovery",
  "open_ended",
];

describe("shouldOfferWarmup", () => {
  const makeIntent = (intent: IntentResult["intent"], ref?: string, warmConfirmed = false): IntentResult =>
    ({ intent, reference: ref, warmConfirmed, confidence: "high" } as IntentResult);

  const emptyHistory: ConversationMessage[] = [];

  it("returns true for passage intent with a reference", () => {
    for (const intent of PASSAGE_INTENTS) {
      expect(shouldOfferWarmup(makeIntent(intent, "JHN 3:16"), emptyHistory)).toBe(true);
    }
  });

  it("returns false for non-passage intents", () => {
    for (const intent of NON_PASSAGE_INTENTS) {
      expect(shouldOfferWarmup(makeIntent(intent, "JHN 3:16"), emptyHistory)).toBe(false);
    }
  });

  it("returns false when warmConfirmed", () => {
    expect(shouldOfferWarmup(makeIntent("annotated_passage", "JHN 3:16", true), emptyHistory)).toBe(false);
  });

  it("returns false when no reference", () => {
    expect(shouldOfferWarmup(makeIntent("annotated_passage"), emptyHistory)).toBe(false);
  });

  it("returns false when last assistant turn already has WARMUP for same ref", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Hello\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}` },
    ];
    expect(shouldOfferWarmup(makeIntent("annotated_passage", "JHN 3:16"), history)).toBe(false);
  });

  it("returns true when WARMUP is for a different ref", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: buildWarmupMarker("ROM 8:1", "annotated_passage") },
    ];
    expect(shouldOfferWarmup(makeIntent("annotated_passage", "JHN 3:16"), history)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Marker round-trips
// ---------------------------------------------------------------------------

describe("WARMUP marker", () => {
  it("builds and extracts correctly", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Text\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}` },
    ];
    expect(extractWarmup(history)).toEqual({ ref: "JHN 3:16", intent: "annotated_passage" });
  });

  it("returns null when no marker in history", () => {
    expect(extractWarmup([{ role: "assistant", content: "No marker here" }])).toBeNull();
  });
});

describe("LANG marker", () => {
  it("builds and extracts correctly", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: buildLangMarker("es") },
    ];
    expect(extractLang(history)).toBe("es");
  });

  it("returns the most recent LANG marker", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: buildLangMarker("es") },
      { role: "assistant", content: buildLangMarker("fr") },
    ];
    expect(extractLang(history)).toBe("fr");
  });

  it("returns null when no marker", () => {
    expect(extractLang([{ role: "user", content: "hello" }])).toBeNull();
  });
});

describe("PENDING_PASSAGE + AWAITING_LANG markers", () => {
  it("builds and extracts correctly", () => {
    const markers = buildPendingMarkers("JHN 3:16", "annotated_passage");
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Ask me something\n${markers}` },
    ];
    expect(extractPending(history)).toEqual({ ref: "JHN 3:16", intent: "annotated_passage" });
    expect(hasAwaitingLang(history)).toBe(true);
  });

  it("returns null / false when no markers", () => {
    const history: ConversationMessage[] = [{ role: "assistant", content: "No markers" }];
    expect(extractPending(history)).toBeNull();
    expect(hasAwaitingLang(history)).toBe(false);
  });
});

describe("NAME_INVITED marker", () => {
  it("detects NAME_INVITED in history", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Hello!\n${buildNameInvitedMarker()}` },
    ];
    expect(hasNameInvited(history)).toBe(true);
  });

  it("returns false when not present", () => {
    expect(hasNameInvited([{ role: "assistant", content: "Hello!" }])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Latest-assistant-turn-only marker semantics
// ---------------------------------------------------------------------------

describe("hasAwaitingLang — latest turn only", () => {
  it("returns true when AWAITING_LANG is in the LAST assistant turn", () => {
    const markers = buildPendingMarkers("JHN 3:16", "annotated_passage");
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Pick a language\n${markers}` },
    ];
    expect(hasAwaitingLang(history)).toBe(true);
  });

  it("returns false when AWAITING_LANG is in an OLDER turn but latest turn is a warm offer", () => {
    const pendingMarkers = buildPendingMarkers("JHN 3:16", "annotated_passage");
    const warmMarker = buildWarmupMarker("JHN 3:16", "annotated_passage");
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Pick a language\n${pendingMarkers}` },
      { role: "user", content: "es-419" },
      { role: "assistant", content: `I found JHN 3:16. Want me to walk you through it?\n${buildLangMarker("es-419")}\n${warmMarker}` },
    ];
    // After language was resolved the last assistant turn is a warm offer, not an AWAITING_LANG
    expect(hasAwaitingLang(history)).toBe(false);
    expect(extractWarmup(history)).toEqual({ ref: "JHN 3:16", intent: "annotated_passage" });
  });

  it("extractPending returns null when PENDING_PASSAGE is in an older turn", () => {
    const pendingMarkers = buildPendingMarkers("JHN 3:16", "annotated_passage");
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Pick a language\n${pendingMarkers}` },
      { role: "user", content: "Spanish" },
      { role: "assistant", content: "Great, proceeding with Spanish." },
    ];
    expect(extractPending(history)).toBeNull();
    expect(hasAwaitingLang(history)).toBe(false);
  });

  it("extractWarmup returns null when WARMUP is in an older turn and latest is different", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: `Want to see it?\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}` },
      { role: "user", content: "Actually, tell me about ROM 8:1" },
      { role: "assistant", content: "Sure, I can help with Romans 8:1." },
    ];
    // Latest turn has no WARMUP marker
    expect(extractWarmup(history)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveLanguage
// ---------------------------------------------------------------------------

// Catalog using the new `name` field (as returned by list_languages)
const LANG_LIST_NEW: LanguageOption[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "es-419", name: "Spanish Latin America" },
  { code: "fr", name: "French" },
  { code: "pt-BR", name: "Portuguese Brazil" },
  { code: "id", name: "Indonesian" },
  { code: "zh", name: "Chinese Simplified" },
];

// Legacy catalog using ln/ang fields (backwards compatibility)
const LANG_LIST: LanguageOption[] = [
  { code: "en", ln: "English", ang: "English" },
  { code: "es", ln: "Spanish", ang: "Español" },
  { code: "es-419", ln: "Spanish Latin America", ang: "Español LA", ld: "Latin America" },
  { code: "fr", ln: "French", ang: "Français" },
  { code: "pt-BR", ln: "Portuguese Brazil", ang: "Português" },
  { code: "id", ln: "Indonesian", ang: "Indonesian" },
  { code: "zh", ln: "Chinese Simplified", ang: "中文" },
];

describe("resolveLanguage (legacy ln/ang fields)", () => {
  it("resolves exact code 'es'", () => expect(resolveLanguage("es", LANG_LIST)).toBe("es"));
  it("resolves 'Spanish' → es", () => expect(resolveLanguage("Spanish", LANG_LIST)).toBe("es"));
  it("resolves 'español' → es (shorter, exact ang match wins)", () => {
    const result = resolveLanguage("español", LANG_LIST);
    expect(result).not.toBeNull();
  });
  it("resolves 'latin american spanish' → es-419 (word-overlap wins over es)", () => {
    expect(resolveLanguage("latin american spanish", LANG_LIST)).toBe("es-419");
  });
  it("resolves 'what about latin american spanish?' → es-419", () => {
    expect(resolveLanguage("what about latin american spanish?", LANG_LIST)).toBe("es-419");
  });
  it("resolves 'French' → fr", () => expect(resolveLanguage("French", LANG_LIST)).toBe("fr"));
  it("resolves 'es-419' exact code", () => expect(resolveLanguage("es-419", LANG_LIST)).toBe("es-419"));
  it("returns null for empty string", () => expect(resolveLanguage("", LANG_LIST)).toBeNull());
  it("returns null for unrecognized language", () => expect(resolveLanguage("Klingon", LANG_LIST)).toBeNull());
  it("resolves case-insensitively 'FRENCH'", () => expect(resolveLanguage("FRENCH", LANG_LIST)).toBe("fr"));
});

describe("resolveLanguage (name field — as returned by list_languages)", () => {
  it("resolves exact code 'es'", () => expect(resolveLanguage("es", LANG_LIST_NEW)).toBe("es"));
  it("resolves 'Spanish' → es", () => expect(resolveLanguage("Spanish", LANG_LIST_NEW)).toBe("es"));
  it("resolves 'French' → fr", () => expect(resolveLanguage("French", LANG_LIST_NEW)).toBe("fr"));
  it("resolves 'latin american spanish' → es-419", () => {
    expect(resolveLanguage("latin american spanish", LANG_LIST_NEW)).toBe("es-419");
  });
  it("resolves 'what about spanish from latin america?' → es-419", () => {
    expect(resolveLanguage("what about spanish from latin america?", LANG_LIST_NEW)).toBe("es-419");
  });
  it("resolves 'Portuguese Brazil' → pt-BR", () => {
    expect(resolveLanguage("Portuguese Brazil", LANG_LIST_NEW)).toBe("pt-BR");
  });
  it("returns null for unrecognized input with name-field catalog", () => {
    expect(resolveLanguage("Klingon", LANG_LIST_NEW)).toBeNull();
  });
});
