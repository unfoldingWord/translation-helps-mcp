/**
 * Unit tests for the context-readiness soft gate:
 *   - READY / optout / READYGATE / QUIZSCOPE / QUIZSCORE marker parse + derive
 *   - gate trigger conditions (book vs chapter, opt-out suppression,
 *     existing-draft/checking bypass, active-session bypass)
 *   - majority-correct pass rule
 *   - gate offer-answer interpretation (yes / no / other)
 */

import { describe, it, expect } from "vitest";
import {
  buildQuizScopeMarker,
  buildQuizScoreMarker,
  buildReadinessGateMarker,
  fallbackReadinessGateQuestion,
  buildReadinessOptOutMarker,
  buildReadyMarker,
  deriveReadiness,
  detectReadinessGate,
  extractPendingReadinessGate,
  extractQuizScopeFromHistory,
  extractQuizScoreFromHistory,
  hasExistingWorkFor,
  interpretReadinessGateReply,
  isBookSettled,
  isChapterSettled,
  isQuizPass,
  parseRefParts,
  quizScopeForReference,
} from "../../src/core/harness/contextReadiness.js";
import {
  buildCheckingSessionMarker,
  type ConversationMessage,
} from "../../src/core/harness/intent.js";
import {
  buildQuizClearedMarker,
  buildQuizMarker,
} from "../../src/core/harness/QuizAgents.js";
import { isAffirmative } from "../../src/core/harness/warmup.js";

const assistant = (content: string): ConversationMessage => ({
  role: "assistant",
  content,
});
const user = (content: string): ConversationMessage => ({
  role: "user",
  content,
});

const interpret = (
  message: string,
  flags: { isAffirmative?: boolean; isNegative?: boolean } = {},
) => interpretReadinessGateReply(message, flags, isAffirmative);

// ---------------------------------------------------------------------------
// Markers: build + parse round-trips
// ---------------------------------------------------------------------------

describe("readiness markers", () => {
  it("builds book / chapter READY markers", () => {
    expect(buildReadyMarker({ level: "book", book: "TIT" })).toBe(
      "<!-- READY:book:TIT -->",
    );
    expect(
      buildReadyMarker({ level: "chapter", book: "TIT", chapter: "1" }),
    ).toBe("<!-- READY:ch:TIT:1 -->");
  });

  it("builds opt-out markers", () => {
    expect(buildReadinessOptOutMarker({ level: "book", book: "TIT" })).toBe(
      "<!-- READY:optout:book:TIT -->",
    );
    expect(
      buildReadinessOptOutMarker({
        level: "chapter",
        book: "TIT",
        chapter: "2",
      }),
    ).toBe("<!-- READY:optout:ch:TIT:2 -->");
  });

  it("derives readiness state from history markers", () => {
    const history = [
      assistant(
        `Nice work!\n${buildReadyMarker({ level: "book", book: "TIT" })}`,
      ),
      user("gracias"),
      assistant(
        `Ok.\n${buildReadinessOptOutMarker({ level: "chapter", book: "TIT", chapter: "2" })}`,
      ),
      assistant(
        `Done.\n${buildReadyMarker({ level: "chapter", book: "JHN", chapter: "3" })}`,
      ),
    ];
    const state = deriveReadiness(history);
    expect(state.readyBooks.has("TIT")).toBe(true);
    expect(state.readyChapters.has("JHN:3")).toBe(true);
    expect(state.optOutChapters.has("TIT:2")).toBe(true);
    expect(isBookSettled(state, "TIT")).toBe(true);
    expect(isBookSettled(state, "JHN")).toBe(false);
    expect(isChapterSettled(state, "TIT", "2")).toBe(true); // opted out counts
    expect(isChapterSettled(state, "TIT", "1")).toBe(false);
  });

  it("ignores markers on user turns (server-emitted only)", () => {
    const state = deriveReadiness([user("<!-- READY:book:TIT --> sneaky")]);
    expect(state.readyBooks.size).toBe(0);
  });

  it("returns empty state for empty history", () => {
    const state = deriveReadiness(undefined);
    expect(state.readyBooks.size).toBe(0);
    expect(isBookSettled(state, "TIT")).toBe(false);
  });
});

describe("pending gate marker", () => {
  const gate = {
    level: "chapter" as const,
    book: "TIT",
    chapter: "1",
    pendingRef: "TIT 1:1-4",
    pendingIntent: "annotated_passage",
  };

  it("round-trips a chapter gate on the last assistant turn", () => {
    const history = [assistant(`Question?\n${buildReadinessGateMarker(gate)}`)];
    expect(extractPendingReadinessGate(history)).toEqual(gate);
  });

  it("round-trips a book gate", () => {
    const bookGate = {
      level: "book" as const,
      book: "TIT",
      chapter: undefined,
      pendingRef: "TIT 1",
      pendingIntent: "passage_overview",
    };
    const history = [
      assistant(`Question?\n${buildReadinessGateMarker(bookGate)}`),
    ];
    expect(extractPendingReadinessGate(history)).toEqual(bookGate);
  });

  it("ignores stale offers (not on the last assistant turn)", () => {
    const history = [
      assistant(`Question?\n${buildReadinessGateMarker(gate)}`),
      user("show me John 3 instead"),
      assistant("Here is John 3 …"),
    ];
    expect(extractPendingReadinessGate(history)).toBeNull();
  });

  it("returns null when no gate marker exists", () => {
    expect(extractPendingReadinessGate([assistant("hello")])).toBeNull();
    expect(extractPendingReadinessGate(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quiz scope + score companions
// ---------------------------------------------------------------------------

describe("quiz scope / score history extraction", () => {
  const questions = [
    { q: "Q1?", a: "A1" },
    { q: "Q2?", a: "A2" },
    { q: "Q3?", a: "A3" },
  ];

  it("finds the active quiz scope and running score", () => {
    const history = [
      assistant(
        `**1/3** Q1?\n${buildQuizMarker(1, questions)}${buildQuizScopeMarker({
          level: "chapter",
          book: "TIT",
          chapter: "1",
        })}${buildQuizScoreMarker(0)}`,
      ),
      user("my answer"),
      assistant(
        `Good.\n**2/3** Q2?\n${buildQuizMarker(2, questions)}${buildQuizScoreMarker(1)}`,
      ),
    ];
    expect(extractQuizScopeFromHistory(history)).toEqual({
      level: "chapter",
      book: "TIT",
      chapter: "1",
    });
    expect(extractQuizScoreFromHistory(history)).toBe(1);
  });

  it("stops at QUIZ:cleared — previous session scope/score never leak", () => {
    const history = [
      assistant(
        `old quiz\n${buildQuizScopeMarker({ level: "book", book: "TIT" })}${buildQuizScoreMarker(3)}`,
      ),
      assistant(`done\n${buildQuizClearedMarker()}`),
    ];
    expect(extractQuizScopeFromHistory(history)).toBeNull();
    expect(extractQuizScoreFromHistory(history)).toBe(0);
  });

  it("majority-correct pass rule", () => {
    expect(isQuizPass(3, 4)).toBe(true);
    expect(isQuizPass(2, 4)).toBe(false); // exactly half is not a majority
    expect(isQuizPass(2, 3)).toBe(true);
    expect(isQuizPass(1, 3)).toBe(false);
    expect(isQuizPass(0, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reference parsing / scope derivation
// ---------------------------------------------------------------------------

describe("parseRefParts / quizScopeForReference", () => {
  it("parses book / chapter / verse-range refs", () => {
    expect(parseRefParts("TIT")).toEqual({
      book: "TIT",
      chapter: undefined,
      verseStart: undefined,
      verseEnd: undefined,
    });
    expect(parseRefParts("TIT 1")).toMatchObject({ book: "TIT", chapter: "1" });
    expect(parseRefParts("TIT 1:1-4")).toMatchObject({
      book: "TIT",
      chapter: "1",
      verseStart: "1",
      verseEnd: "4",
    });
    expect(parseRefParts("XYZ 1")).toBeNull();
    expect(parseRefParts("")).toBeNull();
  });

  it("maps refs to quiz scopes", () => {
    expect(quizScopeForReference("TIT")).toEqual({
      level: "book",
      book: "TIT",
    });
    expect(quizScopeForReference("TIT 1")).toEqual({
      level: "chapter",
      book: "TIT",
      chapter: "1",
    });
    expect(quizScopeForReference("TIT 1:1-4")).toEqual({
      level: "chapter",
      book: "TIT",
      chapter: "1",
    });
    expect(quizScopeForReference("not a ref")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate trigger conditions
// ---------------------------------------------------------------------------

describe("detectReadinessGate", () => {
  const base = {
    workflowMode: "study",
    history: [] as ConversationMessage[],
    studyRef: null,
    studyContext: undefined,
  };

  it("chapter drill (passage_overview) gates on BOOK readiness", () => {
    const gate = detectReadinessGate({
      ...base,
      intent: "passage_overview",
      reference: "TIT 1",
    });
    expect(gate).toEqual({
      level: "book",
      book: "TIT",
      pendingRef: "TIT 1",
      pendingIntent: "passage_overview",
    });
  });

  it("section / verse-range pick (annotated_passage) gates on CHAPTER readiness", () => {
    const gate = detectReadinessGate({
      ...base,
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
    });
    expect(gate).toEqual({
      level: "chapter",
      book: "TIT",
      chapter: "1",
      pendingRef: "TIT 1:1-4",
      pendingIntent: "annotated_passage",
    });
  });

  it("explicit Translate switch gates on the loaded chapter", () => {
    const gate = detectReadinessGate({
      ...base,
      intent: "open_ended",
      explicitModeSwitch: "translate",
      studyRef: "TIT 1",
    });
    expect(gate).toEqual({
      level: "chapter",
      book: "TIT",
      chapter: "1",
      pendingRef: "TIT 1",
      pendingIntent: "open_ended",
    });
  });

  it("Translate switch with a book-only study ref gates at BOOK level", () => {
    const gate = detectReadinessGate({
      ...base,
      intent: "open_ended",
      explicitModeSwitch: "translate",
      studyRef: "TIT",
    });
    expect(gate).toMatchObject({ level: "book", book: "TIT" });
  });

  it("does not gate when book readiness already earned", () => {
    const gate = detectReadinessGate({
      ...base,
      history: [assistant(buildReadyMarker({ level: "book", book: "TIT" }))],
      intent: "passage_overview",
      reference: "TIT 1",
    });
    expect(gate).toBeNull();
  });

  it("does not gate when the user opted out (never nag again)", () => {
    const gate = detectReadinessGate({
      ...base,
      history: [
        assistant(
          buildReadinessOptOutMarker({
            level: "chapter",
            book: "TIT",
            chapter: "1",
          }),
        ),
      ],
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
    });
    expect(gate).toBeNull();
  });

  it("chapter opt-out only suppresses that chapter", () => {
    const history = [
      assistant(
        buildReadinessOptOutMarker({
          level: "chapter",
          book: "TIT",
          chapter: "1",
        }),
      ),
    ];
    expect(
      detectReadinessGate({
        ...base,
        history,
        intent: "annotated_passage",
        reference: "TIT 2:1-5",
      }),
    ).toMatchObject({ level: "chapter", book: "TIT", chapter: "2" });
  });

  it("does not gate in Check mode or with a sticky checking session", () => {
    expect(
      detectReadinessGate({
        ...base,
        workflowMode: "check",
        intent: "annotated_passage",
        reference: "TIT 1:1-4",
      }),
    ).toBeNull();
    expect(
      detectReadinessGate({
        ...base,
        history: [assistant(buildCheckingSessionMarker("TIT 1:1-4"))],
        intent: "annotated_passage",
        reference: "TIT 1:1-4",
      }),
    ).toBeNull();
  });

  it("does not gate while a quiz is active or an offer is pending", () => {
    const questions = JSON.stringify([
      { q: "Q1?", a: "A1" },
      { q: "Q2?", a: "A2" },
      { q: "Q3?", a: "A3" },
    ]);
    expect(
      detectReadinessGate({
        ...base,
        history: [assistant(`<!-- QUIZ:1/3 ${questions} -->`)],
        intent: "annotated_passage",
        reference: "TIT 1:1-4",
      }),
    ).toBeNull();
    expect(
      detectReadinessGate({
        ...base,
        history: [
          assistant(
            buildReadinessGateMarker({
              level: "book",
              book: "TIT",
              pendingRef: "TIT 1",
              pendingIntent: "passage_overview",
            }),
          ),
        ],
        intent: "passage_overview",
        reference: "TIT 1",
      }),
    ).toBeNull();
  });

  it("does not gate batch continuations or excluded intents", () => {
    expect(
      detectReadinessGate({
        ...base,
        intent: "passage_help",
        reference: "TIT 1:5-8",
        continuationRef: "TIT 1:5-8",
      }),
    ).toBeNull();
    for (const intent of [
      "checking",
      "quiz_answer",
      "checklist_step",
      "word_study",
    ]) {
      expect(
        detectReadinessGate({ ...base, intent, reference: "TIT 1:1-4" }),
      ).toBeNull();
    }
  });

  it("existing saved draft for the scope bypasses the gate", () => {
    const studyContext = [
      "Workflow mode: study",
      "Loaded passage: TIT 1 (source/conversation: es-419; receptor target: es-419)",
      "Saved drafts: TIT 1:1-4; TIT 2:1-5",
    ].join("\n");
    expect(
      detectReadinessGate({
        ...base,
        studyContext,
        intent: "annotated_passage",
        reference: "TIT 1:6-9",
      }),
    ).toBeNull();
    // A different book still gates.
    expect(
      detectReadinessGate({
        ...base,
        studyContext,
        intent: "annotated_passage",
        reference: "JHN 3:1-4",
      }),
    ).toMatchObject({ level: "chapter", book: "JHN", chapter: "3" });
  });

  it("existing checking checklist for the scope bypasses the gate", () => {
    const studyContext = [
      "Checking checklist for TIT 1:1-4: 1/5 complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).",
      "[ ] note:tn1 v.1 — some note",
    ].join("\n");
    expect(
      detectReadinessGate({
        ...base,
        studyContext,
        intent: "annotated_passage",
        reference: "TIT 1:1-4",
      }),
    ).toBeNull();
  });

  it("hasExistingWorkFor matches book-level scopes across chapters", () => {
    const studyContext = "Saved drafts: TIT 2:1-5";
    expect(hasExistingWorkFor(studyContext, "TIT")).toBe(true);
    expect(hasExistingWorkFor(studyContext, "TIT", "1")).toBe(false);
    expect(hasExistingWorkFor(studyContext, "JHN")).toBe(false);
    expect(hasExistingWorkFor(undefined, "TIT")).toBe(false);
  });

  it("requires a resolvable pending ref (no gate without one)", () => {
    expect(
      detectReadinessGate({
        ...base,
        intent: "open_ended",
        explicitModeSwitch: "translate",
        studyRef: null,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Offer text + reply interpretation
// ---------------------------------------------------------------------------

describe("gate offer question fallback", () => {
  it("is a short English emergency stub (not polished coach ES/EN copy)", () => {
    expect(fallbackReadinessGateQuestion("book", "en")).toMatch(
      /^\[offline\].*book-context/i,
    );
    expect(fallbackReadinessGateQuestion("chapter", "en")).toMatch(
      /^\[offline\].*chapter-context/i,
    );
    // Language arg ignored — no Spanish production strings in this file.
    expect(fallbackReadinessGateQuestion("book", "es-419")).toBe(
      fallbackReadinessGateQuestion("book", "en"),
    );
    expect(fallbackReadinessGateQuestion("book", "es")).not.toMatch(
      /Antes de continuar|te gustaría|cuestionario/i,
    );
    expect(fallbackReadinessGateQuestion("book", "en")).not.toMatch(
      /Before continuing, would you like/i,
    );
  });
});

describe("interpretReadinessGateReply", () => {
  it("accepts affirmatives (regex and LLM flag)", () => {
    expect(interpret("yes")).toBe("accept");
    expect(interpret("sí")).toBe("accept");
    expect(interpret("hmm okay then", { isAffirmative: true })).toBe("accept");
    expect(interpret("sí, hagamos el cuestionario")).toBe("accept");
  });

  it("declines negatives and quiz opt-outs", () => {
    expect(interpret("no")).toBe("decline");
    expect(interpret("no gracias")).toBe("decline");
    expect(interpret("skip the quiz")).toBe("decline");
    expect(interpret("nah not really", { isNegative: true })).toBe("decline");
  });

  it("treats new requests as 'other' (caller opts out + proceeds)", () => {
    expect(interpret("show me the notes for verse 3")).toBe("other");
    expect(interpret("¿qué significa 'siervo'?")).toBe("other");
  });

  it("negative flag wins over affirmative-looking text", () => {
    expect(interpret("ok but no", { isNegative: true })).toBe("decline");
  });
});
