/**
 * Book/chapter-context → resources panel emission + panel-first coach guidance.
 */

import { describe, it, expect } from "vitest";
import {
  bookOrientationCoachGuidance,
  buildBookContextPanelComponent,
  chapterOrientationCoachGuidance,
  chapterOrientationCoachIntent,
  EMERGENCY_FALLBACK_CHAPTER_ORIENTATION,
  extractContextNoteText,
  isWholeChapterReference,
  panelFocusActionsForContext,
  preferredContextNoteId,
} from "../../src/core/harness/bookContextPanel.js";
import {
  coalescePanelActions,
  panelActionsForUiComponent,
} from "../../src/core/harness/panelActions.js";
import { retainContextForPanel } from "../../src/core/harness/uiComponents.js";
import { formulateChapterOrientationReply } from "../../src/core/harness/coachReplyFormulator.js";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";

describe("buildBookContextPanelComponent", () => {
  it("emits passage_context for bare-book TIT intro notes", () => {
    const component = buildBookContextPanelComponent("TIT", [
      {
        id: "front-intro",
        scope: "book",
        chapter: "front",
        note: "# Introducción a Tito\n\nPablo escribió el libro de Tito.",
      },
    ]);
    expect(component).not.toBeNull();
    expect(component!.type).toBe("passage_context");
    expect(component!.reference).toBe("TIT");
    expect(component!.scope).toBe("book");
    expect(component!.notes).toHaveLength(1);
    expect(component!.notes[0].scope).toBe("book");
    expect(component!.notes[0].noteText).toContain("Pablo escribió");
  });

  it("emits passage_context scope chapter for whole-chapter TIT 1", () => {
    const component = buildBookContextPanelComponent("TIT 1", [
      {
        id: "front-intro",
        scope: "book",
        chapter: "front",
        note: "Book intro for Titus.",
      },
      {
        id: "ch1-intro",
        scope: "chapter",
        chapter: "1",
        note: "Chapter intro Tito 1: Notas Generales about vv.1-4.",
      },
    ]);
    expect(component).not.toBeNull();
    expect(component!.type).toBe("passage_context");
    expect(component!.reference).toBe("TIT 1");
    expect(component!.scope).toBe("chapter");
    expect(component!.notes.map((n) => n.scope)).toEqual(["book", "chapter"]);
    expect(component!.notes[1].noteText).toContain("Notas Generales");
  });

  it("returns null when notes are empty / blank", () => {
    expect(buildBookContextPanelComponent("TIT", [])).toBeNull();
    expect(
      buildBookContextPanelComponent("TIT", [{ scope: "book", note: "   " }]),
    ).toBeNull();
  });

  it("treats chapter:front as book scope even without scope field", () => {
    const component = buildBookContextPanelComponent("TIT", [
      { id: "1", chapter: "front", verse: "intro", note: "Book intro body" },
    ]);
    expect(component!.notes[0].scope).toBe("book");
  });
});

describe("isWholeChapterReference", () => {
  it("detects whole-chapter refs and rejects book/verse ranges", () => {
    expect(isWholeChapterReference("TIT 1")).toBe(true);
    expect(isWholeChapterReference("JHN 3")).toBe(true);
    expect(isWholeChapterReference("TIT")).toBe(false);
    expect(isWholeChapterReference("TIT 1:1")).toBe(false);
    expect(isWholeChapterReference("TIT 1:1-4")).toBe(false);
  });
});

describe("panelFocusActionsForContext", () => {
  it("emits panel.open + panel.focus_tab context (+ optional scroll)", () => {
    expect(panelFocusActionsForContext()).toEqual([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "context" },
    ]);
    expect(
      panelFocusActionsForContext({ scrollToNoteId: "ch1-intro" }),
    ).toEqual([
      { type: "panel.open" },
      { type: "panel.focus_tab", tab: "context" },
      { type: "panel.scroll_to", kind: "note", id: "ch1-intro" },
    ]);
  });

  it("keeps Context focus when scripture_text then passage_context companions coalesce", () => {
    const scripture = {
      type: "scripture_text" as const,
      reference: "TIT 1",
      versions: [{ label: "ULT", text: "Paul…", direction: "ltr" as const }],
    };
    const ctx = buildBookContextPanelComponent("TIT 1", [
      { id: "ch1-intro", scope: "chapter", note: "Chapter intro body." },
    ])!;
    const actions = coalescePanelActions([
      ...panelActionsForUiComponent(scripture),
      ...panelActionsForUiComponent(ctx),
      ...panelFocusActionsForContext({
        scrollToNoteId: preferredContextNoteId(ctx.notes),
      }),
    ]);
    expect(actions).toContainEqual({ type: "panel.open" });
    expect(actions).toContainEqual({
      type: "panel.focus_tab",
      tab: "context",
    });
    expect(actions).toContainEqual({
      type: "panel.scroll_to",
      kind: "note",
      id: "ch1-intro",
    });
    const focusTabs = actions.filter((a) => a.type === "panel.focus_tab");
    expect(focusTabs).toHaveLength(1);
    expect(focusTabs[0]).toEqual({ type: "panel.focus_tab", tab: "context" });
  });
});

describe("preferredContextNoteId", () => {
  it("prefers chapter-scope note ids", () => {
    expect(
      preferredContextNoteId([
        { id: "front", scope: "book" },
        { id: "ch1", scope: "chapter" },
      ]),
    ).toBe("ch1");
  });
});

describe("bookOrientationCoachGuidance", () => {
  it("forbids dumping intro into chat when panel notes are loaded", () => {
    const guidance = bookOrientationCoachGuidance({
      hasPanelNotes: true,
      studyLanguage: "es",
      sourceLanguage: "es",
    });
    expect(guidance).toMatch(/panel/i);
    expect(guidance).toMatch(/Do NOT paste|do not paste/i);
    expect(guidance).not.toMatch(/Pablo escribió/);
  });

  it("stays honest when notes fetch failed", () => {
    const guidance = bookOrientationCoachGuidance({
      hasPanelNotes: false,
      notesError: "Timed out",
      studyLanguage: "es",
    });
    expect(guidance).toMatch(/unreachable|Timed out/i);
    expect(guidance).toMatch(/do NOT invent/i);
  });
});

describe("chapterOrientationCoachGuidance / intent", () => {
  it("forbids dumping chapter intro and points to Context + Scripture", () => {
    const guidance = chapterOrientationCoachGuidance({
      hasPanelNotes: true,
      hasScripture: true,
      studyLanguage: "es",
      sourceLanguage: "es",
    });
    expect(guidance).toMatch(/Context tab/i);
    expect(guidance).toMatch(/Scripture/i);
    expect(guidance).toMatch(/Do NOT paste|do not paste/i);
    expect(guidance).not.toMatch(/Notas Generales/);
  });

  it("goal-only intent forbids dump and avoids canned Spanish production copy", () => {
    const intent = chapterOrientationCoachIntent({
      reference: "TIT 1",
      hasPanelNotes: true,
      hasScripture: true,
    });
    expect(intent).toMatch(/TIT 1/);
    expect(intent).toMatch(/Do NOT paste|do not paste/i);
    expect(intent).toMatch(/Context tab/i);
    expect(intent).toMatch(/Scripture/i);
    expect(intent).not.toMatch(/Antes de continuar/i);
    expect(intent).not.toMatch(/Lee la introducción/i);
  });
});

describe("formulateChapterOrientationReply", () => {
  it("returns LLM wording and falls back on failure", async () => {
    const ok: LLMProvider = {
      modelId: () => "mock",
      generate: async () =>
        "Lee el intro en el panel. ¿Qué te llama la atención?",
    };
    const text = await formulateChapterOrientationReply("es", ok, {
      reference: "TIT 1",
      hasPanelNotes: true,
      hasScripture: true,
    });
    expect(text).toContain("panel");
    expect(text).not.toBe(EMERGENCY_FALLBACK_CHAPTER_ORIENTATION);

    const fail: LLMProvider = {
      modelId: () => "mock",
      generate: async () => {
        throw new Error("boom");
      },
    };
    const fallback = await formulateChapterOrientationReply("es", fail, {
      reference: "TIT 1",
      hasPanelNotes: true,
      hasScripture: true,
    });
    expect(fallback).toBe(EMERGENCY_FALLBACK_CHAPTER_ORIENTATION);
  });
});

describe("extractContextNoteText", () => {
  it("normalizes literal \\n and <br>", () => {
    expect(extractContextNoteText({ note: "a\\nb<br>c" })).toBe("a\nb\nc");
  });
});

describe("panel retention for book-only context", () => {
  it("keeps TIT book context when a later same-book turn has no new components", () => {
    const bookCtx = buildBookContextPanelComponent("TIT", [
      { id: "front", scope: "book", note: "Titus book intro for the panel." },
    ])!;
    const panel = retainContextForPanel([[bookCtx], []], []);
    const ctx = panel.find((c) => c.type === "passage_context");
    expect(ctx).toBeDefined();
    expect(ctx!.notes[0].noteText).toContain("Titus book intro");
  });
});
