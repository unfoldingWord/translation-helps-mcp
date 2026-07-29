/**
 * Unit tests for on-demand / practice quizzes:
 *   - intent detection (hazme un quiz, quiero practicar, offer accept)
 *   - content source selection (context intro vs passage TN)
 *   - panel marker kind (context vs passage / practice)
 *   - no READY on practice quiz pass
 *   - readiness path still emits READY for context kind
 */

import { describe, it, expect } from "vitest";
import {
  buildQuizMarker,
  buildQuizPanelMarker,
  buildQuizClearedMarker,
} from "../../src/core/harness/QuizAgents.js";
import {
  buildQuizOfferMarker,
  detectOnDemandQuizIntent,
  extractPendingQuizOffer,
  isOnDemandQuizRequest,
  quizKindMarksReadiness,
  readinessScopeForQuizKind,
  selectQuizContentSource,
} from "../../src/core/harness/onDemandQuiz.js";
import {
  buildQuizRetryMarker,
  buildQuizScopeMarker,
  buildReadyMarker,
  deriveReadiness,
  extractPendingQuizRetry,
  extractQuizScopeFromHistory,
  isBookSettled,
  isQuizPass,
} from "../../src/core/harness/contextReadiness.js";
import {
  extractQuizFromHistory,
  type ConversationMessage,
  type QuizItem,
} from "../../src/core/harness/intent.js";
import {
  buildQuizPanelComponent,
  gradeQuizSubmission,
} from "../../src/core/harness/quizPanel.js";

const QUESTIONS: QuizItem[] = [
  {
    q: "Q1?",
    a: "A1",
    options: ["A1", "B1", "C1"],
  },
  {
    q: "Q2?",
    a: "A2",
    options: ["A2", "B2", "C2"],
  },
  {
    q: "Q3?",
    a: "A3",
    options: ["A3", "B3", "C3"],
  },
];

const assistant = (content: string): ConversationMessage => ({
  role: "assistant",
  content,
});
const user = (content: string): ConversationMessage => ({
  role: "user",
  content,
});

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

describe("isOnDemandQuizRequest", () => {
  it("detects Spanish and English quiz / practice phrasing", () => {
    expect(isOnDemandQuizRequest("hazme un quiz")).toBe(true);
    expect(isOnDemandQuizRequest("quiero practicar")).toBe(true);
    expect(isOnDemandQuizRequest("dame un cuestionario de contexto")).toBe(
      true,
    );
    expect(isOnDemandQuizRequest("let's do a quiz")).toBe(true);
    expect(isOnDemandQuizRequest("quiz me on this passage")).toBe(true);
    expect(isOnDemandQuizRequest("want to practice")).toBe(true);
  });

  it("does not treat opt-out or unrelated asks as requests", () => {
    expect(isOnDemandQuizRequest("omitir el cuestionario")).toBe(false);
    expect(isOnDemandQuizRequest("qué significa siervo?")).toBe(false);
    expect(isOnDemandQuizRequest("traduzcamos Tito 1")).toBe(false);
  });
});

describe("detectOnDemandQuizIntent", () => {
  it("builds a passage request from a verse-scoped study ref", () => {
    const r = detectOnDemandQuizIntent({
      message: "hazme un quiz",
      studyRef: "JON 1:1-4",
      reference: "JON 1:1-4",
    });
    expect(r).toEqual({
      requested: true,
      source: "passage",
      kind: "passage",
      quizRef: "JON 1:1-4",
    });
  });

  it("builds a context request for book / chapter or explicit contexto", () => {
    expect(
      detectOnDemandQuizIntent({
        message: "quiero un cuestionario de contexto",
        studyRef: "JON 1:1-4",
        reference: "JON",
      }),
    ).toMatchObject({
      source: "context",
      kind: "context",
      quizRef: "JON",
    });

    expect(
      detectOnDemandQuizIntent({
        message: "hazme un quiz",
        reference: "TIT 1",
      }),
    ).toMatchObject({
      source: "context",
      kind: "context",
      quizRef: "TIT 1",
    });
  });

  it("accepts an affirmative after a QUIZOFFER", () => {
    const history = [
      assistant(
        `¿Quieres practicar?\n${buildQuizOfferMarker("passage", "JON 1:1-3")}`,
      ),
    ];
    const r = detectOnDemandQuizIntent({
      message: "sí",
      history,
      isAffirmative: true,
    });
    expect(r).toEqual({
      requested: true,
      source: "passage",
      kind: "passage",
      quizRef: "JON 1:1-3",
      fromOfferAccept: true,
    });
  });

  it("does not steal an active quiz session", () => {
    const history = [
      assistant(`Panel\n${buildQuizPanelMarker(QUESTIONS, "passage")}`),
    ];
    expect(
      detectOnDemandQuizIntent({
        message: "hazme un quiz",
        reference: "JON 1:1",
        history,
        hasActiveQuiz: true,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------

describe("selectQuizContentSource", () => {
  it("picks passage notes for verse ranges", () => {
    expect(
      selectQuizContentSource({
        message: "hazme un quiz",
        reference: "JON 1:1-4",
      }),
    ).toEqual({
      source: "passage",
      kind: "passage",
      quizRef: "JON 1:1-4",
    });
  });

  it("picks context notes for book/chapter", () => {
    expect(
      selectQuizContentSource({
        message: "quiero practicar",
        reference: "JON",
      }),
    ).toEqual({ source: "context", kind: "context", quizRef: "JON" });
  });

  it("downgrades to practice when readiness is already settled", () => {
    expect(
      selectQuizContentSource({
        message: "hazme un quiz de contexto",
        reference: "JON",
        readinessSettled: true,
      }),
    ).toEqual({ source: "context", kind: "practice", quizRef: "JON" });
  });
});

// ---------------------------------------------------------------------------
// Marker kind
// ---------------------------------------------------------------------------

describe("quiz panel marker kind", () => {
  it("omits :kind for legacy context markers", () => {
    const m = buildQuizPanelMarker(QUESTIONS);
    expect(m).toMatch(/^<!-- QUIZ:panel\/3 /);
    expect(m).not.toContain(":context");
    expect(extractQuizFromHistory([assistant(m)])).toMatchObject({
      mode: "panel",
      kind: "context",
      total: 3,
    });
  });

  it("embeds :passage / :practice in the marker", () => {
    const passage = buildQuizPanelMarker(QUESTIONS, "passage");
    expect(passage).toContain("QUIZ:panel/3:passage ");
    expect(extractQuizFromHistory([assistant(passage)])?.kind).toBe("passage");

    const practice = buildQuizMarker(0, QUESTIONS, "practice");
    expect(practice).toContain("QUIZ:0/3:practice ");
    expect(extractQuizFromHistory([assistant(practice)])?.kind).toBe(
      "practice",
    );
  });

  it("quizKindMarksReadiness is only true for context", () => {
    expect(quizKindMarksReadiness("context")).toBe(true);
    expect(quizKindMarksReadiness("passage")).toBe(false);
    expect(quizKindMarksReadiness("practice")).toBe(false);
  });

  it("readinessScopeForQuizKind returns null for practice/passage", () => {
    expect(readinessScopeForQuizKind("passage", "JON 1:1-4")).toBeNull();
    expect(readinessScopeForQuizKind("practice", "JON")).toBeNull();
    expect(readinessScopeForQuizKind("context", "JON")).toEqual({
      level: "book",
      book: "JON",
    });
  });
});

// ---------------------------------------------------------------------------
// READY interaction
// ---------------------------------------------------------------------------

describe("practice quiz must not emit READY", () => {
  it("passing a passage panel quiz leaves readiness unset", () => {
    const history: ConversationMessage[] = [
      assistant(`Panel\n${buildQuizPanelMarker(QUESTIONS, "passage")}`),
    ];
    const session = extractQuizFromHistory(history)!;
    expect(session.kind).toBe("passage");
    expect(extractQuizScopeFromHistory(history)).toBeNull();

    const grade = gradeQuizSubmission(QUESTIONS, ["A1", "A2", "A3"]);
    expect(grade.passed).toBe(true);
    expect(isQuizPass(grade.correctCount, grade.total)).toBe(true);

    // Path QP practice sequence: feedback + cleared + optional retry, NO READY.
    const reply =
      `¡Bien!\n` +
      buildQuizClearedMarker() +
      (!grade.passed ? "" : "") + // pass → no retry
      "";
    expect(reply).not.toContain("READY:");
    // Simulate the guard used in skillChat Path QP.
    const readyMarker =
      quizKindMarksReadiness(session.kind) && grade.passed
        ? buildReadyMarker({ level: "book", book: "JON" })
        : "";
    expect(readyMarker).toBe("");

    const after = [
      ...history,
      assistant(`ok\n${readyMarker}${buildQuizClearedMarker()}`),
    ];
    expect(deriveReadiness(after).readyBooks.has("JON")).toBe(false);
    expect(isBookSettled(deriveReadiness(after), "JON")).toBe(false);
  });

  it("passing a context panel quiz still marks READY when QUIZSCOPE is present", () => {
    const scope = { level: "book" as const, book: "JON" };
    const history: ConversationMessage[] = [
      assistant(
        `Panel\n${buildQuizPanelMarker(QUESTIONS, "context")}${buildQuizScopeMarker(scope)}`,
      ),
    ];
    const session = extractQuizFromHistory(history)!;
    expect(session.kind).toBe("context");
    const grade = gradeQuizSubmission(QUESTIONS, ["A1", "A2", "A3"]);
    const readyMarker =
      quizKindMarksReadiness(session.kind) &&
      extractQuizScopeFromHistory(history) &&
      grade.passed
        ? buildReadyMarker(scope)
        : "";
    expect(readyMarker).toContain("READY:book:JON");
    const after = [
      ...history,
      assistant(`ok\n${readyMarker}${buildQuizClearedMarker()}`),
    ];
    expect(isBookSettled(deriveReadiness(after), "JON")).toBe(true);
  });

  it("failed practice quiz emits practice retry without READY", () => {
    const retry = buildQuizRetryMarker(null, "JON 1:1-4", "passage");
    expect(retry).toContain("QUIZ:retry:passage|JON 1:1-4|passage");
    expect(retry).not.toContain("READY");
    const pending = extractPendingQuizRetry([
      assistant(`Revisa.\n${buildQuizClearedMarker()}${retry}`),
    ]);
    expect(pending).toEqual({
      quizRef: "JON 1:1-4",
      kind: "passage",
    });
  });
});

describe("QUIZOFFER marker", () => {
  it("round-trips last-assistant offer", () => {
    const marker = buildQuizOfferMarker("practice", "TIT 1", "context");
    expect(
      extractPendingQuizOffer([assistant(`¿Practicamos?\n${marker}`)]),
    ).toEqual({
      kind: "practice",
      quizRef: "TIT 1",
      source: "context",
    });
    expect(
      extractPendingQuizOffer([
        assistant(marker),
        user("sí"),
        assistant("moved on"),
      ]),
    ).toBeNull();
  });
});

describe("panel component still builds for practice quizzes", () => {
  it("builds an active panel without readiness scope", () => {
    const panel = buildQuizPanelComponent("JON 1:1-4", QUESTIONS, null);
    expect(panel).not.toBeNull();
    expect(panel!.reference).toBe("JON 1:1-4");
    expect(panel!.scope).toBeUndefined();
    expect(panel!.status).toBe("active");
  });
});
