/**
 * Unit tests for the harness intent classifier and resource selector.
 */

import { describe, it, expect } from "vitest";
import { classifyIntent, extractReference } from "../../src/core/harness/intent.js";
import { selectResources } from "../../src/core/harness/resourceSelector.js";
import {
  buildWarmupMarker,
  buildPendingMarkers,
  buildLangMarker,
} from "../../src/core/harness/warmup.js";
import type { ConversationMessage } from "../../src/core/harness/intent.js";

// ---------------------------------------------------------------------------
// extractReference
// ---------------------------------------------------------------------------

describe("extractReference", () => {
  it("detects 'John 3:16'", () => {
    expect(extractReference("Explain John 3:16 for translation")).toBe("JHN 3:16");
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

  it("passage_help uses get_passage + get_note + get_passage_index, expands rc-links", () => {
    const plan = selectResources(
      { intent: "passage_help", reference: "JHN 3:16", confidence: "high" },
      lang,
    );
    const toolNames = plan.initialFetches.map((f) => f.tool);
    // Scripture text fetched via get_passage (all versions in one call)
    expect(toolNames).toContain("get_passage");
    expect(toolNames).toContain("get_note");
    expect(toolNames).toContain("get_passage_index");
    expect(plan.rcExpansion).toContain("tn_to_ta");
    expect(plan.rcExpansion).toContain("twl_to_tw");
  });

  it("annotated_passage uses get_passage + get_note + get_passage_index, no rc expansion", () => {
    const plan = selectResources(
      { intent: "annotated_passage", reference: "JHN 3:16", confidence: "high" },
      lang,
    );
    expect(plan.intent).toBe("annotated_passage");
    const toolNames = plan.initialFetches.map((f) => f.tool);
    expect(toolNames).toContain("get_passage");
    expect(toolNames).toContain("get_note");
    expect(toolNames).toContain("get_passage_index");
    // No rc expansion — TW/TA fetched on demand during phrase_drill
    expect(plan.rcExpansion).toHaveLength(0);
  });

  it("phrase_drill returns empty plan (resources fetched at runtime from history)", () => {
    const plan = selectResources(
      { intent: "phrase_drill", challengeIndex: 2, challengePhrase: "born again", confidence: "high" },
      lang,
    );
    expect(plan.intent).toBe("phrase_drill");
    expect(plan.initialFetches).toHaveLength(0);
  });

  it("word_study with term uses direct TW fetch", () => {
    const plan = selectResources(
      { intent: "word_study", term: "grace", confidence: "medium" },
      lang,
    );
    expect(plan.initialFetches[0]?.tool).toBe("get_word_article");
    expect((plan.initialFetches[0]?.params as Record<string, unknown>)["path"]).toBe("grace");
    expect(plan.rcExpansion).toHaveLength(0);
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
      { intent: "methodology", taTopic: "translate/figs-metaphor", confidence: "high" },
      lang,
    );
    expect(plan.initialFetches[0]?.tool).toBe("get_academy_article");
    expect((plan.initialFetches[0]?.params as Record<string, unknown>)["path"]).toBe("translate/figs-metaphor");
  });

  it("checking with reference fetches get_questions and get_passage", () => {
    const plan = selectResources(
      { intent: "checking", reference: "JHN 3:16", confidence: "medium" },
      lang,
    );
    const toolNames = plan.initialFetches.map((f) => f.tool);
    expect(toolNames).toContain("get_questions");
    expect(toolNames).toContain("get_passage");
  });

  it("discovery fetches resources list", () => {
    const plan = selectResources({ intent: "discovery", confidence: "high" }, lang);
    expect(plan.initialFetches[0]?.tool).toBe("list_resources_for_language");
  });

  it("open_ended returns empty plan (agentic loop)", () => {
    const plan = selectResources({ intent: "open_ended", confidence: "low" }, lang);
    expect(plan.initialFetches).toHaveLength(0);
    expect(plan.intent).toBe("open_ended");
  });
});

// ---------------------------------------------------------------------------
// Integration-style: word_study routes to TW, methodology routes to TA
// ---------------------------------------------------------------------------

describe("routing for word_study vs methodology", () => {
  it("word_study question produces a TW fetch plan, not TA", () => {
    const intent = classifyIntent("What does the word 'grace' mean in the Bible?");
    expect(intent.intent).toBe("word_study");
    const plan = selectResources(intent, "en");
    const tools = plan.initialFetches.map((f) => f.tool);
    // word_study with a term should fetch TW (get_word_article), not TA
    expect(tools.some((t) => t === "get_word_article" || plan.articleLocate?.resourceType === "tw")).toBe(true);
    expect(tools).not.toContain("get_academy_article");
  });

  it("methodology question produces a TA fetch plan, not TW", () => {
    const intent = classifyIntent("How do I handle a metaphor in my translation?");
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
