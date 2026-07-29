/**
 * Unit tests for the interactive panel quiz:
 *   - multiple-choice option generation (generateQuiz + normalizeQuizOptions)
 *   - QUIZSUBMIT marker round-trip (format → parse)
 *   - deterministic grading (majority pass rule, unanswered = wrong)
 *   - panel component builders (active / completed)
 *   - readiness marking from a panel submit (scope + pass → READY marker)
 *   - fresh-flow gate fix: affirmative chapter-offer composition
 */

import { describe, it, expect } from "vitest";
import {
  generateQuiz,
  normalizeQuizOptions,
} from "../../src/core/harness/QuizAgents.js";
import {
  buildQuizPanelComponent,
  buildQuizResultComponent,
  buildQuizSubmitMarker,
  fallbackQuizResultFeedback,
  formatQuizSubmitMessage,
  gradeQuizSubmission,
  isQuizOptionSelected,
  parseQuizSubmitFromMessage,
  resolveQuizOptionTone,
  fallbackQuizPanelHint,
  fallbackQuizPanelReferralMessage,
  fallbackStaleQuizNotice,
} from "../../src/core/harness/quizPanel.js";
import {
  buildQuizRetryMarker,
  buildQuizScopeMarker,
  buildReadyMarker,
  deriveReadiness,
  detectReadinessGate,
  extractPendingQuizRetry,
  extractQuizScopeFromHistory,
  interpretQuizRetryReply,
  isBookSettled,
  isQuizPass,
} from "../../src/core/harness/contextReadiness.js";
import { extractChapterOfferFromAssistant } from "../../src/core/harness/relativeRef.js";
import {
  buildQuizMarker,
  buildQuizPanelMarker,
  buildQuizClearedMarker,
} from "../../src/core/harness/QuizAgents.js";
import {
  classifyIntent,
  extractQuizFromHistory,
  historyHasQuizCleared,
  reinforceQuizSession,
  type ConversationMessage,
  type QuizItem,
} from "../../src/core/harness/intent.js";
import type { EnrichedBundle } from "../../src/core/harness/budgeter.js";
import type { LLMProvider } from "../../src/core/rag/types.js";

const assistant = (content: string): ConversationMessage => ({
  role: "assistant",
  content,
});
const user = (content: string): ConversationMessage => ({
  role: "user",
  content,
});

const QUESTIONS: QuizItem[] = [
  {
    q: "¿Quién escribió la carta a Tito?",
    a: "Pablo",
    options: ["Pablo", "Pedro", "Tito"],
  },
  {
    q: "¿Dónde estaba sirviendo Tito?",
    a: "En la isla de Creta",
    options: ["En Roma", "En la isla de Creta", "En Jerusalén"],
  },
  {
    q: "¿Cuál es el propósito principal de la carta?",
    a: "Nombrar líderes y enseñar la vida recta",
    options: [
      "Nombrar líderes y enseñar la vida recta",
      "Pedir dinero para los pobres",
      "Anunciar un viaje",
    ],
  },
];

// ---------------------------------------------------------------------------
// Option generation
// ---------------------------------------------------------------------------

describe("normalizeQuizOptions", () => {
  it("keeps 3–4 unique options including the expected answer", () => {
    const opts = normalizeQuizOptions("Pablo", ["Pablo", "Pedro", "Tito"]);
    expect(opts).toEqual(["Pablo", "Pedro", "Tito"]);
  });

  it("injects the expected answer when the LLM omitted it", () => {
    const opts = normalizeQuizOptions("Pablo", ["Pedro", "Tito", "Lucas"]);
    expect(opts).toContain("Pablo");
    expect(opts!.length).toBeLessThanOrEqual(4);
  });

  it("dedupes case-insensitively and trims", () => {
    const opts = normalizeQuizOptions("Pablo", [
      " Pablo ",
      "pablo",
      "Pedro",
      "Tito",
    ]);
    expect(opts).toEqual(["Pablo", "Pedro", "Tito"]);
  });

  it("returns undefined when fewer than 3 usable options", () => {
    expect(normalizeQuizOptions("Pablo", ["Pablo", "Pedro"])).toBeUndefined();
    expect(normalizeQuizOptions("Pablo", "not an array")).toBeUndefined();
    expect(normalizeQuizOptions("Pablo", undefined)).toBeUndefined();
  });

  it("caps at 4 but never drops the correct answer", () => {
    const opts = normalizeQuizOptions("E", ["A", "B", "C", "D", "E"]);
    expect(opts!.length).toBe(4);
    expect(opts).toContain("E");
  });
});

describe("generateQuiz with multiple-choice options", () => {
  const bundle = {
    scriptures: [],
    notes: [
      { id: "intro-0", text: "Pablo escribió esta carta a Tito en Creta." },
      { id: "intro-1", text: "El propósito es nombrar líderes fieles." },
    ],
    tw: [],
    ta: [],
    questions: [],
  } as unknown as EnrichedBundle;

  const mockLlm = (payload: unknown): LLMProvider =>
    ({
      generate: async () => JSON.stringify(payload),
    }) as unknown as LLMProvider;

  it("parses options from the LLM payload", async () => {
    const llm = mockLlm({
      questions: QUESTIONS.map((q) => ({ q: q.q, a: q.a, options: q.options })),
    });
    const items = await generateQuiz(bundle, "TIT", "es", llm);
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.options).toBeDefined();
      expect(item.options!.length).toBeGreaterThanOrEqual(3);
      expect(item.options).toContain(item.a);
    }
  });

  it("degrades to open-ended items when options are unusable", async () => {
    const llm = mockLlm({
      questions: [
        { q: "¿Quién escribió?", a: "Pablo", options: ["Pablo"] },
        { q: "¿Dónde?", a: "Creta" },
      ],
    });
    const items = await generateQuiz(bundle, "TIT", "es", llm);
    expect(items.length).toBe(2);
    expect(items[0].options).toBeUndefined();
    expect(items[1].options).toBeUndefined();
  });

  it("round-trips options through the QUIZ history marker", () => {
    const marker = buildQuizMarker(1, QUESTIONS);
    const session = extractQuizFromHistory([assistant(`Q1\n${marker}`)]);
    expect(session).not.toBeNull();
    expect(session!.questions[1].options).toEqual(QUESTIONS[1].options);
  });
});

// ---------------------------------------------------------------------------
// Submit marker round-trip
// ---------------------------------------------------------------------------

describe("QUIZSUBMIT marker", () => {
  it("format → parse round-trip", () => {
    const payload = {
      reference: "TIT 1",
      answers: ["Pablo", "En la isla de Creta", null],
    };
    const msg = formatQuizSubmitMessage({ payload, language: "es" });
    expect(msg).toContain("Mis respuestas del cuestionario (TIT 1):");
    expect(msg).toContain("1. Pablo");
    expect(msg).toContain("3. (sin responder)");
    const parsed = parseQuizSubmitFromMessage(msg);
    expect(parsed).toEqual(payload);
  });

  it("sanitizes comment terminators inside answers", () => {
    const marker = buildQuizSubmitMarker({
      reference: "TIT 1",
      answers: ["weird --> answer"],
    });
    expect(marker).not.toContain("--> answer");
    const parsed = parseQuizSubmitFromMessage(marker);
    expect(parsed!.answers[0]).toContain("→");
  });

  it("returns null for plain chat messages", () => {
    expect(parseQuizSubmitFromMessage("hola, ¿cómo estás?")).toBeNull();
    expect(parseQuizSubmitFromMessage("")).toBeNull();
    expect(parseQuizSubmitFromMessage(null)).toBeNull();
    expect(
      parseQuizSubmitFromMessage("<!-- QUIZSUBMIT:{not json} -->"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

describe("gradeQuizSubmission", () => {
  it("grades exact (case/whitespace-insensitive) matches", () => {
    const grade = gradeQuizSubmission(QUESTIONS, [
      "  pablo ",
      "En la isla de Creta",
      "Pedir dinero para los pobres",
    ]);
    expect(grade.correctCount).toBe(2);
    expect(grade.total).toBe(3);
    expect(grade.passed).toBe(true); // 2/3 majority
    expect(grade.results[2].correct).toBe(false);
    expect(grade.results[2].expected).toBe(
      "Nombrar líderes y enseñar la vida recta",
    );
  });

  it("counts unanswered as wrong; minority correct fails", () => {
    const grade = gradeQuizSubmission(QUESTIONS, ["Pablo", null, null]);
    expect(grade.correctCount).toBe(1);
    expect(grade.passed).toBe(false);
  });

  it("exactly half is not a pass (majority = strictly more than half)", () => {
    const four = [...QUESTIONS, { q: "Q4", a: "X", options: ["X", "Y", "Z"] }];
    const grade = gradeQuizSubmission(four, [
      "Pablo",
      "En la isla de Creta",
      "no",
      "no",
    ]);
    expect(grade.correctCount).toBe(2);
    expect(grade.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Panel component builders
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Option selection / tone (UI class binding must share this condition)
// ---------------------------------------------------------------------------

describe("quiz option selection tone", () => {
  it("marks the activeChoice as selected (same condition for aria + styles)", () => {
    const option = "Rut se casó con Booz";
    expect(
      isQuizOptionSelected({
        status: "active",
        option,
        activeChoice: option,
      }),
    ).toBe(true);
    expect(
      resolveQuizOptionTone({
        status: "active",
        option,
        activeChoice: option,
      }),
    ).toBe("selected");
    expect(
      resolveQuizOptionTone({
        status: "active",
        option: "Otra opción",
        activeChoice: option,
      }),
    ).toBe("default");
  });

  it("treats missing activeChoice as unselected", () => {
    expect(
      isQuizOptionSelected({
        status: "active",
        option: "Pablo",
        activeChoice: undefined,
      }),
    ).toBe(false);
    expect(
      resolveQuizOptionTone({
        status: "active",
        option: "Pablo",
      }),
    ).toBe("default");
  });

  it("completed: expected = correct, wrong chosen = incorrect, rest muted", () => {
    expect(
      resolveQuizOptionTone({
        status: "completed",
        option: "Pablo",
        completedChosen: "Pedro",
        expected: "Pablo",
        correct: false,
      }),
    ).toBe("correct");
    expect(
      resolveQuizOptionTone({
        status: "completed",
        option: "Pedro",
        completedChosen: "Pedro",
        expected: "Pablo",
        correct: false,
      }),
    ).toBe("incorrect");
    expect(
      resolveQuizOptionTone({
        status: "completed",
        option: "Tito",
        completedChosen: "Pedro",
        expected: "Pablo",
        correct: false,
      }),
    ).toBe("muted");
    expect(
      isQuizOptionSelected({
        status: "completed",
        option: "Pedro",
        completedChosen: "Pedro",
      }),
    ).toBe(true);
  });
});

describe("panel component builders", () => {
  it("builds an active component from MC questions", () => {
    const comp = buildQuizPanelComponent("TIT 1", QUESTIONS, {
      level: "book",
      book: "TIT",
    });
    expect(comp).not.toBeNull();
    expect(comp!.status).toBe("active");
    expect(comp!.questions.length).toBe(3);
    expect(comp!.scope).toEqual({ level: "book", book: "TIT" });
    // Answer key must NOT leak into the active panel payload.
    expect(comp!.questions.every((q) => q.expected === undefined)).toBe(true);
  });

  it("returns null when fewer than 3 questions have options (chat-only quiz)", () => {
    const openEnded: QuizItem[] = [
      { q: "A?", a: "a" },
      { q: "B?", a: "b" },
      { q: "C?", a: "c", options: ["c", "d", "e"] },
    ];
    expect(buildQuizPanelComponent("TIT 1", openEnded)).toBeNull();
  });

  it("builds a completed component with per-question results", () => {
    const grade = gradeQuizSubmission(QUESTIONS, [
      "Pablo",
      "En Roma",
      "Nombrar líderes y enseñar la vida recta",
    ]);
    const comp = buildQuizResultComponent("TIT 1", QUESTIONS, grade);
    expect(comp.status).toBe("completed");
    expect(comp.correctCount).toBe(2);
    expect(comp.passed).toBe(true);
    expect(comp.questions[1].correct).toBe(false);
    expect(comp.questions[1].chosen).toBe("En Roma");
    expect(comp.questions[1].expected).toBe("En la isla de Creta");
  });

  it("fallback feedback lists misses with expected answers", () => {
    const grade = gradeQuizSubmission(QUESTIONS, ["Pablo", "En Roma", null]);
    const text = fallbackQuizResultFeedback(grade, "es");
    expect(text).toContain("1 de 3");
    expect(text).toContain("En la isla de Creta");
    expect(text).toMatch(/cuestionario nuevo|listo/i);
    expect(fallbackQuizPanelHint("es")).toContain("panel de recursos");
    expect(fallbackQuizPanelReferralMessage("en")).toMatch(/resources panel/i);
    expect(fallbackStaleQuizNotice("en")).toMatch(/no longer active/i);
  });

  it("fallback fail feedback asks readiness for a new quiz (EN)", () => {
    const grade = gradeQuizSubmission(QUESTIONS, ["wrong", null, null]);
    const text = fallbackQuizResultFeedback(grade, "en");
    expect(grade.passed).toBe(false);
    expect(text).toMatch(/re-?reading|resources panel/i);
    expect(text).toMatch(/ready|new quiz/i);
  });
});

// ---------------------------------------------------------------------------
// Panel-mode quiz session (QUIZ:panel marker) — no chat hijacking
// ---------------------------------------------------------------------------

describe("panel-mode quiz session", () => {
  const panelHistory: ConversationMessage[] = [
    assistant(
      `Te preparé un cuestionario en el panel.\n${buildQuizPanelMarker(QUESTIONS)}`,
    ),
  ];

  it("extractQuizFromHistory parses the panel marker with mode 'panel'", () => {
    const session = extractQuizFromHistory(panelHistory);
    expect(session).not.toBeNull();
    expect(session!.mode).toBe("panel");
    expect(session!.currentIndex).toBe(0);
    expect(session!.questions).toHaveLength(3);
  });

  it("chat markers keep mode 'chat'", () => {
    const session = extractQuizFromHistory([
      assistant(`Q1\n${buildQuizMarker(1, QUESTIONS)}`),
    ]);
    expect(session!.mode).toBe("chat");
    expect(session!.currentIndex).toBe(1);
  });

  it("normal chat messages are NOT classified as quiz answers while a panel quiz is pending", () => {
    const r = classifyIntent("¿qué significa la palabra siervo?", panelHistory);
    expect(r.intent).not.toBe("quiz_answer");
    expect(r.intent).not.toBe("quiz_skip");
  });

  it("a plain affirmative does not start the chat quiz while the panel owns it", () => {
    const r = classifyIntent("sí", panelHistory);
    expect(r.intent).not.toBe("quiz_answer");
  });

  it("explicit opt-out still ends the panel quiz (quiz_skip)", () => {
    const r = classifyIntent("prefiero omitir el cuestionario", panelHistory);
    expect(r.intent).toBe("quiz_skip");
    expect(r.quizMode).toBe("panel");
  });

  it("explicit 'ask me in chat' request switches to the chat fallback (quiz_answer idx 0)", () => {
    const r = classifyIntent(
      "hagamos el cuestionario aquí en el chat",
      panelHistory,
    );
    expect(r.intent).toBe("quiz_answer");
    expect(r.quizIndex).toBe(0);
    expect(r.quizMode).toBe("panel");
  });

  it("reinforceQuizSession neither hijacks nor clears the session in panel mode", () => {
    const original = classifyIntent(
      "háblame del contexto de la carta",
      panelHistory,
    );
    const { intentResult, clearQuizOnResponse } = reinforceQuizSession({
      message: "háblame del contexto de la carta",
      intentResult: original,
      history: panelHistory,
      isAffirmative: false,
      isContinuation: false,
    });
    expect(intentResult.intent).not.toBe("quiz_answer");
    expect(clearQuizOnResponse).toBe(false);
  });

  it("reinforceQuizSession does not clear the panel session when a reference is named", () => {
    const { clearQuizOnResponse } = reinforceQuizSession({
      message: "vamos a Tito 2:1",
      intentResult: {
        intent: "annotated_passage",
        reference: "TIT 2:1",
        confidence: "high",
      },
      history: panelHistory,
    });
    // Answer key must stay alive for the panel Submit.
    expect(clearQuizOnResponse).toBe(false);
  });

  it("a panel marker counts as an active quiz for historyHasQuizCleared", () => {
    const history: ConversationMessage[] = [
      assistant(`Skipped.\n${buildQuizClearedMarker()}`),
      assistant(`New quiz in panel.\n${buildQuizPanelMarker(QUESTIONS)}`),
    ];
    expect(historyHasQuizCleared(history)).toBe(false);
  });

  it("panel submit grades against the panel-mode answer key", () => {
    const submit = parseQuizSubmitFromMessage(
      formatQuizSubmitMessage({
        payload: {
          reference: "TIT 1",
          answers: [
            "Pablo",
            "En la isla de Creta",
            "Nombrar líderes y enseñar la vida recta",
          ],
        },
        language: "es",
      }),
    );
    const session = extractQuizFromHistory(panelHistory);
    const grade = gradeQuizSubmission(session!.questions, submit!.answers);
    expect(grade.passed).toBe(true);
    expect(grade.correctCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Readiness from a panel submit
// ---------------------------------------------------------------------------

describe("readiness marking from panel submit", () => {
  it("majority-correct submit + quiz scope → READY marker settles the book", () => {
    // Session: quiz started with scope marker (gate accept / offer accept).
    const history: ConversationMessage[] = [
      assistant(
        `**1/3** ¿Quién escribió?\n${buildQuizMarker(1, QUESTIONS)}${buildQuizScopeMarker({ level: "book", book: "TIT" })}`,
      ),
      user(
        formatQuizSubmitMessage({
          payload: {
            reference: "TIT 1",
            answers: [
              "Pablo",
              "En la isla de Creta",
              "Nombrar líderes y enseñar la vida recta",
            ],
          },
          language: "es",
        }),
      ),
    ];

    // Server-side Path QP sequence:
    const submit = parseQuizSubmitFromMessage(history[1].content);
    const session = extractQuizFromHistory(history);
    const grade = gradeQuizSubmission(session!.questions, submit!.answers);
    const scope = extractQuizScopeFromHistory(history);
    expect(grade.passed).toBe(true);
    expect(scope).toEqual({ level: "book", book: "TIT" });

    const reply = `¡Muy bien!\n${buildReadyMarker(scope!)}${buildQuizClearedMarker()}`;
    const after = [...history, assistant(reply)];

    const state = deriveReadiness(after);
    expect(isBookSettled(state, "TIT")).toBe(true);
    // Quiz session cleared — panel submit leaves no stale chat quiz.
    expect(extractQuizFromHistory(after)).toBeNull();

    // Subsequent chapter drill must NOT re-gate.
    const gate = detectReadinessGate({
      intent: "passage_overview",
      reference: "TIT 1",
      workflowMode: "study",
      history: after,
    });
    expect(gate).toBeNull();

    // Subsequent SECTION pick must not re-gate either — a settled book
    // covers its chapters (no chapter-level nag after the book quiz).
    const sectionGate = detectReadinessGate({
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
      workflowMode: "study",
      history: after,
    });
    expect(sectionGate).toBeNull();
  });

  it("chapter gate still fires when the user jumps straight into verses", () => {
    const gate = detectReadinessGate({
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
      workflowMode: "study",
      history: [user("traduzcamos Tito 1:1-4")],
    });
    expect(gate).not.toBeNull();
    expect(gate!.level).toBe("chapter");
  });

  it("failed submit does not mark readiness", () => {
    const grade = gradeQuizSubmission(QUESTIONS, ["Pedro", null, null]);
    expect(grade.passed).toBe(false);
  });

  it("failed submit emits QUIZ:retry (not READY) and clears the session", () => {
    const history: ConversationMessage[] = [
      assistant(
        `Panel quiz.\n${buildQuizPanelMarker(QUESTIONS)}${buildQuizScopeMarker({ level: "book", book: "JON" })}`,
      ),
      user(
        formatQuizSubmitMessage({
          payload: {
            reference: "JON",
            answers: ["wrong", "wrong", "wrong"],
          },
          language: "es",
        }),
      ),
    ];
    const submit = parseQuizSubmitFromMessage(history[1].content);
    const session = extractQuizFromHistory(history);
    const grade = gradeQuizSubmission(session!.questions, submit!.answers);
    const scope = extractQuizScopeFromHistory(history);
    expect(grade.passed).toBe(false);
    expect(isQuizPass(grade.correctCount, grade.total)).toBe(false);
    expect(scope).toEqual({ level: "book", book: "JON" });

    // Path QP fail sequence: feedback + cleared + retry (no READY).
    const reply =
      `Repasa las notas.\n` +
      buildQuizClearedMarker() +
      buildQuizRetryMarker(scope!, submit!.reference);
    expect(reply).not.toContain("READY:book:JON");
    expect(reply).toContain("QUIZ:cleared");
    expect(reply).toContain("QUIZ:retry:book:JON|JON");

    const after = [...history, assistant(reply)];
    expect(extractQuizFromHistory(after)).toBeNull();
    expect(deriveReadiness(after).readyBooks.has("JON")).toBe(false);
    expect(extractPendingQuizRetry(after)).toEqual({
      level: "book",
      book: "JON",
      quizRef: "JON",
      kind: "context",
    });
  });

  it("pass submit does not emit QUIZ:retry", () => {
    const scope = { level: "book" as const, book: "JON" };
    const grade = gradeQuizSubmission(QUESTIONS, [
      "Pablo",
      "En la isla de Creta",
      "Nombrar líderes y enseñar la vida recta",
    ]);
    expect(grade.passed).toBe(true);
    const reply =
      `¡Bien!\n${buildReadyMarker(scope)}${buildQuizClearedMarker()}` +
      (!grade.passed ? buildQuizRetryMarker(scope, "JON") : "");
    expect(reply).toContain("READY:book:JON");
    expect(reply).not.toContain("QUIZ:retry");
  });
});

// ---------------------------------------------------------------------------
// Fail → re-study → regenerate (QUIZ:retry)
// ---------------------------------------------------------------------------

describe("quiz retry after fail", () => {
  it("extractPendingQuizRetry reads last-assistant marker only", () => {
    const stale = assistant(
      `old\n${buildQuizRetryMarker({ level: "book", book: "TIT" }, "TIT")}`,
    );
    const current = assistant(
      `new\n${buildQuizRetryMarker({ level: "ch", book: "JON", chapter: "1" }, "JON 1")}`,
    );
    expect(extractPendingQuizRetry([stale, user("ok"), current])).toEqual({
      level: "chapter",
      book: "JON",
      chapter: "1",
      quizRef: "JON 1",
      kind: "context",
    });
    // A newer assistant turn without the marker clears the pending retry.
    expect(
      extractPendingQuizRetry([
        stale,
        user("ok"),
        current,
        assistant("moved on"),
      ]),
    ).toBeNull();
  });

  it("interpretQuizRetryReply accepts affirmatives and try-again phrasing", () => {
    const aff = (m: string) => /^(s[ií]|yes|ok)$/i.test(m.trim());
    expect(interpretQuizRetryReply("sí", { isAffirmative: true }, aff)).toBe(
      "accept",
    );
    expect(interpretQuizRetryReply("estoy listo", {}, aff)).toBe("accept");
    expect(interpretQuizRetryReply("try again", {}, aff)).toBe("accept");
    expect(
      interpretQuizRetryReply("no gracias", { isNegative: true }, aff),
    ).toBe("decline");
    expect(interpretQuizRetryReply("¿qué significa siervo?", {}, aff)).toBe(
      "other",
    );
  });

  it("affirm after fail yields a regenerate-ready scope+ref (Path QR inputs)", () => {
    const failReply =
      `Relee el contexto.\n` +
      buildQuizClearedMarker() +
      buildQuizRetryMarker({ level: "book", book: "JON" }, "JON");
    const history: ConversationMessage[] = [
      assistant(failReply),
      user("sí, ya leí"),
    ];
    const pending = extractPendingQuizRetry(history);
    expect(pending).toEqual({
      level: "book",
      book: "JON",
      quizRef: "JON",
      kind: "context",
    });
    const reply = interpretQuizRetryReply(
      "sí, ya leí",
      { isAffirmative: true },
      () => false,
    );
    expect(reply).toBe("accept");
    // Regenerated panel session would look like this (no READY yet, no retry).
    const regenerated =
      `Panel quiz ready.\n` +
      buildQuizPanelMarker(QUESTIONS) +
      buildQuizScopeMarker({ level: "book", book: "JON" });
    const after = [...history, assistant(regenerated)];
    expect(extractPendingQuizRetry(after)).toBeNull();
    expect(extractQuizFromHistory(after)?.mode).toBe("panel");
    expect(extractQuizFromHistory(after)?.kind).toBe("context");
    expect(deriveReadiness(after).readyBooks.has("JON")).toBe(false);
  });

  it("unrelated chat after fail does not keep sticky quiz grading", () => {
    const history: ConversationMessage[] = [
      assistant(
        `Fail.\n${buildQuizClearedMarker()}${buildQuizRetryMarker({ level: "book", book: "JON" }, "JON")}`,
      ),
    ];
    const r = classifyIntent("¿quién es Jonás?", history);
    expect(r.intent).not.toBe("quiz_answer");
    expect(extractQuizFromHistory(history)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fresh-flow gate fix: affirmative chapter-offer composition
// ---------------------------------------------------------------------------

describe("extractChapterOfferFromAssistant (fresh-flow gate fix)", () => {
  it("extracts the offered chapter from a Spanish orientation closer", () => {
    const text =
      "Tito era un colaborador de Pablo en Creta. ¿Tienes alguna pregunta sobre el contexto o te gustaría comenzar con el capítulo 1?";
    expect(extractChapterOfferFromAssistant(text)).toBe(1);
  });

  it("extracts English and ordinal offers, preferring the last mention", () => {
    expect(
      extractChapterOfferFromAssistant(
        "Would you like to start with chapter 2?",
      ),
    ).toBe(2);
    expect(
      extractChapterOfferFromAssistant(
        "We covered chapter 1. Shall we move to chapter 3?",
      ),
    ).toBe(3);
    expect(
      extractChapterOfferFromAssistant(
        "¿Te gustaría empezar por el primer capítulo?",
      ),
    ).toBe(1);
  });

  it("ignores hidden markers and returns null without a chapter mention", () => {
    expect(
      extractChapterOfferFromAssistant(
        "¿Tienes preguntas?\n<!-- QUIZSCOPE:ch:TIT:9 -->",
      ),
    ).toBeNull();
    expect(extractChapterOfferFromAssistant("")).toBeNull();
    expect(extractChapterOfferFromAssistant(null)).toBeNull();
  });

  it("composed reference + passage_overview intent fires the book readiness gate", () => {
    // Fresh flow: book orientation happened (studyRef = "TIT"), user says
    // "sí, empecemos" → composition yields "TIT 1" / passage_overview.
    const offered = extractChapterOfferFromAssistant(
      "¿Te gustaría comenzar con el capítulo 1?",
    );
    expect(offered).toBe(1);
    const gate = detectReadinessGate({
      intent: "passage_overview",
      reference: `TIT ${offered}`,
      workflowMode: "study",
      history: [
        assistant("¿Te gustaría comenzar con el capítulo 1?"),
        user("sí, empecemos"),
      ],
      studyRef: "TIT",
    });
    expect(gate).not.toBeNull();
    expect(gate!.level).toBe("book");
    expect(gate!.book).toBe("TIT");
    expect(gate!.pendingRef).toBe("TIT 1");
  });
});
