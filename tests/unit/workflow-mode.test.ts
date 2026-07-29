/**
 * Workflow modes — defaults, intent→mode sync, prompt bias, panel emphasis.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORKFLOW_MODE,
  WORKFLOW_CLARIFY_MARKER,
  WORKFLOW_MODES,
  buildWorkflowClarifyQuestion,
  detectWorkflowModeIntent,
  hasAskedWorkflowClarify,
  hasPendingWorkflowClarify,
  inferWorkflowMode,
  isWorkflowMode,
  parseWorkflowClarifyAnswer,
  parseWorkflowMode,
  panelEmphasisForMode,
  prefersCheckingPath,
  shouldAskWorkflowClarify,
  shouldOfferContextQuiz,
  workflowClarifyPromptInstruction,
  workflowModeHint,
  workflowModePromptBias,
} from "../../src/core/harness/workflowMode.js";
import {
  buildCheckingSessionMarker,
  ensureCheckingSessionFooter,
  reinforceCheckingSession,
  type ConversationMessage,
  type IntentResult,
} from "../../src/core/harness/intent.js";

describe("workflow mode defaults", () => {
  it("defaults to study", () => {
    expect(DEFAULT_WORKFLOW_MODE).toBe("study");
    expect(WORKFLOW_MODES).toEqual(["study", "translate", "check"]);
  });

  it("parseWorkflowMode accepts valid values and falls back", () => {
    expect(parseWorkflowMode("check")).toBe("check");
    expect(parseWorkflowMode("TRANSLATE")).toBe("translate");
    expect(parseWorkflowMode("nope")).toBe("study");
    expect(parseWorkflowMode(undefined, "check")).toBe("check");
    expect(isWorkflowMode("study")).toBe(true);
    expect(isWorkflowMode("draft")).toBe(false);
  });

  it("panel emphasis and quiz/check preferences match modes", () => {
    expect(panelEmphasisForMode("study")).toBe("context");
    expect(panelEmphasisForMode("translate")).toBe("draft");
    expect(panelEmphasisForMode("check")).toBe("checklist");
    expect(shouldOfferContextQuiz("study")).toBe(true);
    expect(shouldOfferContextQuiz("translate")).toBe(true);
    expect(shouldOfferContextQuiz("check")).toBe(false);
    expect(prefersCheckingPath("check")).toBe(true);
    expect(prefersCheckingPath("study")).toBe(false);
  });
});

describe("detectWorkflowModeIntent", () => {
  it("detects check / Pedir revisión cues", () => {
    expect(detectWorkflowModeIntent("I want to check my draft")).toBe("check");
    expect(detectWorkflowModeIntent("I'm ready for check questions")).toBe(
      "check",
    );
    expect(
      detectWorkflowModeIntent("Estoy listo para preguntas de revisión"),
    ).toBe("check");
    expect(detectWorkflowModeIntent("Pedir revisión")).toBe("check");
    expect(detectWorkflowModeIntent("please check my translation")).toBe(
      "check",
    );
  });

  it("detects translate / study cues", () => {
    expect(detectWorkflowModeIntent("let's translate")).toBe("translate");
    expect(detectWorkflowModeIntent("quiero traducir")).toBe("translate");
    expect(detectWorkflowModeIntent("skip the study")).toBe("translate");
    expect(detectWorkflowModeIntent("let's study first")).toBe("study");
    expect(detectWorkflowModeIntent("quiero estudiar")).toBe("study");
    expect(detectWorkflowModeIntent("switch to study")).toBe("study");
  });

  it("detects understand-the-passage as a study cue (EN + ES)", () => {
    expect(
      detectWorkflowModeIntent(
        "show me the ULT so I can start by understanding the passage",
      ),
    ).toBe("study");
    expect(detectWorkflowModeIntent("I want to understand the passage")).toBe(
      "study",
    );
    expect(detectWorkflowModeIntent("quiero comprender el pasaje")).toBe(
      "study",
    );
  });

  it("returns null for ordinary coaching messages", () => {
    expect(detectWorkflowModeIntent("What does grace mean here?")).toBeNull();
    expect(detectWorkflowModeIntent("Explain this passage")).toBeNull();
    expect(detectWorkflowModeIntent("")).toBeNull();
  });

  it("detects NL re-entry to checking (EN)", () => {
    for (const phrase of [
      "let's go back to checking my draft of Titus 1:1-4",
      "go back to the review",
      "resume the review",
      "resume checking",
      "continue checking",
      "let's continue the review",
      "keep checking",
    ]) {
      expect(detectWorkflowModeIntent(phrase), phrase).toBe("check");
    }
  });

  it("detects NL re-entry to checking (ES)", () => {
    for (const phrase of [
      "volvamos a la revisión de mi borrador",
      "volvamos a revisar Tito 1:1-4",
      "regresemos a la revisión",
      "retomemos la revisión",
      "sigamos con la revisión",
      "continuemos revisando",
    ]) {
      expect(detectWorkflowModeIntent(phrase), phrase).toBe("check");
    }
  });

  it("re-entry phrases do not misfire on study/translate", () => {
    expect(
      detectWorkflowModeIntent("let's go back to studying the context"),
    ).not.toBe("check");
    expect(detectWorkflowModeIntent("continue translating")).not.toBe("check");
  });

  it("detects finished-draft / is-it-ok check cues (EN)", () => {
    for (const phrase of [
      "I finished my draft",
      "I've finished the translation",
      "I have finished translating",
      "is my translation ok?",
      "is my draft correct?",
    ]) {
      expect(detectWorkflowModeIntent(phrase), phrase).toBe("check");
    }
  });

  it("detects finished-draft / está-bien check cues (ES)", () => {
    for (const phrase of [
      "terminé mi borrador",
      "ya terminé mi traducción",
      "acabé de traducir",
      "¿está bien mi traducción?",
      "mi traducción está bien?",
    ]) {
      expect(detectWorkflowModeIntent(phrase), phrase).toBe("check");
    }
  });
});

describe("inferWorkflowMode (soft conversation cues)", () => {
  it("routes drafting questions to translate from study (EN)", () => {
    for (const phrase of [
      "How do I say 'grace' in a natural way?",
      "how would I translate this phrase",
      "I'm drafting the first section now",
      "I am translating verse 2",
      "this is hard to translate",
    ]) {
      expect(inferWorkflowMode(phrase, "study")?.mode, phrase).toBe(
        "translate",
      );
      expect(inferWorkflowMode(phrase, "study")?.confidence, phrase).toBe(
        "soft",
      );
    }
  });

  it("routes drafting questions to translate from study (ES)", () => {
    for (const phrase of [
      "¿cómo digo esto en mi idioma?",
      "cómo se dice 'siervo'?",
      "estoy traduciendo la sección 1",
      "no sé cómo traducir esta frase",
      "es difícil de traducir",
    ]) {
      expect(inferWorkflowMode(phrase, "study")?.mode, phrase).toBe(
        "translate",
      );
    }
  });

  it("soft translate cues never pull the user out of Check", () => {
    expect(inferWorkflowMode("how do I say this better?", "check")).toBeNull();
    expect(inferWorkflowMode("¿cómo digo esto?", "check")).toBeNull();
  });

  it("finished-draft cues route to check from any mode", () => {
    for (const mode of WORKFLOW_MODES) {
      expect(inferWorkflowMode("I finished my draft", mode)?.mode).toBe(
        "check",
      );
      expect(inferWorkflowMode("terminé mi borrador", mode)?.mode).toBe(
        "check",
      );
      expect(inferWorkflowMode("did I translate it right?", mode)?.mode).toBe(
        "check",
      );
    }
  });

  it("meaning/context questions confirm Study but never yank drafting/checking", () => {
    for (const phrase of [
      "What does grace mean here?",
      "Explain this passage",
      "What cultural background should I know?",
      "¿qué significa 'siervo'?",
      "explícame el contexto",
    ]) {
      expect(inferWorkflowMode(phrase, "study")?.mode, phrase).toBe("study");
      expect(inferWorkflowMode(phrase, "translate"), phrase).toBeNull();
      expect(inferWorkflowMode(phrase, "check"), phrase).toBeNull();
    }
  });

  it("explicit switch phrases win with explicit confidence", () => {
    expect(inferWorkflowMode("let's study first", "check")).toEqual({
      mode: "study",
      confidence: "explicit",
    });
    expect(inferWorkflowMode("quiero traducir", "study")).toEqual({
      mode: "translate",
      confidence: "explicit",
    });
  });

  it("returns null for messages with no mode signal", () => {
    expect(inferWorkflowMode("Titus 1", "study")).toBeNull();
    expect(inferWorkflowMode("gracias", "study")).toBeNull();
    expect(inferWorkflowMode("", "study")).toBeNull();
  });
});

describe("session-start clarify question", () => {
  const noSignalMsg = "Titus 1";

  it("asks when a passage session starts with no mode signal", () => {
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "study",
        history: [],
      }),
    ).toBe(true);
  });

  it("does not ask when this turn already signals a mode", () => {
    for (const msg of [
      "let's translate Titus 1",
      "I finished my draft of Titus 1",
      "how do I say 'servant'?",
      "explain Titus 1", // soft study cue counts as a signal
    ]) {
      expect(
        shouldAskWorkflowClarify({
          message: msg,
          currentMode: "study",
          history: [],
        }),
        msg,
      ).toBe(false);
    }
  });

  it("does not ask when the mode is already non-default", () => {
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "translate",
        history: [],
      }),
    ).toBe(false);
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "check",
        history: [],
      }),
    ).toBe(false);
  });

  it("asks at most once per session (marker in history)", () => {
    const history = [
      {
        role: "assistant",
        content: `Here is Titus 1.\n${WORKFLOW_CLARIFY_MARKER}`,
      },
      { role: "user", content: "hmm" },
      { role: "assistant", content: "Ok." },
    ];
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "study",
        history,
      }),
    ).toBe(false);
    expect(hasAskedWorkflowClarify(history)).toBe(true);
    expect(hasPendingWorkflowClarify(history)).toBe(false);
  });

  it("does not ask when a prior user turn already picked a mode", () => {
    const history = [
      { role: "user", content: "quiero traducir" },
      { role: "assistant", content: "Claro." },
    ];
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "study",
        history,
      }),
    ).toBe(false);
  });

  it("does not ask while a sticky checking / quiz session is active", () => {
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "study",
        history: [],
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it("never asks when the mode was explicitly chosen (UI tab click)", () => {
    // Explicit Study equals the default mode — the flag is the only signal.
    expect(
      shouldAskWorkflowClarify({
        message: noSignalMsg,
        currentMode: "study",
        modeExplicit: true,
        history: [],
      }),
    ).toBe(false);
  });

  it("pending clarify is detected only on the LAST assistant turn", () => {
    const pending = [
      { role: "user", content: "Titus 1" },
      { role: "assistant", content: `Overview…\n${WORKFLOW_CLARIFY_MARKER}` },
    ];
    expect(hasPendingWorkflowClarify(pending)).toBe(true);
  });

  it("parses clarify answers to modes (EN)", () => {
    expect(parseWorkflowClarifyAnswer("I'd like to study it first")).toBe(
      "study",
    );
    expect(parseWorkflowClarifyAnswer("study first")).toBe("study");
    expect(parseWorkflowClarifyAnswer("start translating")).toBe("translate");
    expect(parseWorkflowClarifyAnswer("I want to write my draft")).toBe(
      "translate",
    );
    expect(parseWorkflowClarifyAnswer("I already have a draft")).toBe("check");
    expect(parseWorkflowClarifyAnswer("check it please")).toBe("check");
  });

  it("parses clarify answers to modes (ES)", () => {
    expect(parseWorkflowClarifyAnswer("estudiarlo primero")).toBe("study");
    expect(parseWorkflowClarifyAnswer("quiero entenderlo primero")).toBe(
      "study",
    );
    expect(parseWorkflowClarifyAnswer("comenzar a traducir")).toBe("translate");
    expect(parseWorkflowClarifyAnswer("ya tengo un borrador")).toBe("check");
    expect(parseWorkflowClarifyAnswer("revisarlo")).toBe("check");
  });

  it("returns null for answers that pick no mode", () => {
    expect(parseWorkflowClarifyAnswer("gracias")).toBeNull();
    expect(parseWorkflowClarifyAnswer("who wrote this book?")).toBeNull();
    expect(parseWorkflowClarifyAnswer("")).toBeNull();
  });

  it("clarify question is one simple question (EN + ES)", () => {
    const en = buildWorkflowClarifyQuestion("en");
    const es = buildWorkflowClarifyQuestion("es-419");
    expect(en).toMatch(/study .*translat.*check/i);
    expect((en.match(/\?/g) ?? []).length).toBe(1);
    expect(es).toMatch(/estudiar .*traducir.*revisar/i);
    expect(workflowClarifyPromptInstruction("en")).toContain(en);
  });
});

describe("clear sticky checking on mode change", () => {
  const history: ConversationMessage[] = [
    {
      role: "assistant",
      content: `Check questions.\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
    },
  ];

  it("Study/Translate intent phrases clear sticky checking session", () => {
    for (const phrase of [
      "let's study first",
      "switch to study",
      "let's translate",
      "quiero traducir",
    ]) {
      expect(detectWorkflowModeIntent(phrase)).not.toBeNull();
      expect(detectWorkflowModeIntent(phrase)).not.toBe("check");
      const { clearCheckingOnResponse, intentResult } =
        reinforceCheckingSession({
          message: phrase,
          intentResult: {
            intent: "checking",
            reference: "TIT 1:1-4",
            confidence: "high",
          } satisfies IntentResult,
          history,
        });
      expect(clearCheckingOnResponse).toBe(true);
      expect(intentResult.intent).not.toBe("checking");
      const cleared = ensureCheckingSessionFooter("Ok", "TIT 1:1-4", {
        cleared: true,
      });
      expect(cleared).toContain("<!-- CHECKING:cleared -->");
    }
  });

  it("Check intent keeps sticky checking", () => {
    const { clearCheckingOnResponse, intentResult } = reinforceCheckingSession({
      message: "I want to check my draft",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(detectWorkflowModeIntent("I want to check my draft")).toBe("check");
    expect(clearCheckingOnResponse).toBe(false);
    expect(intentResult.intent).toBe("checking");
  });
});

describe("workflowModePromptBias", () => {
  it("study soft-pedals checking and invites context", () => {
    const bias = workflowModePromptBias("study");
    expect(bias).toMatch(/STUDY/i);
    expect(bias).toMatch(/Context|overview/i);
    expect(bias).toMatch(/Soft-pedal|Pedir revisión/i);
  });

  it("translate invites draft and avoids sticky checking as primary", () => {
    const bias = workflowModePromptBias("translate");
    expect(bias).toMatch(/TRANSLATE/i);
    expect(bias).toMatch(/Mi traducción/);
    expect(bias).toMatch(/CHECKING|Pedir revisión/i);
  });

  it("check focuses checklist and CANA, not context quiz", () => {
    const bias = workflowModePromptBias("check");
    expect(bias).toMatch(/CHECK/i);
    expect(bias).toMatch(/Checking checklist|CANA/i);
    expect(bias).toMatch(/context quiz/i);
  });

  it("check bias enforces one meaning-based probe per turn", () => {
    const bias = workflowModePromptBias("check");
    expect(bias).toMatch(/Exactly ONE meaning-based CANA probe per turn/i);
    expect(bias).not.toMatch(/2–4/);
    expect(bias).toMatch(/Never ask "How did you translate X\?"/);
    expect(bias).toMatch(/what the word they chose means in their language/i);
  });

  it("hints are short one-liners", () => {
    expect(workflowModeHint("study").length).toBeLessThan(80);
    expect(workflowModeHint("translate", "es")).toMatch(/traducci/i);
    expect(workflowModeHint("check", "es")).toMatch(/revisi/i);
  });
});
