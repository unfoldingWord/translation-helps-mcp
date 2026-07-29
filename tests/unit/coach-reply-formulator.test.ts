/**
 * Unit tests for LLM-formulated coach replies:
 *   - success path returns model text (not exact canned wording)
 *   - failure / empty → named emergency fallbacks
 *   - intent prompts describe goals only (no polished coach sentences)
 *   - markers are never invented by the formulator
 */

import { describe, it, expect, vi } from "vitest";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";
import {
  EMERGENCY_FALLBACK_QUIZ_PANEL_REFERRAL,
  EMERGENCY_FALLBACK_READINESS_GATE,
  formulateChapterOrientationReply,
  formulateCoachReply,
  formulateQuizPanelReferral,
  formulateReadinessGateQuestion,
  formulateStaleQuizNotice,
  readinessGateQuestionIntent,
  quizPanelReferralIntent,
  quizCompleteMessageIntent,
  quizSkippedMessageIntent,
  quizOfferFooterIntent,
  quizProgressFooterIntent,
  staleQuizNoticeIntent,
} from "../../src/core/harness/coachReplyFormulator.js";
import {
  EMERGENCY_FALLBACK_CHAPTER_ORIENTATION,
  chapterOrientationCoachIntent,
} from "../../src/core/harness/bookContextPanel.js";
import {
  buildQuizClearedMarker,
  buildQuizPanelMarker,
  gradeAnswer,
  type QuizItem,
} from "../../src/core/harness/QuizAgents.js";

function mockLlm(
  result: string | (() => Promise<string>) | Error,
): LLMProvider {
  return {
    modelId: () => "mock",
    generate: async () => {
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result() : result;
    },
  };
}

/** Phrases that used to be pasted into intents / polished fallbacks — must not leak. */
const CANNED_LEAKS = [
  /Antes de continuar/i,
  /te gustaría hacer un (cuestionario|breve)/i,
  /Before continuing, would you like/i,
  /to make sure you understand the context/i,
  /to confirm they understand the context/i,
  /would they like a short context quiz/i,
];

describe("formulateCoachReply", () => {
  it("returns LLM text and strips any HTML comment markers the model sneaks in", async () => {
    const text = await formulateCoachReply(
      mockLlm("Warm offer. <!-- QUIZ:cleared -->"),
      {
        language: "en",
        intent: "Say hello briefly.",
        fallback: "FALLBACK",
      },
    );
    expect(text).toBe("Warm offer.");
    expect(text).not.toMatch(/<!--/);
  });

  it("uses fallback when LLM throws", async () => {
    const text = await formulateCoachReply(mockLlm(new Error("boom")), {
      language: "es",
      intent: "Ask about a quiz.",
      fallback: "FALLBACK_ES",
    });
    expect(text).toBe("FALLBACK_ES");
  });

  it("uses fallback when LLM returns empty", async () => {
    const text = await formulateCoachReply(
      mockLlm("   <!-- READY:book:TIT -->  "),
      {
        language: "en",
        intent: "Ask about a quiz.",
        fallback: "FALLBACK_EMPTY",
      },
    );
    expect(text).toBe("FALLBACK_EMPTY");
  });
});

describe("typed formulators", () => {
  it("formulateReadinessGateQuestion prefers LLM wording over fallback", async () => {
    const llmWording =
      "Shall we pause for a tiny context check on this book before we go on?";
    const text = await formulateReadinessGateQuestion(
      "book",
      "en",
      mockLlm(llmWording),
    );
    expect(text).toBe(llmWording);
    expect(text).not.toBe(EMERGENCY_FALLBACK_READINESS_GATE("book"));
  });

  it("formulateReadinessGateQuestion falls back on failure", async () => {
    const text = await formulateReadinessGateQuestion(
      "chapter",
      "es",
      mockLlm(new Error("fail")),
    );
    expect(text).toBe(EMERGENCY_FALLBACK_READINESS_GATE("chapter"));
    expect(text).toMatch(/^\[offline\]/);
    for (const leak of CANNED_LEAKS) {
      expect(text).not.toMatch(leak);
    }
  });

  it("formulateQuizPanelReferral falls back on failure", async () => {
    const text = await formulateQuizPanelReferral(
      "en",
      mockLlm(new Error("fail")),
    );
    expect(text).toBe(EMERGENCY_FALLBACK_QUIZ_PANEL_REFERRAL);
    expect(text).toMatch(/^\[offline\]/);
  });

  it("formulateStaleQuizNotice returns LLM text without markers", async () => {
    const text = await formulateStaleQuizNotice(
      "en",
      mockLlm("That quiz wrapped up already — want a fresh one?"),
    );
    expect(text).toMatch(/fresh one/i);
    expect(text).not.toMatch(/<!--/);
  });
});

describe("intent prompts (goal-only, no canned coach sentences)", () => {
  it("readiness intents distinguish book vs chapter without canned wording", () => {
    const book = readinessGateQuestionIntent("book");
    const chapter = readinessGateQuestionIntent("chapter");
    expect(book).toMatch(/book-level/i);
    expect(chapter).toMatch(/chapter-level/i);
    expect(book).toMatch(/optional/i);
    expect(book).toMatch(/Invent fresh wording/i);
    for (const leak of CANNED_LEAKS) {
      expect(book).not.toMatch(leak);
      expect(chapter).not.toMatch(leak);
    }
  });

  it("other formulate* intents stay goal-shaped and Spanish-free", () => {
    const intents = [
      quizPanelReferralIntent(),
      quizOfferFooterIntent(4),
      quizProgressFooterIntent(),
      quizCompleteMessageIntent(),
      quizSkippedMessageIntent(),
      staleQuizNoticeIntent(),
      chapterOrientationCoachIntent({
        reference: "TIT 1",
        hasPanelNotes: true,
        hasScripture: true,
      }),
    ];
    for (const intent of intents) {
      expect(intent).toMatch(/^Goal:/m);
      expect(intent).toMatch(/Invent fresh wording/i);
      expect(intent).not.toMatch(
        /Antes de|te gustaría|cuestionario rápido|De acuerdo, omitimos/i,
      );
      for (const leak of CANNED_LEAKS) {
        expect(intent).not.toMatch(leak);
      }
    }
    expect(quizPanelReferralIntent()).toMatch(/resources panel/i);
    expect(
      chapterOrientationCoachIntent({
        reference: "TIT 1",
        hasPanelNotes: true,
        hasScripture: true,
      }),
    ).toMatch(/Do NOT paste/i);
  });

  it("formulateChapterOrientationReply prefers LLM wording over offline fallback", async () => {
    const wording =
      "The chapter intro is in the Context tab — read that and the scripture next. What stands out?";
    const text = await formulateChapterOrientationReply(
      "en",
      mockLlm(wording),
      { reference: "TIT 1", hasPanelNotes: true, hasScripture: true },
    );
    expect(text).toBe(wording);
    expect(text).not.toBe(EMERGENCY_FALLBACK_CHAPTER_ORIENTATION);
  });
});

describe("gradeAnswer final wrap-up fold", () => {
  it("folds wrap-up into feedback on the final question (one call)", async () => {
    const generate = vi.fn(async () =>
      JSON.stringify({
        verdict: "correct",
        feedback:
          "Yes — Paul wrote to Titus. You've got the context. What's hardest to translate?",
      }),
    );
    const llm: LLMProvider = { modelId: () => "mock", generate };
    const result = await gradeAnswer(
      "Who wrote Titus?",
      "Paul",
      "Paul",
      "en",
      llm,
      { isFinal: true },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.verdict).toBe("correct");
    expect(result.feedback).toMatch(/\?$/);
    expect(result.feedback).toMatch(/hardest|draft|translation|panel/i);
  });

  it("appends sync complete fallback when final grade omits a question", async () => {
    const llm: LLMProvider = {
      modelId: () => "mock",
      generate: async () =>
        JSON.stringify({
          verdict: "partial",
          feedback: "Close — the expected answer is Paul.",
        }),
    };
    const result = await gradeAnswer(
      "Who wrote Titus?",
      "Paul",
      "Someone",
      "en",
      llm,
      { isFinal: true },
    );
    expect(result.feedback).toMatch(/Paul/);
    expect(result.feedback).toMatch(/\?$/);
    expect(result.feedback).toMatch(/panel|draft|My translation|hardest/i);
  });
});

describe("marker append stays programmatic", () => {
  it("panel marker + cleared marker are code-built, not LLM text", () => {
    const questions: QuizItem[] = [
      { q: "Q1", a: "A1", options: ["A1", "B", "C"] },
      { q: "Q2", a: "A2", options: ["A2", "B", "C"] },
      { q: "Q3", a: "A3", options: ["A3", "B", "C"] },
    ];
    const visible = "Panel quiz is ready.";
    const response = `${visible}\n${buildQuizPanelMarker(questions)}${buildQuizClearedMarker()}`;
    expect(response).toContain("<!-- QUIZ:panel/3");
    expect(response).toContain("<!-- QUIZ:cleared -->");
    expect(visible).not.toMatch(/<!--/);
  });
});
