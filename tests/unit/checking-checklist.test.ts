/**
 * Unit tests for the read-only checking checklist model + marker parse.
 */
import { describe, it, expect } from "vitest";
import {
  emptyChecklistStore,
  upsertChecklistItems,
  completeChecklistItem,
  parseCheckMarkers,
  applyCheckMarkers,
  getPassageChecklist,
  checklistProgress,
  seedsFromResourcePayloads,
  formatChecklistStudyContext,
  parseChecklistStore,
  normalizePassageKey,
  CHECKLIST_MARKER_INSTRUCTIONS,
  parseUncheckedFromStudyContext,
  findChecklistIdsInText,
  appendCheckMarkersToResponse,
  resolveValidatedCheckMarkers,
  looksLikeCheckingValidation,
  buildCheckMarker,
  noteItemTitle,
} from "../../src/core/checklist/checkingChecklist.js";

describe("normalizePassageKey", () => {
  it("uppercases and collapses whitespace", () => {
    expect(normalizePassageKey("  tit  1:1-4 ")).toBe("TIT 1:1-4");
  });
});

describe("upsertChecklistItems", () => {
  it("adds unchecked items by default", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "grace" },
      { kind: "tw", resourceId: "bible/kt/grace", title: "grace" },
      { kind: "tq", resourceId: "q1", title: "What is grace?" },
    ]);
    const passage = getPassageChecklist(store, "TIT 1:1");
    expect(passage).not.toBeNull();
    expect(checklistProgress(passage).total).toBe(3);
    expect(checklistProgress(passage).completed).toBe(0);
    expect(passage!.items["note:n1"].completed).toBe(false);
  });

  it("preserves completed state when re-upserting the same ids", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "old title" },
    ]);
    store = completeChecklistItem(store, "TIT 1:1", "note", "n1");
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "new title" },
      { kind: "note", resourceId: "n2", title: "another" },
    ]);
    const passage = getPassageChecklist(store, "tit 1:1");
    expect(passage!.items["note:n1"].completed).toBe(true);
    expect(passage!.items["note:n1"].title).toBe("new title");
    expect(passage!.items["note:n2"].completed).toBe(false);
    expect(checklistProgress(passage).completed).toBe(1);
    expect(checklistProgress(passage).total).toBe(2);
  });

  it("does not wipe items missing from a later seed list", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "tw", resourceId: "bible/kt/god", title: "God" },
    ]);
    store = completeChecklistItem(store, "TIT 1:1", "tw", "bible/kt/god");
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "only notes this time" },
    ]);
    const passage = getPassageChecklist(store, "TIT 1:1");
    expect(passage!.items["tw:bible/kt/god"].completed).toBe(true);
    expect(passage!.items["note:n1"]).toBeDefined();
  });
});

describe("parseCheckMarkers / applyCheckMarkers", () => {
  it("parses note, tw, and tq markers", () => {
    const text = `
Good — you thought through that.
<!-- CHECK:note:abc-123 -->
And the key term:
<!-- CHECK:tw:bible/kt/grace -->
<!-- CHECK:tq:q-9 -->
`;
    expect(parseCheckMarkers(text)).toEqual([
      { kind: "note", resourceId: "abc-123" },
      { kind: "tw", resourceId: "bible/kt/grace" },
      { kind: "tq", resourceId: "q-9" },
    ]);
  });

  it("dedupes repeated markers", () => {
    const text =
      "<!-- CHECK:note:n1 -->\n<!-- CHECK:note:n1 -->\n<!-- CHECK:tw:path -->";
    expect(parseCheckMarkers(text)).toHaveLength(2);
  });

  it("marks matching items complete without touching others", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1-4", [
      { kind: "note", resourceId: "n1", title: "A" },
      { kind: "tw", resourceId: "bible/kt/grace", title: "grace" },
      { kind: "tq", resourceId: "q1", title: "Q" },
    ]);
    store = applyCheckMarkers(
      store,
      "TIT 1:1-4",
      "ok\n<!-- CHECK:tw:bible/kt/grace -->\n",
    );
    const passage = getPassageChecklist(store, "TIT 1:1-4")!;
    expect(passage.items["tw:bible/kt/grace"].completed).toBe(true);
    expect(passage.items["note:n1"].completed).toBe(false);
    expect(passage.items["tq:q1"].completed).toBe(false);
  });

  it("is a no-op for unknown ids", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "A" },
    ]);
    const next = applyCheckMarkers(
      store,
      "TIT 1:1",
      "<!-- CHECK:note:missing -->",
    );
    expect(next).toEqual(store);
  });
});

describe("seedsFromResourcePayloads", () => {
  it("builds seeds from TN / TW / TQ shapes; TW prefers wordPath", () => {
    const seeds = seedsFromResourcePayloads({
      notes: [
        { id: "n1", quote: "grace", noteText: "Explain grace", verse: "1" },
      ],
      words: [
        {
          id: "w1",
          term: "grace",
          wordPath: "bible/kt/grace",
          verse: "1",
        },
      ],
      questions: [{ id: "q1", question: "What is grace?", verse: "1" }],
    });
    expect(seeds).toEqual([
      {
        kind: "note",
        resourceId: "n1",
        title: "grace",
        subtitle: "Explain grace",
        verse: "1",
      },
      {
        kind: "tw",
        resourceId: "bible/kt/grace",
        title: "grace",
        subtitle: undefined,
        verse: "1",
      },
      {
        kind: "tq",
        resourceId: "q1",
        title: "What is grace?",
        subtitle: undefined,
        verse: "1",
      },
    ]);
  });

  it("uses the alignment-resolved gateway quote as the note title (no raw Greek)", () => {
    const seeds = seedsFromResourcePayloads({
      notes: [
        {
          id: "n1",
          quote: "ἐκλεκτῶν Θεοῦ",
          gatewayQuote: {
            original: "ἐκλεκτῶν Θεοῦ",
            aligned: "chosen people of God",
          },
          noteText: "Explain the phrase",
          verse: "1",
        },
      ],
    });
    expect(seeds[0].title).toBe("chosen people of God");
    expect(seeds[0].subtitle).toBe("Explain the phrase");
  });

  it("falls back to the original quote when alignment is unavailable", () => {
    const seeds = seedsFromResourcePayloads({
      notes: [
        {
          id: "n1",
          quote: "ἐκλεκτῶν Θεοῦ",
          gatewayQuote: { original: "ἐκλεκτῶν Θεοῦ", aligned: "" },
          noteText: "Explain the phrase",
          verse: "1",
        },
      ],
    });
    expect(seeds[0].title).toBe("ἐκλεκτῶν Θεοῦ");
  });
});

describe("noteItemTitle", () => {
  it("prefers gatewayQuote.aligned over the original quote", () => {
    expect(
      noteItemTitle({
        id: "n1",
        quote: "ἐπ' ἐλπίδι",
        gatewayQuote: { original: "ἐπ' ἐλπίδι", aligned: "in the hope" },
        noteText: "body",
      }),
    ).toBe("in the hope");
  });

  it("formats & separators as … when falling back to the original quote", () => {
    expect(
      noteItemTitle({
        id: "n1",
        quote: "Παῦλος & ἐκλεκτῶν",
        noteText: "body",
      }),
    ).toBe("Παῦλος … ἐκλεκτῶν");
  });

  it("uses gatewayQuote.original when present and aligned is missing", () => {
    expect(
      noteItemTitle({
        id: "n1",
        gatewayQuote: { original: "καὶ ἐπίγνωσιν … ἀληθείας" },
        noteText: "body",
      }),
    ).toBe("καὶ ἐπίγνωσιν … ἀληθείας");
  });

  it("falls back to the note's first line when there is no quote at all", () => {
    expect(
      noteItemTitle({ id: "n1", noteText: "First line explanation\nmore" }),
    ).toBe("First line explanation more");
  });

  it("falls back to the note id when everything is empty", () => {
    expect(noteItemTitle({ id: "n1", noteText: "" })).toBe("n1");
  });
});

describe("formatChecklistStudyContext", () => {
  it("includes progress and unchecked markers", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "grace" },
    ]);
    store = completeChecklistItem(store, "TIT 1:1", "note", "n1");
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "tw", resourceId: "bible/kt/god", title: "God" },
    ]);
    const text = formatChecklistStudyContext(
      getPassageChecklist(store, "TIT 1:1"),
    );
    expect(text).toMatch(/1\/2 complete/);
    expect(text).toMatch(/\[x\] note:n1/);
    expect(text).toMatch(/\[ \] tw:bible\/kt\/god/);
    expect(text).toMatch(/CHECK:kind:id/);
  });
});

describe("parseChecklistStore", () => {
  it("round-trips valid data and rejects bad shapes", () => {
    let store = emptyChecklistStore();
    store = upsertChecklistItems(store, "TIT 1:1", [
      { kind: "note", resourceId: "n1", title: "A" },
    ]);
    expect(parseChecklistStore(store)).not.toBeNull();
    expect(parseChecklistStore({ v: 99, passages: {} })).toBeNull();
    expect(parseChecklistStore(null)).toBeNull();
  });
});

describe("CHECKLIST_MARKER_INSTRUCTIONS", () => {
  it("documents the three marker kinds", () => {
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/CHECK:note:/);
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/CHECK:tw:/);
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/CHECK:tq:/);
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/read-only/i);
  });
});

describe("programmatic CHECK marker append", () => {
  const studyCtx = `Checking checklist for TIT 1:1-4: 0/3 complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).
[ ] note:rtc9 v.1 — grace
[ ] note:xrtm v.1 — servant
[ ] note:fyf8 v.2 — hope
[x] tw:bible/kt/god — God`;

  it("parses unchecked STUDY CONTEXT lines with titles", () => {
    expect(parseUncheckedFromStudyContext(studyCtx)).toEqual([
      { kind: "note", resourceId: "rtc9", title: "grace" },
      { kind: "note", resourceId: "xrtm", title: "servant" },
      { kind: "note", resourceId: "fyf8", title: "hope" },
    ]);
  });

  it("finds discussed note ids in prior assistant probes", () => {
    const prior = "Sobre rtc9 (gracia) y xrtm (siervo): ¿cómo los tradujiste?";
    const found = findChecklistIdsInText(
      prior,
      parseUncheckedFromStudyContext(studyCtx),
    );
    expect(found.map((f) => f.resourceId).sort()).toEqual(["rtc9", "xrtm"]);
  });

  it("appends missing markers without duplicating", () => {
    const withOne = `Ok.\n${buildCheckMarker("note", "rtc9")}`;
    const next = appendCheckMarkersToResponse(withOne, [
      { kind: "note", resourceId: "rtc9" },
      { kind: "note", resourceId: "xrtm" },
    ]);
    expect(parseCheckMarkers(next)).toEqual([
      { kind: "note", resourceId: "rtc9" },
      { kind: "note", resourceId: "xrtm" },
    ]);
  });

  it("resolveValidatedCheckMarkers skips session start", () => {
    expect(
      resolveValidatedCheckMarkers({
        userMessage: "traduje gracia como…",
        priorAssistantContent: "Sobre rtc9…",
        studyContext: studyCtx,
        isSessionStart: true,
      }),
    ).toEqual([]);
  });

  it("resolveValidatedCheckMarkers marks discussed unchecked ids on validation", () => {
    const markers = resolveValidatedCheckMarkers({
      userMessage: "Traduje gracia como favor, y siervo como servidor.",
      priorAssistantContent:
        "Vamos con rtc9 y xrtm. ¿Cómo manejaste esos puntos?",
      studyContext: studyCtx,
      isSessionStart: false,
    });
    expect(markers.map((m) => m.resourceId).sort()).toEqual(["rtc9", "xrtm"]);
  });

  it("looksLikeCheckingValidation rejects pure clarification", () => {
    expect(looksLikeCheckingValidation("no entiendo")).toBe(false);
    expect(looksLikeCheckingValidation("Lo traduje como favor")).toBe(true);
  });
});

describe("TW / TQ marker matching (Bug: Palabras clave never tick)", () => {
  const twCtx = `Checking checklist for TIT 1:1-4: 2/6 complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).
[x] note:done1 v.1 — apostle
[ ] tw:bible/kt/faith v.1 — faith, faithful
[ ] tw:bible/kt/godly v.1 — godliness
[ ] tw:bible/kt/elect v.1 — chosen, elect
[x] tw:bible/kt/god — God
[ ] tq:q42 v.2 — What did Paul hope the believers would receive?`;

  it("matches TW items by term named in the coach probe (no path in text)", () => {
    const unchecked = parseUncheckedFromStudyContext(twCtx);
    const probe =
      "How did you translate faith in verse 1? Does your word carry trust, not just belief?";
    const found = findChecklistIdsInText(probe, unchecked);
    expect(found.map((f) => f.resourceId)).toEqual(["bible/kt/faith"]);
  });

  it("matches TW items from the user's answer naming the term", () => {
    const markers = resolveValidatedCheckMarkers({
      userMessage:
        "For godliness I used 'vivir para Dios', and for chosen I said 'escogidos'.",
      priorAssistantContent: "Let's look at two key terms in verse 1.",
      studyContext: twCtx,
      isSessionStart: false,
    });
    expect(markers.map((m) => m.resourceId).sort()).toEqual([
      "bible/kt/elect",
      "bible/kt/godly",
    ]);
  });

  it("matches TW by word-path last segment when title is missing", () => {
    const found = findChecklistIdsInText(
      "Hablemos de elect en el versículo 1.",
      [{ kind: "tw", resourceId: "bible/kt/elect" }],
    );
    expect(found.map((f) => f.resourceId)).toEqual(["bible/kt/elect"]);
  });

  it("does not tick a TW term on partial-word matches (god vs godliness)", () => {
    const found = findChecklistIdsInText(
      "You mentioned godliness in your draft.",
      [{ kind: "tw", resourceId: "bible/kt/god", title: "God" }],
    );
    expect(found).toEqual([]);
  });

  it("matches TQ items when the probe quotes the question text", () => {
    const unchecked = parseUncheckedFromStudyContext(twCtx);
    const probe =
      "One more from the panel: What did Paul hope the believers would receive?";
    const found = findChecklistIdsInText(probe, unchecked);
    expect(found.map((f) => f.resourceId)).toEqual(["q42"]);
  });

  it("never returns completed [x] items (no re-probe of validated items)", () => {
    const unchecked = parseUncheckedFromStudyContext(twCtx);
    expect(unchecked.map((u) => u.resourceId)).not.toContain("bible/kt/god");
    expect(unchecked.map((u) => u.resourceId)).not.toContain("done1");
    // Even a probe explicitly naming a completed term resolves nothing for it.
    const markers = resolveValidatedCheckMarkers({
      userMessage: "I translated God as 'Dios'.",
      priorAssistantContent: "How did you translate God?",
      studyContext: twCtx,
      isSessionStart: false,
    });
    expect(markers.map((m) => m.resourceId)).not.toContain("bible/kt/god");
  });

  it("prompt instructions forbid re-asking completed items", () => {
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/NEVER re-ask/i);
    expect(CHECKLIST_MARKER_INSTRUCTIONS).toMatch(/\[x\]/);
  });
});
