/**
 * Progressive-disclosure tests — passage range detection, continuation
 * handling, and batch footer logic.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntent,
  extractReferenceInfo,
  firstBatchRef,
  nextBatchRef,
  isContinuationMessage,
  extractNextBatchFromHistory,
  extractSessionContext,
  extractChallengesFromHistory,
  BATCH_SIZE,
  type ConversationMessage,
} from "../../src/core/harness/intent.js";
import { selectResources } from "../../src/core/harness/resourceSelector.js";

// ---------------------------------------------------------------------------
// extractReferenceInfo — range detection
// ---------------------------------------------------------------------------

describe("extractReferenceInfo — large range detection", () => {
  it("whole chapter is flagged as large range", () => {
    const result = extractReferenceInfo("Help me translate John 3");
    expect(result).not.toBeNull();
    expect(result!.ref).toBe("JHN 3");
    expect(result!.isLargeRange).toBe(true);
  });

  it("wide verse range (>= 5 verses) is flagged as large range", () => {
    const result = extractReferenceInfo("John 2:1-10");
    expect(result).not.toBeNull();
    expect(result!.isLargeRange).toBe(true);
  });

  it("small verse range (< 5 verses) is NOT flagged as large range", () => {
    const result = extractReferenceInfo("John 3:16-18");
    expect(result).not.toBeNull();
    expect(result!.isLargeRange).toBe(false);
  });

  it("single verse is NOT flagged as large range", () => {
    const result = extractReferenceInfo("What does John 3:16 mean");
    expect(result).not.toBeNull();
    expect(result!.ref).toBe("JHN 3:16");
    expect(result!.isLargeRange).toBe(false);
  });

  it("exactly 5-verse range is flagged as large range (boundary)", () => {
    const result = extractReferenceInfo("Romans 1:1-5");
    expect(result).not.toBeNull();
    expect(result!.isLargeRange).toBe(true);
  });

  it("4-verse range is NOT flagged as large range (boundary)", () => {
    const result = extractReferenceInfo("Romans 1:1-4");
    expect(result).not.toBeNull();
    expect(result!.isLargeRange).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyIntent — passage_overview vs passage_help
// ---------------------------------------------------------------------------

describe("classifyIntent — passage_overview vs passage_help", () => {
  it("whole chapter → passage_overview", () => {
    const r = classifyIntent("Help me translate John 3");
    expect(r.intent).toBe("passage_overview");
    expect(r.reference).toBe("JHN 3");
    expect(r.isLargeRange).toBe(true);
  });

  it("wide verse range → passage_overview", () => {
    const r = classifyIntent("John 2:1-20");
    expect(r.intent).toBe("passage_overview");
  });

  it("small verse range (< LARGE_RANGE_THRESHOLD) → annotated_passage", () => {
    const r = classifyIntent("John 3:14-17");
    // 4 verses (14-17) is under threshold → annotated_passage
    expect(r.intent).toBe("annotated_passage");
    expect(r.reference).toBe("JHN 3:14-17");
  });

  it("single verse → annotated_passage", () => {
    const r = classifyIntent("Explain John 3:16");
    expect(r.intent).toBe("annotated_passage");
  });
});

// ---------------------------------------------------------------------------
// firstBatchRef / nextBatchRef / BATCH_SIZE
// ---------------------------------------------------------------------------

describe("batch reference helpers", () => {
  it("firstBatchRef for a chapter reference returns v.1–BATCH_SIZE", () => {
    const first = firstBatchRef("JHN 3");
    expect(first).toBe(`JHN 3:1-${BATCH_SIZE}`);
  });

  it("firstBatchRef is idempotent when called on a verse reference", () => {
    const ref = "JHN 3:5-8";
    expect(firstBatchRef(ref)).toBe(ref);
  });

  it("nextBatchRef advances by BATCH_SIZE", () => {
    const next = nextBatchRef("JHN 3:1-4");
    expect(next).toBe("JHN 3:5-8");
  });

  it("nextBatchRef handles single-verse (no verseEnd)", () => {
    // For a single verse reference, no footer should be appended
    // nextBatchRef still works: treats it as start=end
    const next = nextBatchRef("JHN 3:16");
    expect(next).toBe("JHN 3:17-20");
  });

  it("nextBatchRef returns null when reference has no verse", () => {
    const next = nextBatchRef("JHN 3");
    expect(next).toBeNull();
  });

  it("chained batches cover the chapter sequentially", () => {
    let ref: string | null = firstBatchRef("JHN 3");
    const batches: string[] = [ref];
    for (let i = 0; i < 3; i++) {
      ref = nextBatchRef(ref!);
      if (ref) batches.push(ref);
    }
    expect(batches).toEqual([
      `JHN 3:1-4`,
      `JHN 3:5-8`,
      `JHN 3:9-12`,
      `JHN 3:13-16`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Continuation detection
// ---------------------------------------------------------------------------

describe("isContinuationMessage", () => {
  const continuationPhrases = [
    "next",
    "Next",
    "NEXT",
    "continue",
    "go on",
    "keep going",
    "yes",
    "ok",
    "proceed",
    "more",
  ];

  for (const phrase of continuationPhrases) {
    it(`"${phrase}" is recognised as continuation`, () => {
      expect(isContinuationMessage(phrase)).toBe(true);
    });
  }

  const nonContinuation = [
    "what does John 3:16 mean",
    "translate Romans 1",
    "explain metaphor",
    "yes, but what about verse 5",
  ];

  for (const phrase of nonContinuation) {
    it(`"${phrase}" is NOT a continuation`, () => {
      expect(isContinuationMessage(phrase)).toBe(false);
    });
  }
});

describe("extractNextBatchFromHistory", () => {
  it("extracts next batch from harness footer in assistant message", () => {
    const history: ConversationMessage[] = [
      { role: "user", content: "Help me translate John 3" },
      {
        role: "assistant",
        content:
          "Here is the chapter overview...\n\n---\n*Say \"next\" for JHN 3:1-4 to begin verse-by-verse.*",
      },
    ];
    const next = extractNextBatchFromHistory(history);
    expect(next).toBe("JHN 3:1-4");
  });

  it("extracts batch footer from within-batch assistant message", () => {
    const history: ConversationMessage[] = [
      { role: "user", content: "next" },
      {
        role: "assistant",
        content:
          "Detailed notes for JHN 3:1-4...\n\n---\n*Batch: JHN 3:1-4 | Say \"next\" for JHN 3:5-8*",
      },
    ];
    const next = extractNextBatchFromHistory(history);
    expect(next).toBe("JHN 3:5-8");
  });

  it("returns null when no batch footer is present", () => {
    const history: ConversationMessage[] = [
      { role: "user", content: "What is grace?" },
      { role: "assistant", content: "Grace means..." },
    ];
    const next = extractNextBatchFromHistory(history);
    expect(next).toBeNull();
  });

  it("uses the most recent footer when multiple are present", () => {
    const history: ConversationMessage[] = [
      {
        role: "assistant",
        content: 'older response *Say "next" for JHN 3:1-4 to begin verse-by-verse.*',
      },
      {
        role: "assistant",
        content: 'newer response *Batch: JHN 3:1-4 | Say "next" for JHN 3:5-8*',
      },
    ];
    const next = extractNextBatchFromHistory(history);
    // Should return the most recent (last assistant message first in reverse scan)
    expect(next).toBe("JHN 3:5-8");
  });
});

// ---------------------------------------------------------------------------
// classifyIntent with history — continuation routing
// ---------------------------------------------------------------------------

describe("classifyIntent with history — continuation", () => {
  const historyWithFooter: ConversationMessage[] = [
    { role: "user", content: "Help me translate John 3" },
    {
      role: "assistant",
      content:
        "Overview of John 3...\n\n---\n*Say \"next\" for JHN 3:1-4 to begin verse-by-verse.*",
    },
  ];

  it("'next' with history → passage_help with continuationRef", () => {
    const r = classifyIntent("next", historyWithFooter);
    expect(r.intent).toBe("passage_help");
    expect(r.continuationRef).toBe("JHN 3:1-4");
    expect(r.reference).toBe("JHN 3:1-4");
    expect(r.confidence).toBe("high");
  });

  it("'continue' with history → passage_help with continuationRef", () => {
    const r = classifyIntent("continue", historyWithFooter);
    expect(r.intent).toBe("passage_help");
    expect(r.continuationRef).toBe("JHN 3:1-4");
  });

  it("'next' WITHOUT history stays open_ended (no context)", () => {
    const r = classifyIntent("next");
    // Without history, there's no passage context — no reference extracted,
    // no continuation possible. Falls through to open_ended.
    expect(r.intent).not.toBe("passage_help");
    expect(r.continuationRef).toBeUndefined();
  });

  it("continuation after a batch footer advances correctly", () => {
    const batchHistory: ConversationMessage[] = [
      { role: "user", content: "next" },
      {
        role: "assistant",
        content:
          "Notes for JHN 3:1-4...\n\n---\n*Batch: JHN 3:1-4 | Say \"next\" for JHN 3:5-8*",
      },
    ];
    const r = classifyIntent("next", batchHistory);
    expect(r.intent).toBe("passage_help");
    expect(r.reference).toBe("JHN 3:5-8");
  });
});

// ---------------------------------------------------------------------------
// Resource plans for passage_overview
// ---------------------------------------------------------------------------

describe("selectResources — passage_overview", () => {
  it("passage_overview plan fetches get_passage_context + get_note + get_passage_index with full rc expansion", () => {
    const intentResult = {
      intent: "passage_overview" as const,
      reference: "JHN 3",
      isLargeRange: true,
      confidence: "high" as const,
    };
    const plan = selectResources(intentResult, "en");
    expect(plan.intent).toBe("passage_overview");
    // Scripture text fetched via get_passage (all versions in one cheap call)
    const tools = plan.initialFetches.map((f) => f.tool);
    expect(tools).toContain("get_passage");
    expect(tools).toContain("get_note");
    expect(tools).toContain("get_passage_index");
    // Full rc-link expansion (no budget caps on this path)
    expect(plan.rcExpansion).toContain("tn_to_ta");
    expect(plan.rcExpansion).toContain("twl_to_tw");
  });

  it("passage_overview with no reference returns an empty plan (no fetches)", () => {
    const plan = selectResources(
      { intent: "passage_overview", confidence: "high" },
      "en",
    );
    // Falls through to open_ended plan (no scripture to discover without a reference)
    expect(plan.initialFetches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Checklist session continuation
// ---------------------------------------------------------------------------

describe("extractSessionContext — checklist vs batch discrimination", () => {
  const checklistHistory: ConversationMessage[] = [
    { role: "user", content: "Help me translate John 3" },
    {
      role: "assistant",
      content:
        "John 3 overview...\n☐ 1. Passage structure\n☐ 2. Born again\n☐ 3. Key terms\n\n---\n*[Step 1/3] — Say **\"next\"** when ready to continue.*",
    },
  ];

  it("detects a checklist session from [Step N/M] footer", () => {
    const ctx = extractSessionContext(checklistHistory);
    expect(ctx).not.toBeNull();
    expect(ctx!.type).toBe("checklist");
    if (ctx?.type === "checklist") {
      expect(ctx.currentStep).toBe(1);
      expect(ctx.totalSteps).toBe(3);
    }
  });

  it("classifyIntent returns checklist_step for 'next' in a checklist session", () => {
    const r = classifyIntent("next", checklistHistory);
    expect(r.intent).toBe("checklist_step");
    expect(r.nextStep).toBe(2);
    expect(r.totalSteps).toBe(3);
  });

  it("classifyIntent returns checklist_step for 'ok' in a checklist session", () => {
    const r = classifyIntent("ok", checklistHistory);
    expect(r.intent).toBe("checklist_step");
  });

  it("batch footer is NOT classified as checklist", () => {
    const batchHistory: ConversationMessage[] = [
      {
        role: "assistant",
        content: "Notes...\n\n---\n*Batch: JHN 3:1-4 | Say \"next\" for JHN 3:5-8*",
      },
    ];
    const ctx = extractSessionContext(batchHistory);
    expect(ctx?.type).toBe("batch");
  });

  it("checklist_step selectResources returns empty plan (no fetches)", () => {
    const plan = selectResources(
      { intent: "checklist_step", nextStep: 2, totalSteps: 5, confidence: "high" },
      "en",
    );
    expect(plan.intent).toBe("checklist_step");
    expect(plan.initialFetches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phrase-drill detection
// ---------------------------------------------------------------------------

const annotatedHistory: ConversationMessage[] = [
  { role: "user", content: "Help me translate John 3:16" },
  {
    role: "assistant",
    content:
      "**JHN 3:16**\n\nFor **God** so loved the **world**...\n\n" +
      "2 challenges found:\n" +
      "**1.** 📚 Key term — **God** (v.16) — *Theological term for the Creator*\n" +
      "**2.** 📚 Key term — **eternal life** (v.16) — *Life that continues forever*\n" +
      '<!-- CHALLENGES:2 [{"index":1,"verse":"16","phrase":"God","noteText":"Theological term","category":"key-term","wordPath":"bible/kt/god"},{"index":2,"verse":"16","phrase":"eternal life","noteText":"Life that continues forever","category":"key-term","wordPath":"bible/kt/eternallife"}] -->',
  },
];

describe("phrase_drill detection", () => {
  it("extractChallengesFromHistory parses CHALLENGES comment", () => {
    const challenges = extractChallengesFromHistory(annotatedHistory);
    expect(challenges).not.toBeNull();
    expect(challenges).toHaveLength(2);
    expect(challenges![0].phrase).toBe("God");
    expect(challenges![1].index).toBe(2);
  });

  it("classifyIntent returns phrase_drill for numeric input in annotated session", () => {
    const r = classifyIntent("2", annotatedHistory);
    expect(r.intent).toBe("phrase_drill");
    expect(r.challengeIndex).toBe(2);
    expect(r.challengePhrase).toBe("eternal life");
  });

  it("classifyIntent returns phrase_drill for phrase match in annotated session", () => {
    const r = classifyIntent("eternal life", annotatedHistory);
    expect(r.intent).toBe("phrase_drill");
    expect(r.challengeIndex).toBe(2);
  });

  it("phrase_drill detection takes priority over passage reference", () => {
    // Even if the phrase looks like a reference, drill takes priority when challenges exist
    const r = classifyIntent("1", annotatedHistory);
    expect(r.intent).toBe("phrase_drill");
    expect(r.challengeIndex).toBe(1);
  });

  it("out-of-range number without match falls through to normal classification", () => {
    const r = classifyIntent("99", annotatedHistory);
    // 99 doesn't match any challenge, falls through
    expect(r.intent).not.toBe("phrase_drill");
  });
});
