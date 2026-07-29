/**
 * Click-to-check on checklist items: CHECKITEM marker, click-message format,
 * intent routing, and per-item coach focus prompt (semantic-range probing).
 */
import { describe, it, expect } from "vitest";
import {
  buildCheckItemMarker,
  parseCheckItemFromMessage,
  formatCheckItemMessage,
  findChecklistLineInStudyContext,
  checkItemFocusInstructions,
  buildCheckItemFocus,
  resolveCheckItemResourceBody,
  pinFocusedCheckItem,
  parseFocusHintFromStudyContext,
  buildPanelFocusResourceHint,
  resolveValidatedCheckMarkers,
  findFocusedCheckItem,
  extractChecklistReference,
} from "../../src/core/checklist/checkingChecklist.js";
import {
  classifyIntent,
  buildCheckingSessionMarker,
} from "../../src/core/harness/intent.js";
import { buildQuizMarker } from "../../src/core/harness/QuizAgents.js";

// ---------------------------------------------------------------------------
// Marker build / parse
// ---------------------------------------------------------------------------

describe("buildCheckItemMarker / parseCheckItemFromMessage", () => {
  it("round-trips note / tw / tq markers", () => {
    expect(
      parseCheckItemFromMessage(buildCheckItemMarker("note", "abc1")),
    ).toEqual({
      kind: "note",
      resourceId: "abc1",
    });
    expect(
      parseCheckItemFromMessage(buildCheckItemMarker("tw", "bible/kt/grace")),
    ).toEqual({ kind: "tw", resourceId: "bible/kt/grace" });
    expect(parseCheckItemFromMessage(buildCheckItemMarker("tq", "q7"))).toEqual(
      {
        kind: "tq",
        resourceId: "q7",
      },
    );
  });

  it("parses the marker out of a full click message with visible text", () => {
    const msg = `Let's check: v.1 and knowledge of the truth\n<!-- CHECKITEM:note:xyz9 -->`;
    expect(parseCheckItemFromMessage(msg)).toEqual({
      kind: "note",
      resourceId: "xyz9",
    });
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(
      parseCheckItemFromMessage("<!--  checkitem:TW:bible/kt/faith  -->"),
    ).toEqual({
      kind: "tw",
      resourceId: "bible/kt/faith",
    });
  });

  it("returns null for plain text, empty input, and coach CHECK markers", () => {
    expect(parseCheckItemFromMessage("check my draft please")).toBeNull();
    expect(parseCheckItemFromMessage("")).toBeNull();
    expect(parseCheckItemFromMessage(null)).toBeNull();
    // Coach completion marker must NOT be read as a click.
    expect(parseCheckItemFromMessage("<!-- CHECK:note:abc1 -->")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Click message format (pending vs completed, EN vs ES)
// ---------------------------------------------------------------------------

describe("formatCheckItemMessage", () => {
  const base = {
    kind: "note" as const,
    resourceId: "xyz9",
    title: "and knowledge of the truth",
    verse: "1",
  };

  it("pending item (EN): 'Let's check:' + verse + title + hidden marker", () => {
    const msg = formatCheckItemMessage({ ...base, language: "en" });
    expect(msg).toContain("Let's check: v.1 and knowledge of the truth");
    expect(msg).toContain("<!-- CHECKITEM:note:xyz9 -->");
    expect(msg).not.toContain("revisit");
  });

  it("completed item (EN): 'Let's revisit:' phrasing, same hidden marker", () => {
    const msg = formatCheckItemMessage({
      ...base,
      language: "en",
      completed: true,
    });
    expect(msg).toContain("Let's revisit: v.1 and knowledge of the truth");
    expect(msg).toContain("<!-- CHECKITEM:note:xyz9 -->");
  });

  it("Spanish phrasing for pending and completed", () => {
    expect(formatCheckItemMessage({ ...base, language: "es-419" })).toContain(
      "Revisemos: v.1 and knowledge of the truth",
    );
    expect(
      formatCheckItemMessage({ ...base, language: "es", completed: true }),
    ).toContain("Volvamos a revisar: v.1 and knowledge of the truth");
  });

  it("omits the verse prefix when the item has no verse", () => {
    const msg = formatCheckItemMessage({
      kind: "tw",
      resourceId: "bible/kt/godly",
      title: "godliness",
      language: "en",
    });
    expect(msg).toContain("Let's check: godliness");
    expect(msg).not.toContain("v.");
    expect(msg).toContain("<!-- CHECKITEM:tw:bible/kt/godly -->");
  });
});

// ---------------------------------------------------------------------------
// Intent routing: CHECKITEM → checking
// ---------------------------------------------------------------------------

describe("classifyIntent with CHECKITEM marker", () => {
  const clickMsg = formatCheckItemMessage({
    kind: "note",
    resourceId: "xyz9",
    title: "and knowledge of the truth",
    verse: "1",
    language: "en",
  });

  it("routes a click message to checking with high confidence", () => {
    const result = classifyIntent(clickMsg);
    expect(result.intent).toBe("checking");
    expect(result.confidence).toBe("high");
  });

  it("binds the sticky checking-session reference when active", () => {
    const history = [
      {
        role: "assistant" as const,
        content: `ok\n${buildCheckingSessionMarker("TIT 1:1-4")}`,
      },
    ];
    const result = classifyIntent(clickMsg, history);
    expect(result.intent).toBe("checking");
    expect(result.reference).toBe("TIT 1:1-4");
  });

  it("wins over a live context quiz (explicit panel action)", () => {
    const history = [
      {
        role: "assistant" as const,
        content: `Question…\n${buildQuizMarker(1, [{ q: "Who wrote Titus?", a: "Paul" }])}`,
      },
    ];
    const result = classifyIntent(clickMsg, history);
    expect(result.intent).toBe("checking");
  });

  it("Spanish click message routes the same way", () => {
    const esMsg = formatCheckItemMessage({
      kind: "tq",
      resourceId: "q7",
      title: "¿Por qué dejó Pablo a Tito en Creta?",
      language: "es-419",
    });
    expect(classifyIntent(esMsg).intent).toBe("checking");
  });
});

// ---------------------------------------------------------------------------
// STUDY CONTEXT lookup + per-item focus prompt
// ---------------------------------------------------------------------------

const STUDY_CONTEXT = [
  "Checking checklist for TIT 1:1-4: 1/3 complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).",
  "[ ] note:xyz9 v.1 — and knowledge of the truth",
  "[x] tw:bible/kt/godly v.1 — godliness",
  "[ ] tq:q7 — Why did Paul leave Titus in Crete?",
].join("\n");

describe("findChecklistLineInStudyContext", () => {
  it("finds an unchecked note with title and verse", () => {
    expect(
      findChecklistLineInStudyContext(STUDY_CONTEXT, "note", "xyz9"),
    ).toEqual({
      completed: false,
      verse: "1",
      title: "and knowledge of the truth",
    });
  });

  it("finds a completed tw item (path with slashes)", () => {
    const line = findChecklistLineInStudyContext(
      STUDY_CONTEXT,
      "tw",
      "bible/kt/godly",
    );
    expect(line?.completed).toBe(true);
    expect(line?.title).toBe("godliness");
  });

  it("returns null when missing or context empty", () => {
    expect(
      findChecklistLineInStudyContext(STUDY_CONTEXT, "note", "nope"),
    ).toBeNull();
    expect(
      findChecklistLineInStudyContext(undefined, "note", "xyz9"),
    ).toBeNull();
  });
});

describe("checkItemFocusInstructions (semantic-range pedagogy)", () => {
  const focus = checkItemFocusInstructions({
    kind: "note",
    resourceId: "xyz9",
    title: "and knowledge of the truth",
    verse: "1",
  });

  it("scopes the coach to ONLY the clicked item", () => {
    expect(focus).toContain("check ONLY this item");
    expect(focus).toContain("OVERRIDES the general checklist walk");
    expect(focus).toContain("`note:xyz9`");
  });

  it("contains meaning-based probing (never reading target text)", () => {
    expect(focus).toContain(
      "What does the word you chose for 'and knowledge of the truth' mean in your language?",
    );
    expect(focus).toContain(
      "NEVER ask to see, read, or grade their target-language text",
    );
  });

  it("bans 'How did you translate X?' and requires meaning-not-translation answers", () => {
    expect(focus).toContain('NEVER ask "How did you translate X?"');
    expect(focus).toContain("never by quoting their translation");
    // The banned phrasing must not appear as an example probe to ask.
    expect(focus).not.toMatch(/Ask how they translated/i);
    expect(focus).not.toContain('"How did you translate this?');
  });

  it("enforces exactly ONE question per turn with a cross-turn sequence", () => {
    expect(focus).toContain("exactly ONE question per turn");
    expect(focus).toContain("Never stack two or three questions");
    expect(focus).toContain("ACROSS turns");
    // Sequence steps: meaning → other senses → audience risk → alternative word
    expect(focus).toMatch(
      /meaning of the word they chose.*other senses.*readers could misunderstand.*closer word/s,
    );
    // Old softer pacing must be gone.
    expect(focus).not.toContain("1–2 questions per turn");
  });

  it("uses a generic phrase label when the item has no title", () => {
    const untitled = checkItemFocusInstructions({
      kind: "note",
      resourceId: "n1",
    });
    expect(untitled).toContain(
      "What does the word you chose for 'this phrase' mean in your language?",
    );
  });

  it("contains semantic-range probing with the hit/kill example", () => {
    expect(focus).toContain("SEMANTIC RANGE");
    expect(focus).toContain("other meanings");
    expect(focus).toMatch(/killing instead of hitting/i);
  });

  it("suggests a closer-to-source word as a question, not a mandate", () => {
    expect(focus).toContain("as a QUESTION or option, never a mandate");
    expect(focus).toContain("closer to the source meaning");
    expect(focus).toContain("means only X, without also meaning Y");
  });

  it("keeps completion mechanics (CHECK marker on validation)", () => {
    expect(focus).toContain("<!-- CHECK:note:xyz9 -->");
  });

  it("grounds probes in the item's own resource content by kind", () => {
    expect(focus).toContain("this note's body");
    expect(focus).toMatch(/never invent content|generic linguistics lecture/i);
    expect(
      checkItemFocusInstructions({ kind: "tw", resourceId: "bible/kt/godly" }),
    ).toContain("TW article");
    expect(
      checkItemFocusInstructions({ kind: "tq", resourceId: "q7" }),
    ).toContain("expected answer");
  });

  it("injects the focused note body into the focus block when provided", () => {
    const withBody = checkItemFocusInstructions({
      kind: "note",
      resourceId: "xyz9",
      title: "and knowledge of the truth",
      verse: "1",
      resourceBody:
        "If your language does not use an abstract noun for truth, you can express this idea with a verb.",
      resourceQuote: "knowledge of the truth",
    });
    expect(withBody).toContain("Focused resource body (authoritative");
    expect(withBody).toContain(
      "If your language does not use an abstract noun for truth",
    );
    expect(withBody).toContain('Quoted phrase: "knowledge of the truth"');
    expect(withBody).toMatch(/do not invent beyond it/i);
  });

  it("warns when focused resource body is missing", () => {
    const missing = checkItemFocusInstructions({
      kind: "note",
      resourceId: "xyz9",
    });
    expect(missing).toContain("Not available in this turn's fetched context");
    expect(missing).toMatch(/do NOT invent note\/article content/i);
  });

  it("acknowledges already-validated items and offers a revisit", () => {
    const done = checkItemFocusInstructions({
      kind: "tw",
      resourceId: "bible/kt/godly",
      title: "godliness",
      alreadyValidated: true,
    });
    expect(done).toContain("ALREADY validated");
    expect(done).toContain("ask if they want to revisit");
    expect(done).toContain("not treat this as a new completion");
  });

  it("revisit block overrides the probe sequence: acknowledge + ONE question, no re-interrogation", () => {
    const done = checkItemFocusInstructions({
      kind: "tw",
      resourceId: "bible/kt/godly",
      title: "godliness",
      alreadyValidated: true,
    });
    // Acknowledge prior validation by item title, not a generic label.
    expect(done).toContain("already worked through");
    expect(done).toContain('"godliness"');
    // Dominates the fresh-check probe sequence instead of restarting it.
    expect(done).toContain("OVERRIDES the probe sequence");
    expect(done).toContain("do NOT re-interrogate from scratch");
    expect(done).toMatch(/exactly ONE question, then stop/);
    // No new completion marker unless re-validated.
    expect(done).toContain("never emit a new CHECK marker unless");
  });

  it("pending items carry no revisit block", () => {
    const pending = checkItemFocusInstructions({
      kind: "note",
      resourceId: "xyz9",
      title: "and knowledge of the truth",
    });
    expect(pending).not.toContain("REVISIT");
    expect(pending).not.toContain("already worked through");
  });

  it("hard rule tells the model to stop after the first question mark", () => {
    expect(focus).toContain(
      "Stop writing immediately after your first question mark",
    );
  });
});

describe("buildCheckItemFocus", () => {
  it("builds a pending-item focus from message + study context", () => {
    const msg = formatCheckItemMessage({
      kind: "note",
      resourceId: "xyz9",
      title: "and knowledge of the truth",
      verse: "1",
      language: "en",
    });
    const focus = buildCheckItemFocus(msg, STUDY_CONTEXT);
    expect(focus).toContain("`note:xyz9`");
    expect(focus).toContain('"and knowledge of the truth"');
    expect(focus).not.toContain("ALREADY validated");
  });

  it("includes matching note body from the bundle source", () => {
    const msg = formatCheckItemMessage({
      kind: "note",
      resourceId: "xyz9",
      title: "and knowledge of the truth",
      verse: "1",
      language: "en",
    });
    const focus = buildCheckItemFocus(msg, STUDY_CONTEXT, {
      notes: [
        {
          id: "xyz9",
          text: "Express the abstract noun 'truth' with a verbal phrase if needed.",
          quote: "truth",
        },
      ],
    });
    expect(focus).toContain(
      "Express the abstract noun 'truth' with a verbal phrase if needed.",
    );
    expect(focus).toContain('Quoted phrase: "truth"');
  });

  it("builds a revisit focus for a completed item", () => {
    const msg = formatCheckItemMessage({
      kind: "tw",
      resourceId: "bible/kt/godly",
      title: "godliness",
      language: "en",
      completed: true,
    });
    const focus = buildCheckItemFocus(msg, STUDY_CONTEXT);
    expect(focus).toContain("ALREADY validated");
    expect(focus).toContain("`tw:bible/kt/godly`");
  });

  it("returns empty string for non-click messages", () => {
    expect(
      buildCheckItemFocus("How do I translate godliness?", STUDY_CONTEXT),
    ).toBe("");
  });
});

describe("resolveCheckItemResourceBody / pinFocusedCheckItem", () => {
  const source = {
    notes: [
      { id: "a", text: "first note" },
      { id: "xyz9", text: "focused note body", quote: "truth" },
      { id: "b", text: "other" },
    ],
    tw: [
      { path: "bible/kt/faith", article: "faith article" },
      { path: "bible/kt/godly", article: "godliness article text" },
    ],
    tq: [
      { id: "q1", question: "Who wrote?", response: "Paul" },
      { id: "q7", question: "What is truth?", response: "God's word" },
    ],
  };

  it("resolves note / tw / tq bodies", () => {
    expect(resolveCheckItemResourceBody("note", "xyz9", source)).toEqual({
      body: "focused note body",
      quote: "truth",
    });
    expect(
      resolveCheckItemResourceBody("tw", "bible/kt/godly", source)?.body,
    ).toContain("godliness article");
    expect(resolveCheckItemResourceBody("tq", "q7", source)?.body).toContain(
      "Expected answer: God's word",
    );
    expect(resolveCheckItemResourceBody("note", "missing", source)).toBeNull();
  });

  it("pins the focused item to the front so budget caps keep it", () => {
    const pinned = pinFocusedCheckItem(source, "note", "xyz9");
    expect(pinned.notes![0].id).toBe("xyz9");
    expect(pinned.notes!.map((n) => n.id)).toEqual(["xyz9", "a", "b"]);

    const pinnedTw = pinFocusedCheckItem(source, "tw", "bible/kt/godly");
    expect(pinnedTw.tw![0].path).toBe("bible/kt/godly");
  });

  it("parses PANEL STATE focusHint and builds a soft body hint", () => {
    const study = `PANEL STATE:\nopen: true\nfocusHint: note:xyz9 "and knowledge of the truth"\n`;
    expect(parseFocusHintFromStudyContext(study)).toEqual({
      kind: "note",
      id: "xyz9",
      title: "and knowledge of the truth",
    });
    const hint = buildPanelFocusResourceHint(study, source);
    expect(hint).toContain("Panel focusHint — loaded resource body");
    expect(hint).toContain("focused note body");
    expect(hint).toMatch(/do not invent translation principles/i);
  });
});

// ---------------------------------------------------------------------------
// Click turns never auto-complete items (session-start semantics)
// ---------------------------------------------------------------------------

describe("click turn completion semantics", () => {
  it("session-start turns (item click) emit no validated CHECK markers", () => {
    const msg = formatCheckItemMessage({
      kind: "note",
      resourceId: "xyz9",
      title: "and knowledge of the truth",
      verse: "1",
      language: "en",
    });
    // skillChat passes isSessionStart=true for CHECKITEM turns.
    const validated = resolveValidatedCheckMarkers({
      userMessage: msg,
      priorAssistantContent: "How did you translate note:xyz9?",
      studyContext: STUDY_CONTEXT,
      isSessionStart: true,
    });
    expect(validated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scoped ticking (over-eager guard): focused item only + TW-in-user-answer
// ---------------------------------------------------------------------------

// All three items unchecked so cross-ticking would be visible.
const OPEN_CONTEXT = [
  "Checking checklist for TIT 1:1-4: 0/3 complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).",
  "[ ] note:xyz9 v.1 — and knowledge of the truth",
  "[ ] tw:bible/kt/godly v.1 — godliness",
  "[ ] tw:bible/other/know v.1 — know, knowledge",
].join("\n");

describe("resolveValidatedCheckMarkers — CHECKITEM scope", () => {
  const focusedNote = { kind: "note" as const, resourceId: "xyz9" };

  it("in item scope, only the focused item ticks even when related TW terms were discussed", () => {
    const validated = resolveValidatedCheckMarkers({
      userMessage:
        "It means knowing the truth about God — knowledge that leads to godliness in how we live.",
      priorAssistantContent:
        "What does the word you chose for 'and knowledge of the truth' (note:xyz9) mean? Think about 'godliness' and 'know, knowledge' too.",
      studyContext: OPEN_CONTEXT,
      focusedItem: focusedNote,
    });
    expect(validated.map((v) => `${v.kind}:${v.resourceId}`)).toEqual([
      "note:xyz9",
    ]);
  });

  it("in item scope, unrelated exchanges tick nothing", () => {
    const validated = resolveValidatedCheckMarkers({
      userMessage: "My word means godliness, living the way God wants.",
      priorAssistantContent: "What does your word for 'godliness' mean?",
      studyContext: OPEN_CONTEXT,
      focusedItem: focusedNote, // scope is the note, not the TW term
    });
    expect(validated).toEqual([]);
  });

  it("once the focused item is [x], the scope is resolved and general rules apply", () => {
    const contextAfter = OPEN_CONTEXT.replace("[ ] note:xyz9", "[x] note:xyz9");
    const validated = resolveValidatedCheckMarkers({
      userMessage:
        "My word for godliness means honoring God with how you live.",
      priorAssistantContent: "What does your word for 'godliness' mean?",
      studyContext: contextAfter,
      focusedItem: focusedNote,
    });
    expect(validated.map((v) => `${v.kind}:${v.resourceId}`)).toEqual([
      "tw:bible/kt/godly",
    ]);
  });
});

describe("resolveValidatedCheckMarkers — TW requires term in USER answer", () => {
  it("does not tick a TW item when only the coach's probe names the term", () => {
    const validated = resolveValidatedCheckMarkers({
      userMessage: "Yes, I thought that through carefully.",
      priorAssistantContent:
        "Does your word for 'godliness' carry other senses? What about 'know, knowledge'?",
      studyContext: OPEN_CONTEXT,
    });
    expect(validated).toEqual([]);
  });

  it("ticks the TW item when the user's own answer names the term", () => {
    const validated = resolveValidatedCheckMarkers({
      userMessage:
        "My word for godliness means devotion to God, and it has no other senses.",
      priorAssistantContent: "Tell me about the key term in v.1.",
      studyContext: OPEN_CONTEXT,
    });
    expect(validated.map((v) => `${v.kind}:${v.resourceId}`)).toEqual([
      "tw:bible/kt/godly",
    ]);
  });

  it("note items still match against probe + answer combined", () => {
    const validated = resolveValidatedCheckMarkers({
      userMessage: "It means real understanding of what is true about God.",
      priorAssistantContent:
        "Let's look at note:xyz9 — what does your phrase for 'and knowledge of the truth' mean?",
      studyContext: OPEN_CONTEXT,
    });
    expect(validated.map((v) => `${v.kind}:${v.resourceId}`)).toEqual([
      "note:xyz9",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Focused-item resolution from history + checklist reference extraction
// ---------------------------------------------------------------------------

describe("findFocusedCheckItem", () => {
  const click = formatCheckItemMessage({
    kind: "note",
    resourceId: "xyz9",
    title: "and knowledge of the truth",
    verse: "1",
    language: "en",
  });

  it("returns the item from the current click message", () => {
    expect(findFocusedCheckItem(click, [])).toEqual({
      kind: "note",
      resourceId: "xyz9",
    });
  });

  it("keeps the scope across follow-up answers after a click", () => {
    const history = [
      { role: "user", content: click },
      { role: "assistant", content: "What does your word mean?" },
    ];
    expect(findFocusedCheckItem("It means knowing deeply.", history)).toEqual({
      kind: "note",
      resourceId: "xyz9",
    });
  });

  it("a later general session start ends the item scope", () => {
    const history = [
      { role: "user", content: click },
      { role: "assistant", content: "What does your word mean?" },
      { role: "user", content: "Pedir revisión" },
      { role: "assistant", content: "Let's review the passage." },
    ];
    const focused = findFocusedCheckItem("ok", history, (t) =>
      /pedir revisión/i.test(t),
    );
    expect(focused).toBeNull();
  });

  it("returns null when no click exists in history", () => {
    expect(
      findFocusedCheckItem("plain answer", [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ]),
    ).toBeNull();
  });
});

describe("extractChecklistReference", () => {
  it("parses the passage from the checklist header", () => {
    expect(extractChecklistReference(STUDY_CONTEXT)).toBe("TIT 1:1-4");
  });

  it("returns null for missing/foreign context", () => {
    expect(extractChecklistReference(undefined)).toBeNull();
    expect(extractChecklistReference("Some other study context")).toBeNull();
  });
});
