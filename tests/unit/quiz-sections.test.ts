/**
 * Unit tests for section-aware context quiz generation:
 *   - parseNoteSections on realistic Door43 TN intro notes (book + chapter shapes)
 *   - collectNoteSections across bundle notes (dedupe + cap)
 *   - generateQuiz section mode: ≥1 question per section, retry, deterministic backfill
 *   - cap behavior (MAX_QUIZ_QUESTIONS preserves per-section coverage)
 *   - legacy fallback for unstructured (verse-scoped) notes
 */

import { describe, it, expect } from "vitest";
import {
  MAX_QUIZ_QUESTIONS,
  buildSectionBackfillQuestion,
  collectNoteSections,
  generateQuiz,
  parseNoteSections,
} from "../../src/core/harness/QuizAgents.js";
import type { EnrichedBundle } from "../../src/core/harness/budgeter.js";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";

// ---------------------------------------------------------------------------
// Fixtures — shaped like real Door43 TN intro notes (TIT front:intro / 1:intro)
// ---------------------------------------------------------------------------

const BOOK_INTRO = `# Introduction to Titus

## Part 1: General Introduction

### Outline of Titus

1. Paul instructs Titus to appoint godly leaders. ([1:1–16](../01/01.md))
2. Paul instructs Titus to train people to live godly lives. ([2:1–3:11](../02/01.md))
3. Paul ends by sharing some of his plans and sending greetings to various believers. ([3:12–15](../03/12.md))

### Who wrote the book of Titus?

Paul wrote the book of Titus. Paul was from the city of Tarsus. He had been known as Saul in his early life. Before becoming a believer, Paul was a Pharisee. He persecuted believers.

### What is the book of Titus about?

Paul wrote this letter to Titus, his fellow worker, who was leading the churches on the island of Crete. Paul instructed him about selecting church leaders.

### How should the title of this book be translated?

Translators may choose to call this book by its traditional title, “Titus.” Or they may choose a clearer title, such as “Paul’s Letter to Titus.” (See: [[rc://*/ta/man/translate/translate-names]])

## Part 2: Important Religious and Cultural Concepts

### In what roles can people serve within the church?

There are some teachings in the book of Titus about whether a woman or divorced man can serve in positions of leadership within the church. Scholars disagree about the meaning of these teachings.

## Part 3: Important Translation Issues

### Singular and plural **you**

In this book, the word **I** refers to Paul. Also, the word **you** is almost always singular and refers to Titus. The exception to this is [3:15](../03/15.md). (See [[rc://*/ta/man/translate/figs-yousingular]])

### What is the meaning of **God our Savior**?

This is a common phrase in this letter. Paul meant to make the readers think about how God forgave them in Christ for sinning against him.
`;

const CHAPTER_INTRO = `# Titus 1 Chapter Introduction

## Structure and Formatting

Paul formally introduces this letter in [verses 1–4](../01/01.md). Writers often began letters in this way in the ancient Near East.

In [verses 6–9](../01/06.md), Paul lists several qualities that a man must have if he is to be an elder in the church. (See: [[rc://*/ta/man/translate/figs-abstractnouns]])

## Religious and Cultural Concepts in This Chapter

### Elders

The church has used different titles for church leaders. Some titles include overseer, elder, pastor, and bishop.

## Translation Issues in This Chapter

### Should, may, must

The ULT uses different words that indicate requirements or obligations. These verbs have different levels of force associated with them. The subtle differences may be difficult to translate.
`;

function bundleWith(
  notes: Array<{ id: string; text: string }>,
): EnrichedBundle {
  return {
    scriptures: [],
    notes,
    tw: [],
    ta: [],
    questions: [],
  } as unknown as EnrichedBundle;
}

const introBundle = bundleWith([
  { id: "intro-0", text: BOOK_INTRO },
  { id: "intro-1", text: CHAPTER_INTRO },
]);

/** Mock LLM that returns the given payloads on successive generate() calls. */
function sequenceLlm(payloads: unknown[]): {
  llm: LLMProvider;
  calls: () => number;
} {
  let call = 0;
  const llm = {
    generate: async () => {
      const payload = payloads[Math.min(call, payloads.length - 1)];
      call += 1;
      return JSON.stringify(payload);
    },
  } as unknown as LLMProvider;
  return { llm, calls: () => call };
}

function mcQuestion(section: number, tag: string) {
  return {
    section,
    q: `Question about section ${section} (${tag})?`,
    a: `Answer ${section}${tag}`,
    options: [
      `Answer ${section}${tag}`,
      `Wrong A${section}${tag}`,
      `Wrong B${section}${tag}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

describe("parseNoteSections", () => {
  it("extracts the ### subsections of a book intro; group headings are dropped", () => {
    const sections = parseNoteSections(BOOK_INTRO);
    expect(sections.map((s) => s.title)).toEqual([
      "Outline of Titus",
      "Who wrote the book of Titus?",
      "What is the book of Titus about?",
      "How should the title of this book be translated?",
      "In what roles can people serve within the church?",
      "Singular and plural **you**",
      "What is the meaning of **God our Savior**?",
    ]);
  });

  it("extracts ## sections with direct content plus ### subsections of a chapter intro", () => {
    const sections = parseNoteSections(CHAPTER_INTRO);
    expect(sections.map((s) => s.title)).toEqual([
      "Structure and Formatting",
      "Elders",
      "Should, may, must",
    ]);
  });

  it("strips rc:// links and markdown link targets from content", () => {
    const sections = parseNoteSections(BOOK_INTRO);
    const title = sections.find((s) =>
      s.title.startsWith("How should the title"),
    );
    expect(title!.content).not.toContain("rc://");
    expect(title!.content).not.toContain("(See");
    const outline = sections.find((s) => s.title === "Outline of Titus");
    expect(outline!.content).toContain("1:1–16");
    expect(outline!.content).not.toContain("../01/01.md");
  });

  it("treats bold-only lines as pseudo-headings", () => {
    const md =
      "**Purpose**\nPaul wrote to help Titus lead the churches in Crete and appoint faithful elders there.\n\n**Author**\nPaul the apostle wrote this letter near the end of his ministry, after his release from prison.";
    const sections = parseNoteSections(md);
    expect(sections.map((s) => s.title)).toEqual(["Purpose", "Author"]);
  });

  it("skips trivial/empty sections", () => {
    const md =
      "## Empty\n\n## Tiny\nShort.\n\n## Real\nThis section has enough meaningful content to be worth asking a question about.";
    const sections = parseNoteSections(md);
    expect(sections.map((s) => s.title)).toEqual(["Real"]);
  });
});

describe("collectNoteSections", () => {
  it("combines book + chapter intro sections in order", () => {
    const sections = collectNoteSections(introBundle);
    expect(sections.length).toBe(10); // 7 book + 3 chapter
    expect(sections[0].title).toBe("Outline of Titus");
    expect(sections[7].title).toBe("Structure and Formatting");
  });

  it("caps at MAX_QUIZ_QUESTIONS sections", () => {
    const many = Array.from(
      { length: 15 },
      (_, i) =>
        `## Section ${i + 1}\nThis is meaningful content for section number ${i + 1}, long enough to keep as a quiz-worthy section.`,
    ).join("\n\n");
    const sections = collectNoteSections(
      bundleWith([{ id: "n", text: `# Doc\n\n${many}` }]),
    );
    expect(sections.length).toBe(MAX_QUIZ_QUESTIONS);
  });

  it("returns nothing for unstructured verse-scoped notes", () => {
    const sections = collectNoteSections(
      bundleWith([
        { id: "n1", text: "Pablo escribió esta carta a Tito en Creta." },
      ]),
    );
    expect(sections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section-driven generation: coverage, retry, backfill, cap
// ---------------------------------------------------------------------------

describe("generateQuiz (section mode)", () => {
  it("generates ≥1 question per section when the LLM covers all sections", async () => {
    const { llm, calls } = sequenceLlm([
      {
        questions: Array.from({ length: 10 }, (_, i) => mcQuestion(i + 1, "a")),
      },
    ]);
    const items = await generateQuiz(introBundle, "TIT 1", "en", llm);
    expect(items.length).toBe(10);
    expect(calls()).toBe(1); // no retry needed
    for (const item of items) {
      expect(item.options?.length).toBeGreaterThanOrEqual(3);
      expect(item.options).toContain(item.a);
    }
  });

  it("retries once when coverage is incomplete, then uses the full retry payload", async () => {
    const { llm, calls } = sequenceLlm([
      { questions: [mcQuestion(1, "a"), mcQuestion(2, "a")] }, // misses 3..10
      {
        questions: Array.from({ length: 10 }, (_, i) => mcQuestion(i + 1, "b")),
      },
    ]);
    const items = await generateQuiz(introBundle, "TIT 1", "en", llm);
    expect(calls()).toBe(2);
    expect(items.length).toBe(10);
    expect(items.every((i) => i.q.includes("(b)"))).toBe(true);
  });

  it("backfills missing sections deterministically after a failed retry", async () => {
    // Both attempts only cover sections 1–3 → 7 sections backfilled.
    const partial = { questions: [1, 2, 3].map((n) => mcQuestion(n, "a")) };
    const { llm } = sequenceLlm([partial, partial]);
    const items = await generateQuiz(introBundle, "TIT 1", "en", llm);
    expect(items.length).toBe(10);
    // Backfill questions quote the missed section's title.
    const backfilled = items.filter((i) =>
      i.q.startsWith("According to the context notes"),
    );
    expect(backfilled.length).toBe(7);
    expect(
      backfilled.some((i) => i.q.includes("Structure and Formatting")),
    ).toBe(true);
    for (const item of backfilled) {
      expect(item.options?.length).toBeGreaterThanOrEqual(3);
      expect(item.options).toContain(item.a);
    }
  });

  it("caps total questions at MAX_QUIZ_QUESTIONS while keeping every section covered", async () => {
    // LLM returns 2 questions per section (20 total for 10 sections).
    const doubled = Array.from({ length: 10 }, (_, i) => [
      mcQuestion(i + 1, "a"),
      mcQuestion(i + 1, "b"),
    ]).flat();
    const { llm } = sequenceLlm([{ questions: doubled }]);
    const items = await generateQuiz(introBundle, "TIT 1", "en", llm);
    expect(items.length).toBe(MAX_QUIZ_QUESTIONS);
    // Every section keeps its primary question.
    for (let n = 1; n <= 10; n++) {
      expect(items.some((i) => i.q.includes(`section ${n} `))).toBe(true);
    }
  });

  it("falls back to the legacy path for unstructured notes", async () => {
    const legacyBundle = bundleWith([
      { id: "n1", text: "Pablo escribió esta carta a Tito en Creta." },
      { id: "n2", text: "El propósito es nombrar líderes fieles." },
    ]);
    const { llm, calls } = sequenceLlm([
      {
        questions: [
          {
            q: "¿Quién escribió?",
            a: "Pablo",
            options: ["Pablo", "Pedro", "Tito"],
          },
          { q: "¿Dónde?", a: "Creta", options: ["Creta", "Roma", "Éfeso"] },
          {
            q: "¿Propósito?",
            a: "Nombrar líderes",
            options: ["Nombrar líderes", "Pedir dinero", "Saludar"],
          },
        ],
      },
    ]);
    const items = await generateQuiz(legacyBundle, "TIT", "es", llm);
    expect(calls()).toBe(1);
    expect(items.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Deterministic backfill question
// ---------------------------------------------------------------------------

describe("buildSectionBackfillQuestion", () => {
  it("builds a note-grounded recall question with distractors from other sections", () => {
    const sections = parseNoteSections(BOOK_INTRO);
    const target = sections[1]; // "Who wrote the book of Titus?"
    const item = buildSectionBackfillQuestion(target, sections, "en");
    expect(item.q).toContain("Who wrote the book of Titus?");
    expect(item.a).toContain("Paul wrote the book of Titus");
    expect(item.options!.length).toBeGreaterThanOrEqual(3);
    expect(item.options).toContain(item.a);
    // Distractors come from OTHER sections.
    const distractors = item.options!.filter((o) => o !== item.a);
    for (const d of distractors) {
      expect(d).not.toBe(item.a);
    }
  });

  it("localizes the question stem for Spanish", () => {
    const sections = parseNoteSections(BOOK_INTRO);
    const item = buildSectionBackfillQuestion(sections[0], sections, "es");
    expect(item.q).toContain("Según las notas de contexto");
    expect(item.q).toContain(sections[0].title);
  });
});
