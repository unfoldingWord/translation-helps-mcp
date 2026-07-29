/**
 * PanelAction — companion emission, marker parse, coalesce.
 */
import { describe, it, expect } from "vitest";
import {
  coalescePanelActions,
  extractPanelActionsFromText,
  formatPanelActionMarker,
  panelActionsForUiComponent,
  parsePanelAction,
  tabForUiComponent,
} from "../../src/core/harness/panelActions.js";
import type { UIComponent } from "../../src/core/harness/uiComponents.js";

const passageContext: UIComponent = {
  type: "passage_context",
  reference: "TIT",
  scope: "book",
  notes: [{ id: "front", scope: "book", noteText: "Overview" }],
};

const activeQuiz: UIComponent = {
  type: "context_quiz",
  reference: "TIT",
  status: "active",
  questions: [
    { id: "q1", q: "Q1?", options: ["a", "b", "c"] },
    { id: "q2", q: "Q2?", options: ["a", "b", "c"] },
    { id: "q3", q: "Q3?", options: ["a", "b", "c"] },
  ],
};

const gradedQuiz: UIComponent = {
  ...activeQuiz,
  status: "completed",
  correctCount: 2,
  passed: true,
};

describe("panelActionsForUiComponent", () => {
  it("opens panel and focuses context for passage_context", () => {
    expect(tabForUiComponent(passageContext)).toBe("context");
    expect(panelActionsForUiComponent(passageContext)).toEqual([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "context" },
    ]);
  });

  it("opens panel and focuses quiz only when active", () => {
    expect(panelActionsForUiComponent(activeQuiz)).toEqual([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "quiz" },
    ]);
    expect(panelActionsForUiComponent(gradedQuiz)).toEqual([
      { type: "panel.open" },
    ]);
  });

  it("opens panel for scripture without stealing tab focus", () => {
    const scripture: UIComponent = {
      type: "scripture_text",
      reference: "TIT 1",
      versions: [{ label: "ULT", text: "Paul…" }],
    };
    expect(panelActionsForUiComponent(scripture)).toEqual([
      { type: "panel.open" },
    ]);
  });

  it("focuses notes / words / article", () => {
    expect(
      panelActionsForUiComponent({
        type: "translation_notes",
        reference: "TIT 1",
        notes: [{ id: "n1", noteText: "note" }],
      }),
    ).toContainEqual({ type: "panel.focus_tab", tab: "notes" });
    expect(
      panelActionsForUiComponent({
        type: "translation_words",
        reference: "TIT 1",
        words: [{ id: "w1", term: "grace" }],
      }),
    ).toContainEqual({ type: "panel.focus_tab", tab: "words" });
    expect(
      panelActionsForUiComponent({
        type: "academy_article",
        path: "translate/figs-metaphor",
        markdown: "# Metaphor",
      }),
    ).toContainEqual({ type: "panel.focus_tab", tab: "article" });
  });
});

describe("parsePanelAction / markers", () => {
  it("parses SSE JSON payloads", () => {
    expect(parsePanelAction({ type: "panel.open" })).toEqual({
      type: "panel.open",
    });
    expect(
      parsePanelAction({ type: "panel.focus_tab", tab: "checklist" }),
    ).toEqual({ type: "panel.focus_tab", tab: "checklist" });
    expect(
      parsePanelAction({
        type: "panel.highlight",
        kind: "note",
        id: "front-intro",
      }),
    ).toEqual({
      type: "panel.highlight",
      kind: "note",
      id: "front-intro",
    });
    expect(
      parsePanelAction({ type: "panel.focus_tab", tab: "nope" }),
    ).toBeNull();
  });

  it("round-trips markers and extracts them from reply text", () => {
    const actions = [
      { type: "panel.open" as const },
      { type: "panel.focus_tab" as const, tab: "notes" as const },
      {
        type: "panel.highlight" as const,
        kind: "note" as const,
        id: "tn-1",
        phrase: "servant",
      },
      {
        type: "panel.scroll_to" as const,
        kind: "tw" as const,
        id: "bible/kt/grace",
      },
    ];
    const markers = actions.map(formatPanelActionMarker).join("\n");
    const reply = `Look at the note in the panel.\n${markers}`;
    const { actions: parsed, cleaned } = extractPanelActionsFromText(reply);
    expect(parsed).toEqual(actions);
    expect(cleaned).toContain("Look at the note in the panel.");
    expect(cleaned).not.toContain("<!-- PANEL:");
  });

  it("coalesces duplicate open/focus_tab keeping last focus", () => {
    const coalesced = coalescePanelActions([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "context" },
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "quiz" },
      { type: "panel.highlight", kind: "note", id: "x" },
    ]);
    expect(coalesced).toEqual([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "quiz" },
      { type: "panel.highlight", kind: "note", id: "x" },
    ]);
  });
});

describe("done-path marker extraction (skillChat wrapEmitForPanelMarkers)", () => {
  it("strips PANEL trailers while preserving CHECK/QUIZ markers", () => {
    const reply =
      `Read the context tab.\n` +
      `<!-- PANEL:focus_tab:context -->\n` +
      `<!-- PANEL:highlight:note:front -->\n` +
      `<!-- CHECK:note:front -->\n` +
      `<!-- QUIZ:cleared -->`;
    const { actions, cleaned } = extractPanelActionsFromText(reply);
    expect(actions).toEqual([
      { type: "panel.focus_tab", tab: "context" },
      { type: "panel.highlight", kind: "note", id: "front" },
    ]);
    expect(cleaned).toContain("<!-- CHECK:note:front -->");
    expect(cleaned).toContain("<!-- QUIZ:cleared -->");
    expect(cleaned).not.toContain("<!-- PANEL:");
  });
});
