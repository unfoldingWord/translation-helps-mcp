/**
 * Unit tests for the harness intent classifier and resource selector.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  extractReference,
  extractQuizFromHistory,
  extractCheckingFromHistory,
  extractSessionContext,
  hasQuizFollowOnRequest,
  historyHasQuizCleared,
  isExplicitQuizRequest,
  reinforceQuizSession,
  reinforceCheckingSession,
  isQuizRoutingIntent,
  isCheckingRoutingIntent,
  isQuizOptOut,
  isCheckingOptOut,
  looksLikeQuizAnswer,
  stripQuizOptOutPhrases,
  buildChecklistMarker,
  buildBatchMarker,
  buildCheckingSessionMarker,
  buildCheckingClearedMarker,
  ensureCheckingSessionFooter,
} from "../../src/core/harness/intent.js";
import { selectResources } from "../../src/core/harness/resourceSelector.js";
import {
  buildWarmupMarker,
  buildPendingMarkers,
  buildLangMarker,
} from "../../src/core/harness/warmup.js";
import {
  buildQuizClearedMarker,
  buildQuizMarker,
} from "../../src/core/harness/QuizAgents.js";
import type {
  ConversationMessage,
  IntentResult,
  QuizItem,
} from "../../src/core/harness/intent.js";

// ---------------------------------------------------------------------------
// extractReference
// ---------------------------------------------------------------------------

describe("extractReference", () => {
  it("detects 'John 3:16'", () => {
    expect(extractReference("Explain John 3:16 for translation")).toBe(
      "JHN 3:16",
    );
  });

  it("detects 'JHN 3:16' verbatim", () => {
    expect(extractReference("JHN 3:16")).toBe("JHN 3:16");
  });

  it("detects 'Genesis 1:1'", () => {
    expect(extractReference("Help me translate Genesis 1:1")).toBe("GEN 1:1");
  });

  it("detects 'Matthew 5:3-10' as range", () => {
    const ref = extractReference("The beatitudes Matthew 5:3-10");
    expect(ref).toContain("MAT 5:3");
  });

  // chapter-word pattern tests (second pass)
  it("detects 'Titus chapter 2'", () => {
    expect(
      extractReference("Hi can you help me translate Titus chapter 2"),
    ).toBe("TIT 2");
  });

  it("detects '1 Corinthians chapter 3'", () => {
    expect(
      extractReference("please help me with 1 Corinthians chapter 3"),
    ).toBe("1CO 3");
  });

  it("detects 'Titus ch. 2'", () => {
    expect(extractReference("let's look at Titus ch. 2")).toBe("TIT 2");
  });

  it("detects '1 Cor chap. 3'", () => {
    expect(extractReference("what about 1 Cor chap. 3")).toBe("1CO 3");
  });

  it("returns null for messages without references", () => {
    expect(extractReference("What is a metaphor?")).toBeNull();
    expect(extractReference("How do I translate passive voice?")).toBeNull();
  });

  it("does not false-positive on book-like words", () => {
    // "Explain John" should not produce a reference without chapter/verse
    // (only if followed by valid chapter:verse)
    const ref = extractReference("Can you explain John's theology?");
    // "John" without a chapter:verse number should return null
    // (the parser won't match without a chapter)
    expect(ref).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyIntent
// ---------------------------------------------------------------------------

describe("classifyIntent", () => {
  it("classifies annotated_passage for messages with a short Bible reference", () => {
    const r = classifyIntent("Help me translate John 3:16");
    // Single verse → annotated_passage (replaced passage_help for short ranges)
    expect(r.intent).toBe("annotated_passage");
    expect(r.reference).toBe("JHN 3:16");
    expect(r.confidence).toBe("high");
  });

  it("classifies word_study for 'meaning of grace'", () => {
    const r = classifyIntent("What is the meaning of grace in the Bible?");
    expect(r.intent).toBe("word_study");
    expect(r.confidence).not.toBe("low");
  });

  it("classifies Spanish TW article request as word_study with term", () => {
    const r = classifyIntent("Muéstrame el artículo sobre siervo");
    expect(r.intent).toBe("word_study");
    expect(r.term).toBe("siervo");
    expect(r.confidence).toBe("high");
  });

  it("classifies Spanish 'artículo de Translation Words' as word_study", () => {
    const r = classifyIntent(
      "Quiero el artículo de Translation Words sobre siervo",
    );
    expect(r.intent).toBe("word_study");
    expect(r.term).toBe("siervo");
  });

  it("classifies methodology for 'how to handle metaphors'", () => {
    const r = classifyIntent("How do I translate a metaphor in my language?");
    expect(r.intent).toBe("methodology");
    expect(r.taTopic).toBe("translate/figs-metaphor");
    expect(r.confidence).toBe("high");
  });

  it("classifies methodology for rhetorical question", () => {
    const r = classifyIntent("How should I handle a rhetorical question?");
    expect(r.intent).toBe("methodology");
    expect(r.taTopic).toBe("translate/figs-rquestion");
  });

  it("classifies checking for 'verify translation'", () => {
    const r = classifyIntent("How do I check if my translation is accurate?");
    expect(r.intent).toBe("checking");
  });

  it("classifies discovery for 'what languages are available'", () => {
    const r = classifyIntent("What languages are available in the catalog?");
    expect(r.intent).toBe("discovery");
    expect(r.confidence).toBe("high");
  });

  it("classifies open_ended for general questions", () => {
    const r = classifyIntent("Tell me about the translation process");
    expect(r.intent).toBe("open_ended");
    expect(r.confidence).toBe("low");
  });

  it("annotated_passage takes priority over methodology when short reference present", () => {
    const r = classifyIntent("Explain the metaphor in John 1:1");
    // Single verse → annotated_passage
    expect(r.intent).toBe("annotated_passage");
    expect(r.reference).toBe("JHN 1:1");
  });
});

// ---------------------------------------------------------------------------
// selectResources
// ---------------------------------------------------------------------------

describe("selectResources", () => {
  const lang = "en";

  it("passage_help uses get_passage + get_note + get_passage_index(skipNotes), expands rc-links", () => {
    const plan = selectResources(
      { intent: "passage_help", reference: "JHN 3:16", confidence: "high" },
      lang,
    );
    const toolNames = plan.initialFetches.map((f) => f.tool);
    // Scripture text fetched via get_passage (all versions in one call)
    expect(toolNames).toContain("get_passage");
    expect(toolNames).toContain("get_note");
    expect(toolNames).toContain("get_passage_index");
    const index = plan.initialFetches.find(
      (f) => f.tool === "get_passage_index",
    );
    expect(index && "params" in index && index.params).toMatchObject({
      skipNotes: true,
    });
    expect(plan.rcExpansion).toContain("tn_to_ta");
    expect(plan.rcExpansion).toContain("twl_to_tw");
  });

  it("annotated_passage uses get_passage + get_note + get_passage_index(skipNotes), no rc expansion", () => {
    const plan = selectResources(
      {
        intent: "annotated_passage",
        reference: "JHN 3:16",
        confidence: "high",
      },
      lang,
    );
    expect(plan.intent).toBe("annotated_passage");
    const toolNames = plan.initialFetches.map((f) => f.tool);
    expect(toolNames).toContain("get_passage");
    expect(toolNames).toContain("get_note");
    expect(toolNames).toContain("get_passage_index");
    const index = plan.initialFetches.find(
      (f) => f.tool === "get_passage_index",
    );
    expect(index && "params" in index && index.params).toMatchObject({
      skipNotes: true,
    });
    // No rc expansion — TW/TA fetched on demand during phrase_drill
    expect(plan.rcExpansion).toHaveLength(0);
  });

  it("phrase_drill returns empty plan (resources fetched at runtime from history)", () => {
    const plan = selectResources(
      {
        intent: "phrase_drill",
        challengeIndex: 2,
        challengePhrase: "born again",
        confidence: "high",
      },
      lang,
    );
    expect(plan.intent).toBe("phrase_drill");
    expect(plan.initialFetches).toHaveLength(0);
  });

  it("word_study with bare term uses search locate (not path-as-slug)", () => {
    const plan = selectResources(
      { intent: "word_study", term: "grace", confidence: "medium" },
      lang,
    );
    expect(plan.initialFetches).toHaveLength(0);
    expect(plan.articleLocate).toEqual({
      query: "grace",
      resourceType: "tw",
    });
    expect(plan.rcExpansion).toHaveLength(0);
  });

  it("word_study with TW path uses direct get_word_article", () => {
    const plan = selectResources(
      { intent: "word_study", term: "bible/kt/grace", confidence: "medium" },
      lang,
    );
    expect(plan.initialFetches[0]?.tool).toBe("get_word_article");
    expect(
      (plan.initialFetches[0]?.params as Record<string, unknown>)["path"],
    ).toBe("bible/kt/grace");
  });

  it("word_study without term triggers RAG locate", () => {
    const plan = selectResources(
      { intent: "word_study", confidence: "medium" },
      lang,
    );
    expect(plan.articleLocate).toBeDefined();
    expect(plan.articleLocate?.resourceType).toBe("tw");
  });

  it("methodology with topic uses direct TA fetch", () => {
    const plan = selectResources(
      {
        intent: "methodology",
        taTopic: "translate/figs-metaphor",
        confidence: "high",
      },
      lang,
    );
    expect(plan.initialFetches[0]?.tool).toBe("get_academy_article");
    expect(
      (plan.initialFetches[0]?.params as Record<string, unknown>)["path"],
    ).toBe("translate/figs-metaphor");
  });

  it("checking with reference fetches passage, notes, and questions", () => {
    const plan = selectResources(
      { intent: "checking", reference: "JHN 3:16", confidence: "medium" },
      lang,
    );
    const toolNames = plan.initialFetches.map((f) => f.tool);
    expect(toolNames).toContain("get_questions");
    expect(toolNames).toContain("get_passage");
    expect(toolNames).toContain("get_note");
  });

  it("discovery fetches resources list", () => {
    const plan = selectResources(
      { intent: "discovery", confidence: "high" },
      lang,
    );
    expect(plan.initialFetches[0]?.tool).toBe("list_resources");
  });

  it("open_ended returns empty plan (agentic loop)", () => {
    const plan = selectResources(
      { intent: "open_ended", confidence: "low" },
      lang,
    );
    expect(plan.initialFetches).toHaveLength(0);
    expect(plan.intent).toBe("open_ended");
  });
});

// ---------------------------------------------------------------------------
// Integration-style: word_study routes to TW, methodology routes to TA
// ---------------------------------------------------------------------------

describe("routing for word_study vs methodology", () => {
  it("word_study question produces a TW fetch plan, not TA", () => {
    const intent = classifyIntent(
      "What does the word 'grace' mean in the Bible?",
    );
    expect(intent.intent).toBe("word_study");
    const plan = selectResources(intent, "en");
    const tools = plan.initialFetches.map((f) => f.tool);
    // Bare term → search locate for TW (get_word_article after path resolution), not TA
    expect(
      tools.some((t) => t === "get_word_article") ||
        plan.articleLocate?.resourceType === "tw",
    ).toBe(true);
    expect(tools).not.toContain("get_academy_article");
  });

  it("Spanish siervo article request plans TW locate", () => {
    const intent = classifyIntent("Muéstrame el artículo sobre siervo");
    expect(intent.intent).toBe("word_study");
    expect(intent.term).toBe("siervo");
    const plan = selectResources(intent, "es");
    expect(plan.articleLocate).toEqual({ query: "siervo", resourceType: "tw" });
    expect(plan.initialFetches.map((f) => f.tool)).not.toContain(
      "get_academy_article",
    );
  });

  it("methodology question produces a TA fetch plan, not TW", () => {
    const intent = classifyIntent(
      "How do I handle a metaphor in my translation?",
    );
    expect(intent.intent).toBe("methodology");
    const plan = selectResources(intent, "en");
    const tools = plan.initialFetches.map((f) => f.tool);
    expect(tools).toContain("get_academy_article");
    expect(tools).not.toContain("get_word_article");
  });
});

// ---------------------------------------------------------------------------
// Language-gate + warm-confirmation intent hooks
// ---------------------------------------------------------------------------

describe("language_answer intent", () => {
  it("returns language_answer when AWAITING_LANG + PENDING_PASSAGE present in history", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Which language?\n${buildPendingMarkers("JHN 3:16", "annotated_passage")}`,
      },
    ];
    const result = classifyIntent("Spanish", history);
    expect(result.intent).toBe("language_answer");
    expect(result.pendingRef).toBe("JHN 3:16");
    expect(result.pendingIntent).toBe("annotated_passage");
  });

  it("falls through to normal classification when no AWAITING_LANG marker", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: "Hello!" },
    ];
    const result = classifyIntent("Spanish", history);
    expect(result.intent).not.toBe("language_answer");
  });
});

describe("warm confirmation intent", () => {
  it("sets warmConfirmed=true when user says 'yes' and WARMUP marker present", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Found it!\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}`,
      },
    ];
    const result = classifyIntent("yes", history);
    expect(result.warmConfirmed).toBe(true);
    expect(result.reference).toBe("JHN 3:16");
    expect(result.intent).toBe("annotated_passage");
  });

  it("does NOT set warmConfirmed when 'yes' is sent but no WARMUP marker", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: "Hello! No warmup here." },
    ];
    const result = classifyIntent("yes", history);
    expect(result.warmConfirmed).toBeFalsy();
  });

  it("does NOT trigger warm confirmation for non-affirmative replies", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: buildWarmupMarker("JHN 3:16", "annotated_passage"),
      },
    ];
    const result = classifyIntent("no thanks", history);
    expect(result.warmConfirmed).toBeFalsy();
  });
});

describe("LANG marker in history skips language gate signal", () => {
  it("classifies normally when LANG marker is present", () => {
    const history: ConversationMessage[] = [
      { role: "assistant", content: buildLangMarker("es") },
    ];
    // A new passage request should NOT become language_answer (no AWAITING_LANG)
    const result = classifyIntent("Help me with John 3:16", history);
    expect(result.intent).not.toBe("language_answer");
    expect(result.reference).toBe("JHN 3:16");
  });
});

// ---------------------------------------------------------------------------
// Multi-word warm-confirmation ("yes please", "go ahead", "sure")
// ---------------------------------------------------------------------------

describe("warm confirmation with multi-word phrases", () => {
  const warmHistory: ConversationMessage[] = [
    {
      role: "assistant",
      content: `Yes, I found John 3:16. Would you like me to walk you through it?\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}`,
    },
  ];

  it("sets warmConfirmed for 'yes please'", () => {
    const result = classifyIntent("yes please", warmHistory);
    expect(result.warmConfirmed).toBe(true);
    expect(result.reference).toBe("JHN 3:16");
  });

  it("sets warmConfirmed for 'sure'", () => {
    const result = classifyIntent("sure", warmHistory);
    expect(result.warmConfirmed).toBe(true);
  });

  it("sets warmConfirmed for 'go ahead'", () => {
    const result = classifyIntent("go ahead", warmHistory);
    expect(result.warmConfirmed).toBe(true);
  });

  it("sets warmConfirmed for 'ok'", () => {
    const result = classifyIntent("ok", warmHistory);
    expect(result.warmConfirmed).toBe(true);
  });

  it("does NOT set warmConfirmed for 'no thanks'", () => {
    const result = classifyIntent("no thanks", warmHistory);
    expect(result.warmConfirmed).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Stale AWAITING_LANG marker — language_answer must NOT fire after resolution
// ---------------------------------------------------------------------------

describe("stale AWAITING_LANG does not re-trigger language_answer", () => {
  it("latest assistant turn is warm offer — classifies as warmConfirmed, not language_answer", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Which language?\n${buildPendingMarkers("JHN 3:16", "annotated_passage")}`,
      },
      { role: "user", content: "es-419" },
      {
        role: "assistant",
        content: `Great, I found JHN 3:16. Want me to walk through it?\n${buildLangMarker("es-419")}\n${buildWarmupMarker("JHN 3:16", "annotated_passage")}`,
      },
    ];
    const result = classifyIntent("yes please", history);
    // Should match warm confirmation, NOT language_answer
    expect(result.intent).not.toBe("language_answer");
    expect(result.warmConfirmed).toBe(true);
    expect(result.reference).toBe("JHN 3:16");
  });

  it("classifies normally after language resolved and no pending markers in latest turn", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Which language?\n${buildPendingMarkers("JHN 3:16", "annotated_passage")}`,
      },
      { role: "user", content: "Spanish" },
      { role: "assistant", content: `Great, working in Spanish.` },
    ];
    // A new passage request — no AWAITING_LANG in latest turn
    const result = classifyIntent("Help me with John 3:17", history);
    expect(result.intent).not.toBe("language_answer");
    expect(result.reference).toBe("JHN 3:17");
  });
});

// ---------------------------------------------------------------------------
// Interactive context quiz — marker round-trip + intent routing
// ---------------------------------------------------------------------------

const SAMPLE_QUIZ: QuizItem[] = [
  { q: "¿Quién escribe a Tito?", a: "Pablo" },
  {
    q: "¿Cuál es el propósito de la carta?",
    a: "Instruir a Tito sobre líderes",
  },
  { q: "¿Qué género es este texto?", a: "Carta pastoral / enseñanza" },
  { q: "¿Por qué importa la fe?", a: "Es el fundamento del mensaje" },
];

describe("hidden checklist / batch session markers", () => {
  it("parses <!-- CHECKLIST:step/total -->", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Paso 1 listo.\n¿Seguimos?\n${buildChecklistMarker(1, 5)}`,
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx).toEqual({
      type: "checklist",
      currentStep: 1,
      totalSteps: 5,
    });
  });

  it("parses <!-- BATCH:ref -->", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Notas para JHN 3:1-4.\n¿Continuamos?\n${buildBatchMarker("JHN 3:5-8")}`,
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx).toEqual({ type: "batch", nextRef: "JHN 3:5-8" });
  });

  it("falls back to legacy [Step N/M] footer", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Overview\n---\n*[Step 2/5] — Say "next" when ready.*`,
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx).toEqual({
      type: "checklist",
      currentStep: 2,
      totalSteps: 5,
    });
  });

  it('falls back to legacy Say "next" for batch footer', () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Notes...\n---\n*Batch: JHN 3:1-4 | Say "next" for JHN 3:5-8*`,
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx).toEqual({ type: "batch", nextRef: "JHN 3:5-8" });
  });

  it("advances checklist on natural continuation (vamos)", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Paso 1.\n¿Seguimos?\n${buildChecklistMarker(1, 4)}`,
      },
    ];
    const r = classifyIntent("vamos", history);
    expect(r.intent).toBe("checklist_step");
    expect(r.nextStep).toBe(2);
    expect(r.totalSteps).toBe(4);
  });

  it("does NOT advance checklist on a plain negative", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Paso 1.\n¿Seguimos?\n${buildChecklistMarker(1, 4)}`,
      },
    ];
    const r = classifyIntent("no", history);
    expect(r.intent).not.toBe("checklist_step");
  });

  it("prefers hidden CHECKLIST marker over legacy Step footer in same message", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Overview\n*[Step 1/5] — legacy*\n${buildChecklistMarker(3, 5)}`,
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx).toEqual({
      type: "checklist",
      currentStep: 3,
      totalSteps: 5,
    });
  });
});

describe("context quiz marker parsing", () => {
  it("round-trips QUIZ marker through extractQuizFromHistory", () => {
    const marker = buildQuizMarker(0, SAMPLE_QUIZ);
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Here is TIT 1:1-4.\n---\n*Quiz offer*\n${marker}`,
      },
    ];
    const quiz = extractQuizFromHistory(history);
    expect(quiz).not.toBeNull();
    expect(quiz!.currentIndex).toBe(0);
    expect(quiz!.total).toBe(4);
    expect(quiz!.questions).toHaveLength(4);
    expect(quiz!.questions[0].q).toContain("Tito");
  });

  it("extractSessionContext prefers quiz over checklist footer", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content:
          `Overview\n*[Step 1/5] — next*\n` + buildQuizMarker(2, SAMPLE_QUIZ),
      },
    ];
    const ctx = extractSessionContext(history);
    expect(ctx?.type).toBe("quiz");
    if (ctx?.type === "quiz") {
      expect(ctx.currentIndex).toBe(2);
      expect(ctx.total).toBe(4);
    }
  });

  it("isQuizOptOut detects multilingual declines", () => {
    expect(isQuizOptOut("skip")).toBe(true);
    expect(isQuizOptOut("saltar")).toBe(true);
    expect(isQuizOptOut("no gracias")).toBe(true);
    expect(isQuizOptOut("omitir")).toBe(true);
    expect(isQuizOptOut("mejor no")).toBe(true);
    expect(
      isQuizOptOut(
        "No, prefiero omitir el cuestionario y revisar la nota sobre «fe».",
      ),
    ).toBe(true);
    expect(isQuizOptOut("Pablo escribió la carta")).toBe(false);
    // Uncertainty is an answer, not opt-out (systems-tester contract).
    expect(isQuizOptOut("No sé")).toBe(false);
    expect(isQuizOptOut("I don't know")).toBe(false);
  });

  it("looksLikeQuizAnswer accepts short answers and uncertainty", () => {
    expect(looksLikeQuizAnswer("Pablo el apóstol")).toBe(true);
    expect(looksLikeQuizAnswer("No sé")).toBe(true);
    expect(looksLikeQuizAnswer("I don't know")).toBe(true);
  });

  it("looksLikeQuizAnswer rejects resource requests and long drafting questions", () => {
    expect(
      looksLikeQuizAnswer(
        "No, prefiero omitir el cuestionario y revisar la nota sobre «fe».",
      ),
    ).toBe(false);
    expect(
      looksLikeQuizAnswer(
        "¿Cómo debo usar las notas de traducción mientras redacto «conforme a la fe de los elegidos de Dios»?",
      ),
    ).toBe(false);
    expect(looksLikeQuizAnswer("qué debo hacer ahora")).toBe(false);
  });

  it("hasQuizFollowOnRequest detects compound refuse+resource asks", () => {
    expect(hasQuizFollowOnRequest("omitir")).toBe(false);
    expect(hasQuizFollowOnRequest("saltar")).toBe(false);
    expect(
      hasQuizFollowOnRequest(
        "No, prefiero omitir el cuestionario y revisar la nota sobre «fe».",
      ),
    ).toBe(true);
    expect(
      hasQuizFollowOnRequest(
        "No, omitir el cuestionario y muéstrame el artículo sobre siervo",
      ),
    ).toBe(true);
  });

  it("stripQuizOptOutPhrases keeps the article half of compound Spanish skip", () => {
    const residual = stripQuizOptOutPhrases(
      "No, omitir el cuestionario y muéstrame el artículo sobre siervo",
    );
    expect(residual.toLowerCase()).toMatch(
      /artículo|siervo|muéstrame|muestrame/,
    );
    expect(residual.toLowerCase()).not.toMatch(/\bomitir\b/);
    const classified = classifyIntent(residual);
    expect(classified.intent).toBe("word_study");
    expect(classified.term).toBe("siervo");
  });

  it("historyHasQuizCleared is sticky until a newer quiz marker", () => {
    expect(
      historyHasQuizCleared([
        {
          role: "assistant",
          content: `Ok\n${buildQuizClearedMarker()}`,
        },
      ]),
    ).toBe(true);
    expect(
      historyHasQuizCleared([
        {
          role: "assistant",
          content: `Ok\n${buildQuizClearedMarker()}`,
        },
        {
          role: "assistant",
          content: `New offer\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
        },
      ]),
    ).toBe(false);
  });

  it("isExplicitQuizRequest detects opt-in after skip", () => {
    expect(isExplicitQuizRequest("sí, hagamos el chequeo")).toBe(true);
    expect(isExplicitQuizRequest("quiero hacer el chequeo de contexto")).toBe(
      true,
    );
    expect(isExplicitQuizRequest("muéstrame el artículo sobre siervo")).toBe(
      false,
    );
  });

  it("starts quiz on explicit opt-in phrases (not only bare sí)", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Passage ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    for (const msg of [
      "sí, hagamos el chequeo",
      "hagamos el chequeo",
      "quiero el chequeo",
      "vamos a hacer el chequeo de contexto",
    ]) {
      const r = classifyIntent(msg, history);
      expect(r.intent, msg).toBe("quiz_answer");
      expect(r.quizIndex).toBe(0);
    }
  });

  it("reinforceQuizSession starts Path Q for Spanish opt-in even after spurious studyRef bind", () => {
    // Live failure: wantsPassageResources / study context attached TIT 1:1-4 and
    // overwrote quiz_answer → annotated_passage; reinforce must restore Path Q.
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Guía de TIT 1:1-4.\n---\n*(Opcional)* chequeo\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const msg = "sí, hagamos el chequeo";
    expect(isExplicitQuizRequest(msg)).toBe(true);
    expect(isQuizRoutingIntent("quiz_answer")).toBe(true);

    const stolen: IntentResult = {
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
      confidence: "high",
    };
    const { intentResult, clearQuizOnResponse } = reinforceQuizSession({
      message: msg,
      intentResult: stolen,
      history,
      isAffirmative: true,
    });
    expect(clearQuizOnResponse).toBe(false);
    expect(intentResult.intent).toBe("quiz_answer");
    expect(intentResult.reference).toBeUndefined();
    expect(intentResult.quizIndex).toBe(0);
    expect(intentResult.quizQuestions).toHaveLength(4);
  });

  it("reinforceQuizSession does not clear quiz when only studyRef was attached", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const classified = classifyIntent("sí, hagamos el chequeo", history);
    expect(classified.intent).toBe("quiz_answer");
    // Simulate skillChat attaching studyRef before reinforce (old bug path).
    const withSpuriousRef = {
      ...classified,
      reference: "TIT 1:1-4",
      intent: "annotated_passage" as const,
    };
    const { intentResult, clearQuizOnResponse } = reinforceQuizSession({
      message: "sí, hagamos el chequeo",
      intentResult: withSpuriousRef,
      history,
      isAffirmative: true,
    });
    expect(clearQuizOnResponse).toBe(false);
    expect(intentResult.intent).toBe("quiz_answer");
    expect(intentResult.quizIndex).toBe(0);
  });

  it("QUIZ:cleared marker ends the quiz session for later turns", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
      {
        role: "user",
        content: "omitir",
      },
      {
        role: "assistant",
        content: `De acuerdo.\n${buildQuizClearedMarker()}`,
      },
    ];
    expect(extractQuizFromHistory(history)).toBeNull();
    expect(extractSessionContext(history)?.type).not.toBe("quiz");
  });
});

describe("context quiz intent classification", () => {
  it("starts quiz on affirmative when offer marker idx=0", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Passage ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("sí", history);
    expect(r.intent).toBe("quiz_answer");
    expect(r.quizIndex).toBe(0);
    expect(r.quizTotal).toBe(4);
    expect(r.quizQuestions).toHaveLength(4);
  });

  it("classifies opt-out as quiz_skip", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Passage ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("saltar", history);
    expect(r.intent).toBe("quiz_skip");
    expect(r.quizIndex).toBe(0);
  });

  it("classifies compound Spanish refuse+note request as quiz_skip", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent(
      "No, prefiero omitir el cuestionario y revisar la nota sobre «fe».",
      history,
    );
    expect(r.intent).toBe("quiz_skip");
  });

  it("compound skip+article residual classifies as word_study", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Passage ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const msg =
      "No, omitir el cuestionario y muéstrame el artículo sobre siervo";
    const skip = classifyIntent(msg, history);
    expect(skip.intent).toBe("quiz_skip");
    expect(hasQuizFollowOnRequest(msg)).toBe(true);
    const residual = classifyIntent(stripQuizOptOutPhrases(msg));
    expect(residual.intent).toBe("word_study");
    expect(residual.term).toBe("siervo");
  });

  it("treats free-text as quiz_answer while quiz is in progress", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("Pablo el apóstol", history);
    expect(r.intent).toBe("quiz_answer");
    expect(r.quizIndex).toBe(1);
  });

  it("continues Path Q after Q1 even when the answer mentions check/accurate", () => {
    // Live failure: bare CHECKING_KEYWORDS ("check", "accurate") used to abort
    // the quiz after the first answer so Q2/Q3 never asked.
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/3** Who wrote this letter?\n${buildQuizMarker(1, SAMPLE_QUIZ.slice(0, 3))}`,
      },
    ];
    const answer =
      "Paul wrote to Titus so they would check that their faith is accurate.";
    const r = classifyIntent(answer, history);
    expect(r.intent).toBe("quiz_answer");
    expect(r.quizIndex).toBe(1);
    expect(r.quizTotal).toBe(3);

    const reinforced = reinforceQuizSession({
      message: answer,
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(reinforced.clearQuizOnResponse).toBe(false);
    expect(reinforced.intentResult.intent).toBe("quiz_answer");
    expect(reinforced.intentResult.quizIndex).toBe(1);
  });

  it("grades uncertainty (No sé) as quiz_answer, not quiz_skip", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("No sé", history);
    expect(r.intent).toBe("quiz_answer");
    expect(r.quizIndex).toBe(1);
  });

  it("does not force Path Q for long drafting questions while quiz is active", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent(
      "¿Cómo debo usar las notas de traducción (TN) mientras redacto la frase «conforme a la fe de los elegidos de Dios»?",
      history,
    );
    expect(r.intent).not.toBe("quiz_answer");
    expect(r.intent).not.toBe("quiz_skip");
  });

  it("after quiz_skip cleared marker, later questions are not quiz_answer", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**1/4** ¿Quién escribe?\n${buildQuizMarker(1, SAMPLE_QUIZ)}`,
      },
      {
        role: "user",
        content: "omitir",
      },
      {
        role: "assistant",
        content: `De acuerdo, omitimos el cuestionario.\n${buildQuizClearedMarker()}`,
      },
    ];
    const r = classifyIntent(
      "¿Cómo uso las notas al traducir «conforme a la fe»?",
      history,
    );
    expect(r.intent).not.toBe("quiz_answer");
    expect(r.intent).not.toBe("quiz_skip");
  });

  it("new Bible reference abandons the quiz", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `**2/4** question\n${buildQuizMarker(2, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("Help me with John 3:16", history);
    expect(r.intent).toBe("annotated_passage");
    expect(r.reference).toBe("JHN 3:16");
  });

  it("non-affirmative at offer idx=0 falls through (does not force quiz)", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Passage ready.\n${buildQuizMarker(0, SAMPLE_QUIZ)}`,
      },
    ];
    const r = classifyIntent("What is a metaphor?", history);
    expect(r.intent).not.toBe("quiz_answer");
    expect(r.intent).not.toBe("quiz_skip");
  });

  it("selectResources returns empty plan for quiz intents", () => {
    const answerPlan = selectResources(
      {
        intent: "quiz_answer",
        quizQuestions: SAMPLE_QUIZ,
        quizIndex: 1,
        quizTotal: 4,
        confidence: "high",
      },
      "es",
    );
    expect(answerPlan.initialFetches).toHaveLength(0);

    const skipPlan = selectResources(
      {
        intent: "quiz_skip",
        quizQuestions: SAMPLE_QUIZ,
        quizIndex: 0,
        quizTotal: 4,
        confidence: "high",
      },
      "es",
    );
    expect(skipPlan.initialFetches).toHaveLength(0);
  });
});

describe("sticky checking session", () => {
  it("extractCheckingFromHistory reads live marker and respects cleared", () => {
    const live: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Preguntas CANA…\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];
    expect(extractCheckingFromHistory(live)).toEqual({
      reference: "TIT 1:1-4",
    });

    const cleared: ConversationMessage[] = [
      ...live,
      { role: "user", content: "ok" },
      {
        role: "assistant",
        content: `Listo.\n${buildCheckingClearedMarker()}`,
      },
    ];
    expect(extractCheckingFromHistory(cleared)).toBeNull();
  });

  it("classifyIntent keeps validation replies on checking (not open_ended)", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Sobre rtc9, xrtm, fyf8…\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];
    const r = classifyIntent(
      "Traduje gracia como favor y siervo como servidor.",
      history,
    );
    expect(r.intent).toBe("checking");
    expect(r.reference).toBe("TIT 1:1-4");
    expect(r.confidence).toBe("high");
  });

  it("reinforceCheckingSession restores checking after annotated_passage steal", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Check questions.\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];
    const stolen: IntentResult = {
      intent: "annotated_passage",
      reference: "TIT 1:1-4",
      confidence: "high",
    };
    const { intentResult, clearCheckingOnResponse } = reinforceCheckingSession({
      message: "Sí, lo pensé bien.",
      intentResult: stolen,
      history,
    });
    expect(clearCheckingOnResponse).toBe(false);
    expect(intentResult.intent).toBe("checking");
    expect(isCheckingRoutingIntent(intentResult.intent)).toBe(true);
    expect(intentResult.reference).toBe("TIT 1:1-4");
  });

  it("reinforceCheckingSession clears on opt-out or topic change", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `…\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];
    expect(isCheckingOptOut("terminar la revisión")).toBe(true);
    const opt = reinforceCheckingSession({
      message: "terminar la revisión",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(opt.clearCheckingOnResponse).toBe(true);

    const topic = reinforceCheckingSession({
      message: "muéstrame la nota sobre fe",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(topic.clearCheckingOnResponse).toBe(true);
  });

  it("reinforceCheckingSession clears on Study/Translate mode intent", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: `Preguntas CANA…\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];

    const study = reinforceCheckingSession({
      message: "let's study first",
      intentResult: {
        intent: "checking",
        reference: "TIT 1:1-4",
        confidence: "high",
      },
      history,
    });
    expect(study.clearCheckingOnResponse).toBe(true);
    expect(study.intentResult.intent).toBe("open_ended");

    const translate = reinforceCheckingSession({
      message: "let's translate",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(translate.clearCheckingOnResponse).toBe(true);
    expect(translate.intentResult.intent).toBe("open_ended");

    const studyEs = reinforceCheckingSession({
      message: "quiero estudiar",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(studyEs.clearCheckingOnResponse).toBe(true);

    // classifyIntent must not sticky-trap Study/Translate phrases either.
    expect(classifyIntent("let's study first", history).intent).not.toBe(
      "checking",
    );
    expect(classifyIntent("let's translate", history).intent).not.toBe(
      "checking",
    );

    // Check-mode intent keeps sticky checking (does not clear).
    const stay = reinforceCheckingSession({
      message: "I want to check my draft",
      intentResult: { intent: "open_ended", confidence: "low" },
      history,
    });
    expect(stay.clearCheckingOnResponse).toBe(false);
    expect(stay.intentResult.intent).toBe("checking");
  });

  it("ensureCheckingSessionFooter appends or clears markers", () => {
    const withSession = ensureCheckingSessionFooter("Hola", "TIT 1:1-4");
    expect(withSession).toContain("<!-- CHECKING:TIT 1:1-4 -->");
    const cleared = ensureCheckingSessionFooter(withSession, "TIT 1:1-4", {
      cleared: true,
    });
    expect(cleared).toContain("<!-- CHECKING:cleared -->");
    expect(cleared).not.toMatch(/<!-- CHECKING:TIT/);
  });
});
