/**
 * Unit tests for draft segment keys, assemble/retrieve by chapter/range, and recall intent.
 */

import { describe, it, expect } from "vitest";
import {
  segmentFromReference,
  segmentKeyFromParts,
  formatSegmentReference,
  assembleDrafts,
  formatAssembledDrafts,
  scopeFromReferenceLoose,
  segmentMatchesScope,
  listSegments,
  outlineSegments,
  detectDraftRecallIntent,
  parseDraftStore,
  emptyDraftStore,
  segmentContainsMeta,
  metaFromSegmentKey,
  resolveDraftBinding,
  isDraftableRef,
  isDraftableMeta,
  assertDraftableSegment,
  DRAFT_RECALL_INTENT,
  isDraftRecallMessage,
  redactedDraftRecallContent,
  redactDraftRecallForOutbound,
  type DraftSegment,
} from "../../src/core/drafts/draftModel.js";

function makeSeg(
  partial: Omit<DraftSegment, "updatedAt"> & { updatedAt?: number },
): DraftSegment {
  return { updatedAt: 1, ...partial };
}

describe("segment keys", () => {
  it("keys a single verse", () => {
    const s = segmentFromReference("Titus 1:1");
    expect(s).not.toBeNull();
    expect(s!.key).toBe("TIT:1:1");
    expect(s!.reference).toBe("TIT 1:1");
  });

  it("keys a verse range", () => {
    const s = segmentFromReference("Tito 1:1-4");
    expect(s).not.toBeNull();
    expect(s!.book).toBe("TIT");
    expect(s!.key).toBe("TIT:1:1-4");
    expect(formatSegmentReference(s!)).toBe("TIT 1:1-4");
  });

  it("keys a whole chapter (recall/assemble only — not draftable)", () => {
    const s = segmentFromReference("TIT 1");
    expect(s).not.toBeNull();
    expect(s!.key).toBe("TIT:1");
    expect(s!.verseStart).toBeUndefined();
  });

  it("builds keys from parts", () => {
    expect(
      segmentKeyFromParts({
        book: "tit",
        chapter: "1",
        verseStart: "2",
        verseEnd: "5",
      }),
    ).toBe("TIT:1:2-5");
  });
});

describe("isDraftableRef / assertDraftableSegment", () => {
  it("rejects book-only and whole-chapter refs", () => {
    expect(isDraftableRef("TIT")).toBe(false);
    expect(isDraftableRef("Titus")).toBe(false);
    expect(isDraftableRef("JON")).toBe(false);
    expect(isDraftableRef("TIT 1")).toBe(false);
    expect(isDraftableRef("JON 1")).toBe(false);
    expect(isDraftableRef("Tito 1")).toBe(false);
    expect(isDraftableRef("")).toBe(false);
    expect(isDraftableRef(null)).toBe(false);
  });

  it("accepts single-verse and verse-range sections", () => {
    expect(isDraftableRef("TIT 1:5")).toBe(true);
    expect(isDraftableRef("TIT 1:1-3")).toBe(true);
    expect(isDraftableRef("JON 1:1-3")).toBe(true);
    expect(isDraftableRef("Titus 1:5-9")).toBe(true);
    expect(isDraftableRef("Tito 1:1")).toBe(true);
  });

  it("isDraftableMeta mirrors verse requirement", () => {
    expect(isDraftableMeta({ book: "TIT", chapter: "1" })).toBe(false);
    expect(
      isDraftableMeta({ book: "TIT", chapter: "1", verseStart: "1" }),
    ).toBe(true);
    expect(
      isDraftableMeta({
        book: "TIT",
        chapter: "1",
        verseStart: "1",
        verseEnd: "4",
      }),
    ).toBe(true);
  });

  it("assertDraftableSegment throws for chapter-only meta", () => {
    expect(() => assertDraftableSegment({ book: "JON", chapter: "1" })).toThrow(
      /verse or verse range/i,
    );
    expect(() =>
      assertDraftableSegment({ book: "TIT", chapter: "1", verseStart: "2" }),
    ).not.toThrow();
  });
});

describe("assemble / retrieve", () => {
  const segments: Record<string, DraftSegment> = {
    "TIT:1:1-4": makeSeg({
      key: "TIT:1:1-4",
      book: "TIT",
      chapter: "1",
      verseStart: "1",
      verseEnd: "4",
      reference: "TIT 1:1-4",
      text: "Borrador A",
    }),
    "TIT:1:5": makeSeg({
      key: "TIT:1:5",
      book: "TIT",
      chapter: "1",
      verseStart: "5",
      reference: "TIT 1:5",
      text: "Borrador B",
    }),
    "TIT:2:1": makeSeg({
      key: "TIT:2:1",
      book: "TIT",
      chapter: "2",
      verseStart: "1",
      reference: "TIT 2:1",
      text: "Cap 2",
    }),
    "JHN:3:16": makeSeg({
      key: "JHN:3:16",
      book: "JHN",
      chapter: "3",
      verseStart: "16",
      reference: "JHN 3:16",
      text: "Juan",
    }),
  };

  it("assembles all segments for a chapter", () => {
    const scope = scopeFromReferenceLoose("Tito 1");
    expect(scope).toEqual({ kind: "chapter", book: "TIT", chapter: "1" });
    const assembled = assembleDrafts(segments, scope!);
    expect(assembled.map((s) => s.key)).toEqual(["TIT:1:1-4", "TIT:1:5"]);
  });

  it("assembles overlapping range segments", () => {
    const scope = scopeFromReferenceLoose("TIT 1:1-4");
    expect(scope?.kind).toBe("range");
    const assembled = assembleDrafts(segments, scope!);
    expect(assembled.map((s) => s.key)).toEqual(["TIT:1:1-4"]);
  });

  it("includes whole-chapter draft when recalling a verse range", () => {
    const withChapter: Record<string, DraftSegment> = {
      ...segments,
      "TIT:1": makeSeg({
        key: "TIT:1",
        book: "TIT",
        chapter: "1",
        reference: "TIT 1",
        text: "Capítulo entero",
      }),
    };
    const scope = scopeFromReferenceLoose("Titus 1:3");
    const assembled = assembleDrafts(withChapter, scope!);
    expect(assembled.map((s) => s.key)).toContain("TIT:1");
    expect(assembled.map((s) => s.key)).toContain("TIT:1:1-4");
  });

  it("assembles whole book", () => {
    const scope = scopeFromReferenceLoose("Titus");
    expect(scope).toEqual({ kind: "book", book: "TIT" });
    const assembled = assembleDrafts(segments, scope!);
    expect(assembled.map((s) => s.key)).toEqual([
      "TIT:1:1-4",
      "TIT:1:5",
      "TIT:2:1",
    ]);
  });

  it("formats assembled markdown", () => {
    const assembled = assembleDrafts(
      segments,
      scopeFromReferenceLoose("Tito 1")!,
    );
    const md = formatAssembledDrafts(assembled, "Tito 1");
    expect(md).toContain("### Mi traducción — Tito 1");
    expect(md).toContain("**TIT 1:1-4**");
    expect(md).toContain("Borrador A");
    expect(md).toContain("Borrador B");
  });

  it("returns empty message when nothing saved", () => {
    const md = formatAssembledDrafts([], "Tito 1");
    expect(md).toMatch(/No hay borradores/);
  });

  it("lists and outlines non-empty segments only", () => {
    const mixed = {
      ...segments,
      "TIT:1:9": makeSeg({
        key: "TIT:1:9",
        book: "TIT",
        chapter: "1",
        verseStart: "9",
        reference: "TIT 1:9",
        text: "   ",
      }),
    };
    expect(listSegments(mixed).every((s) => s.text.trim())).toBe(true);
    const outline = outlineSegments(mixed);
    expect(outline.map((b) => b.book)).toEqual(["JHN", "TIT"]);
    const tit = outline.find((b) => b.book === "TIT")!;
    expect(tit.chapters.map((c) => c.chapter)).toEqual(["1", "2"]);
  });
});

describe("segmentMatchesScope", () => {
  it("matches overlapping ranges", () => {
    expect(
      segmentMatchesScope(
        { book: "TIT", chapter: "1", verseStart: "1", verseEnd: "4" },
        {
          kind: "range",
          book: "TIT",
          chapter: "1",
          verseStart: 3,
          verseEnd: 6,
        },
      ),
    ).toBe(true);
  });

  it("rejects non-overlapping ranges", () => {
    expect(
      segmentMatchesScope(
        { book: "TIT", chapter: "1", verseStart: "1", verseEnd: "2" },
        {
          kind: "range",
          book: "TIT",
          chapter: "1",
          verseStart: 5,
          verseEnd: 6,
        },
      ),
    ).toBe(false);
  });
});

describe("detectDraftRecallIntent", () => {
  it("detects Spanish recall with reference", () => {
    const r = detectDraftRecallIntent("muéstrame mi traducción de Tito 1");
    expect(r.matched).toBe(true);
    expect(r.referenceHint).toMatch(/TIT\s+1/i);
  });

  it("detects recuperar with range", () => {
    const r = detectDraftRecallIntent("recupera Tito 1:1–4");
    expect(r.matched).toBe(true);
    expect(r.referenceHint).toMatch(/TIT\s+1:1-4/i);
  });

  it("detects English show my translation", () => {
    const r = detectDraftRecallIntent("show me my translation of Titus 1");
    expect(r.matched).toBe(true);
    expect(r.referenceHint).toMatch(/TIT\s+1/i);
  });

  it("detects recuperar mi borrador with range", () => {
    const r = detectDraftRecallIntent("recupera mi borrador de Tito 1:1-4");
    expect(r.matched).toBe(true);
    expect(r.referenceHint).toMatch(/TIT\s+1:1-4/i);
  });

  it("ignores unrelated messages", () => {
    expect(detectDraftRecallIntent("Explain Titus 1:1").matched).toBe(false);
  });

  it("does not intercept generic show-me resource requests", () => {
    expect(
      detectDraftRecallIntent("show me the notes for Titus 1").matched,
    ).toBe(false);
    expect(
      detectDraftRecallIntent("muéstrame las notas de Tito 1").matched,
    ).toBe(false);
  });

  it("does not treat drafting / coach answers as recall (false positives)", () => {
    const falsePositives = [
      "voy a redactar",
      "Ya.",
      "Ya",
      "Ya tengo mi traducción",
      "voy a escribir mi traducción",
      "voy a redactar mi traducción ahora",
      "quiero hacer mi traducción de este pasaje",
      "mi traducción",
      "borrador",
      "aquí está mi borrador",
      "Sí, voy a traducir",
      "No entiendo",
      "siervo de Dios",
    ];
    for (const msg of falsePositives) {
      expect(detectDraftRecallIntent(msg).matched, msg).toBe(false);
    }
  });

  it("rejects garbage words as book scopes", () => {
    expect(scopeFromReferenceLoose("Ya")).toBeNull();
    expect(scopeFromReferenceLoose("voy")).toBeNull();
    expect(scopeFromReferenceLoose("este")).toBeNull();
    expect(scopeFromReferenceLoose("Tito")).toEqual({
      kind: "book",
      book: "TIT",
    });
  });
});

describe("resolveDraftBinding (verse drill must not blank the draft)", () => {
  const segments: Record<string, DraftSegment> = {
    "TIT:1:1-4": makeSeg({
      key: "TIT:1:1-4",
      book: "TIT",
      chapter: "1",
      verseStart: "1",
      verseEnd: "4",
      reference: "TIT 1:1-4",
      text: "Pablo, siervo de Dios…",
    }),
  };

  it("segmentContainsMeta covers verse-in-range and rejects out-of-range", () => {
    const parent = metaFromSegmentKey("TIT:1:1-4")!;
    expect(segmentContainsMeta(parent, metaFromSegmentKey("TIT:1:1")!)).toBe(
      true,
    );
    expect(segmentContainsMeta(parent, metaFromSegmentKey("TIT:1:4")!)).toBe(
      true,
    );
    expect(segmentContainsMeta(parent, metaFromSegmentKey("TIT:1:5")!)).toBe(
      false,
    );
    expect(segmentContainsMeta(parent, metaFromSegmentKey("TIT:2:1")!)).toBe(
      false,
    );
    expect(
      segmentContainsMeta(
        metaFromSegmentKey("TIT:1")!,
        metaFromSegmentKey("TIT:1:3")!,
      ),
    ).toBe(true);
  });

  it("keeps the active 1:1-4 editor when drilling into verse 1", () => {
    const decision = resolveDraftBinding({
      reference: "TIT 1:1",
      activeKey: "TIT:1:1-4",
      activeReference: "TIT 1:1-4",
      segments,
    });
    expect(decision).toEqual({ action: "keep" });
  });

  it("still keeps scope when activeReference is missing (falls back to key)", () => {
    const decision = resolveDraftBinding({
      reference: "TIT 1:3",
      activeKey: "TIT:1:1-4",
      activeReference: null,
      segments,
    });
    expect(decision).toEqual({ action: "keep" });
  });

  it("re-binds to a saved parent draft instead of a blank exact segment", () => {
    // No active editor (fresh load) → navigating to TIT 1:2 with no exact
    // draft should surface the saved 1:1-4 parent draft, not a blank editor.
    const decision = resolveDraftBinding({
      reference: "TIT 1:2",
      activeKey: null,
      activeReference: null,
      segments,
    });
    expect(decision).toEqual({
      action: "bind",
      key: "TIT:1:1-4",
      reference: "TIT 1:1-4",
    });
  });

  it("binds normally on explicit navigation outside the active range", () => {
    const decision = resolveDraftBinding({
      reference: "TIT 2:1",
      activeKey: "TIT:1:1-4",
      activeReference: "TIT 1:1-4",
      segments,
    });
    expect(decision).toEqual({
      action: "bind",
      key: "TIT:2:1",
      reference: "TIT 2:1",
    });
  });

  it("refreshes the label for the same segment", () => {
    expect(
      resolveDraftBinding({
        reference: "Tito 1:1-4",
        activeKey: "TIT:1:1-4",
        activeReference: "TIT 1:1-4",
        segments,
      }),
    ).toEqual({ action: "same" });
  });

  it("leaves binding untouched for non-segmentable references", () => {
    expect(
      resolveDraftBinding({
        reference: "???",
        activeKey: "TIT:1:1-4",
        activeReference: "TIT 1:1-4",
        segments,
      }),
    ).toEqual({ action: "none" });
  });

  it("clears the editor for whole-chapter and book-only study refs", () => {
    expect(
      resolveDraftBinding({
        reference: "TIT 1",
        activeKey: "TIT:1:1-4",
        activeReference: "TIT 1:1-4",
        segments,
      }),
    ).toEqual({ action: "clear" });
    expect(
      resolveDraftBinding({
        reference: "JON 1",
        activeKey: null,
        activeReference: null,
        segments: {},
      }),
    ).toEqual({ action: "clear" });
    expect(
      resolveDraftBinding({
        reference: "Titus",
        activeKey: "TIT:1:1-4",
        activeReference: "TIT 1:1-4",
        segments,
      }),
    ).toEqual({ action: "clear" });
  });

  it("does not bind to a legacy whole-chapter parent draft", () => {
    const withChapter: Record<string, DraftSegment> = {
      "TIT:1": makeSeg({
        key: "TIT:1",
        book: "TIT",
        chapter: "1",
        reference: "TIT 1",
        text: "Capítulo entero",
      }),
    };
    const decision = resolveDraftBinding({
      reference: "TIT 1:2",
      activeKey: null,
      activeReference: null,
      segments: withChapter,
    });
    // Empty exact segment + non-draftable parent → bind to the verse itself.
    expect(decision).toEqual({
      action: "bind",
      key: "TIT:1:2",
      reference: "TIT 1:2",
    });
  });
});

describe("draft recall redaction (privacy: draft body never replays to server)", () => {
  const recallCard = formatAssembledDrafts(
    [
      makeSeg({
        key: "TIT:1:1-4",
        book: "TIT",
        chapter: "1",
        verseStart: "1",
        verseEnd: "4",
        reference: "TIT 1:1-4",
        text: "Pablo, siervo de Dios y apóstol de Jesucristo…",
      }),
    ],
    "TIT 1:1-4",
  );

  it("flags recall cards by intent and by markdown shape", () => {
    expect(
      isDraftRecallMessage({
        role: "assistant",
        intent: DRAFT_RECALL_INTENT,
        content: recallCard,
      }),
    ).toBe(true);
    // Restored transcript without intent metadata still matches by shape.
    expect(
      isDraftRecallMessage({ role: "assistant", content: recallCard }),
    ).toBe(true);
    expect(isDraftRecallMessage({ role: "user", content: recallCard })).toBe(
      false,
    );
    expect(
      isDraftRecallMessage({
        role: "assistant",
        content: "Normal coach reply",
      }),
    ).toBe(false);
  });

  it("redacts the draft body from outbound history", () => {
    const outbound = redactDraftRecallForOutbound({
      role: "assistant",
      intent: DRAFT_RECALL_INTENT,
      content: recallCard,
      reference: "TIT 1:1-4",
    });
    expect(outbound).not.toContain("Pablo, siervo de Dios");
    expect(outbound).toContain("TIT 1:1-4");
    expect(outbound).toBe(redactedDraftRecallContent("TIT 1:1-4"));
  });

  it("passes non-recall messages through unchanged", () => {
    expect(
      redactDraftRecallForOutbound({
        role: "assistant",
        content: "¿Qué te costó traducir?",
      }),
    ).toBe("¿Qué te costó traducir?");
    expect(
      redactDraftRecallForOutbound({ role: "user", content: recallCard }),
    ).toBe(recallCard);
  });
});

describe("parseDraftStore", () => {
  it("accepts v1 payload", () => {
    const data = parseDraftStore({
      v: 1,
      segments: {
        "TIT:1:1": {
          key: "TIT:1:1",
          book: "TIT",
          chapter: "1",
          verseStart: "1",
          reference: "TIT 1:1",
          text: "hola",
          updatedAt: 9,
        },
      },
    });
    expect(data?.segments["TIT:1:1"]?.text).toBe("hola");
  });

  it("rejects wrong version", () => {
    expect(parseDraftStore({ v: 2, segments: {} })).toBeNull();
    expect(parseDraftStore(emptyDraftStore())?.v).toBe(1);
  });
});
