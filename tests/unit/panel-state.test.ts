/**
 * PanelState — serialization, parsing, study-context merge.
 */
import { describe, it, expect } from "vitest";
import {
  buildPanelState,
  formatPanelStateForPrompt,
  mergePanelStateIntoStudyContext,
  parsePanelState,
  PANEL_STATE_PROMPT_GUIDANCE,
} from "../../src/core/harness/panelState.js";

describe("buildPanelState / formatPanelStateForPrompt", () => {
  it("formats a compact PANEL STATE block without draft bodies", () => {
    const state = buildPanelState({
      open: true,
      tab: "context",
      reference: "TIT 1",
      scriptureLoaded: true,
      contextNotes: [
        { id: "front-intro", title: "Titus overview" },
        { id: "c1-intro", title: "Chapter 1" },
      ],
      translationNotes: [{ id: "tn-1", title: "servant" }],
      keyTerms: [{ id: "tw-1", term: "grace" }],
      questionsCount: 3,
      quiz: { status: "active", answered: 2, total: 7 },
      checklist: {
        completed: 2,
        total: 10,
        pendingTitles: ["Note about elders", "Key term: grace"],
      },
      focusHint: { kind: "note", id: "front-intro", title: "Titus overview" },
    });

    const text = formatPanelStateForPrompt(state);
    expect(text).toContain("PANEL STATE:");
    expect(text).toContain("open: true");
    expect(text).toContain("tab: context");
    expect(text).toContain("reference: TIT 1");
    expect(text).toContain("contextNotes: 2");
    expect(text).toContain("front-intro");
    expect(text).toContain("quiz: active 2/7 answered");
    expect(text).toContain("checklist: 2/10 complete");
    expect(text).toContain("pending: Note about elders");
    expect(text).toContain('focusHint: note:front-intro "Titus overview"');
    expect(text).toMatch(/Mi traducción|private/i);
    expect(text).not.toMatch(/draft text|receptor wording/i);
  });

  it("formats graded quiz and inactive quiz", () => {
    const graded = formatPanelStateForPrompt(
      buildPanelState({
        open: false,
        tab: null,
        quiz: { status: "graded", correct: 5, total: 7, passed: true },
      }),
    );
    expect(graded).toContain("quiz: graded 5/7 passed");

    const inactive = formatPanelStateForPrompt(
      buildPanelState({ open: true, tab: "notes", quiz: null }),
    );
    expect(inactive).toContain("quiz: inactive");
  });
});

describe("parsePanelState", () => {
  it("coerces unknown client payloads and rejects garbage", () => {
    expect(parsePanelState(null)).toBeNull();
    expect(parsePanelState("nope")).toBeNull();

    const parsed = parsePanelState({
      open: true,
      tab: "quiz",
      reference: "TIT",
      quiz: { status: "active", answered: 1, total: 5 },
      focusHint: { kind: "tw", id: "bible/kt/grace", title: "grace" },
      // Must never leak into state even if a buggy client sends it:
      draftText: "secret receptor draft",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.open).toBe(true);
    expect(parsed!.tab).toBe("quiz");
    expect(parsed!.quiz?.status).toBe("active");
    expect(parsed!.focusHint?.kind).toBe("tw");
    expect(JSON.stringify(parsed)).not.toContain("secret receptor");
  });

  it("drops invalid tab / focus kinds", () => {
    const parsed = parsePanelState({
      open: false,
      tab: "not-a-tab",
      focusHint: { kind: "bogus", id: "x" },
    });
    expect(parsed!.tab).toBeNull();
    expect(parsed!.focusHint).toBeUndefined();
  });
});

describe("mergePanelStateIntoStudyContext", () => {
  it("appends PANEL STATE and replaces prior panel lines", () => {
    const prior =
      "Loaded passage: TIT 1\n\nPANEL STATE:\nopen: false\ntab: none\n\nResources panel showing: context notes=1";
    const block = formatPanelStateForPrompt(
      buildPanelState({ open: true, tab: "context", reference: "TIT 1" }),
    );
    const merged = mergePanelStateIntoStudyContext(prior, block)!;
    expect(merged).toContain("Loaded passage: TIT 1");
    expect(merged).toContain("open: true");
    expect(merged).toContain("tab: context");
    expect(merged.match(/PANEL STATE:/g)?.length).toBe(1);
    expect(merged).not.toContain("Resources panel showing");
  });
});

describe("PANEL_STATE_PROMPT_GUIDANCE", () => {
  it("teaches the model to read PANEL STATE and use PANEL markers", () => {
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(/PANEL STATE/);
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(/<!-- PANEL:focus_tab:/);
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(/Mi traducción/);
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(/Do NOT invent/i);
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(/focusHint/i);
    expect(PANEL_STATE_PROMPT_GUIDANCE).toMatch(
      /ground coaching in that item's loaded body/i,
    );
  });
});
