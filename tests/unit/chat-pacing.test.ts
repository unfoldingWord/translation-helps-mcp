/**
 * Chat pacing — prompt instructions + word-budget enforcement (consultant pedagogy).
 */
import { describe, it, expect } from "vitest";
import {
  CHAT_WORD_BUDGETS,
  closerKindForIntent,
  coachingCloser,
  countWords,
  endsWithQuestion,
  enforceReplyBudget,
  maxTokensForWordBudget,
  paceChatReply,
  pacingPromptInstructions,
  truncateAtFirstQuestion,
  truncateAtWordBudget,
  wordBudgetForIntent,
} from "../../src/core/harness/chatPacing.js";
import {
  composeAnnotatedGuideReply,
  formatDrillSystem,
} from "../../src/core/harness/PassageAnnotator.js";
import { intentSystemFragment } from "../../src/core/rag/PromptFormatter.js";
import type { LLMProvider } from "../../src/core/rag/providers/LLMProvider.js";

function words(n: number, seed = "word"): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
}

describe("chat pacing budgets", () => {
  it("sets progressive budgets for long-help intents", () => {
    expect(CHAT_WORD_BUDGETS.annotated_passage).toBe(180);
    expect(CHAT_WORD_BUDGETS.phrase_drill).toBe(140);
    expect(CHAT_WORD_BUDGETS.passage_help).toBe(180);
    expect(CHAT_WORD_BUDGETS.open_ended).toBe(180);
    expect(CHAT_WORD_BUDGETS.methodology).toBe(160);
    expect(wordBudgetForIntent("quiz_answer")).toBeNull();
    expect(wordBudgetForIntent("word_study")).toBeNull();
  });

  it("maps maxTokens from word budget", () => {
    expect(maxTokensForWordBudget(180)).toBeGreaterThan(200);
    expect(maxTokensForWordBudget(180)).toBeLessThanOrEqual(420);
  });

  it("picks coaching closer kinds by intent", () => {
    expect(closerKindForIntent("annotated_passage")).toBe("brief");
    expect(closerKindForIntent("phrase_drill")).toBe("drill");
    expect(closerKindForIntent("methodology")).toBe("drill");
  });
});

describe("pacingPromptInstructions", () => {
  it("requires consultant pedagogy: 2–3 decisions, panel, invite-draft (not premature CANA)", () => {
    const text = pacingPromptInstructions(180, { priorityDecisions: true });
    expect(text).toMatch(/2–3 priority decisions/i);
    expect(text).toMatch(/consultant pedagogy|CANA/i);
    expect(text).toMatch(/resources panel/i);
    expect(text).toMatch(/180 words/i);
    expect(text).toMatch(/invite a draft|Mi traducción/i);
    expect(text).toMatch(/Do \*\*not\*\* ask "How did you translate X\?"/i);
    // The ban is unconditional and probes ask for meaning instead.
    expect(text).toMatch(/— ever/);
    expect(text).not.toMatch(/until Pedir revisión/i);
    expect(text).toMatch(/what the word they chose MEANS/);
    expect(text).toMatch(/exactly ONE meaning-based CANA probe per turn/i);
    expect(text).not.toMatch(/2–4 CANA probes/);
    expect(text).toMatch(/source\/conversation language/i);
    expect(text).toMatch(/Never end with a "want more information\?" dump/i);
    expect(text).toMatch(/sounds right|fix their target-language/i);
    expect(coachingCloser("es", "brief")).toMatch(
      /Mi traducción|no sabes cómo traducir/i,
    );
    expect(coachingCloser("en", "brief")).not.toMatch(/How did you translate/i);
    expect(coachingCloser("en", "brief")).not.toMatch(/want more/i);
  });
});

describe("prompt fragments include pacing", () => {
  it("annotated_passage / passage_help / open_ended / methodology fragments", () => {
    for (const intent of [
      "annotated_passage",
      "passage_help",
      "open_ended",
      "methodology",
      "phrase_drill",
    ] as const) {
      const frag = intentSystemFragment(intent);
      expect(frag).toMatch(/Chat pacing|Hard cap|2–3 priority|one focused/i);
      expect(frag).toMatch(/consult|coach|CANA|teach by questioning|STOP/i);
    }
  });

  it("formatDrillSystem includes hard cap and coaching closer style", () => {
    const prompt = formatDrillSystem(
      {
        index: 1,
        verse: "1",
        phrase: "servant",
        noteText: "key term",
        category: "key-term",
        sourceType: "tw",
      },
      "es",
    );
    expect(prompt).toMatch(/Hard cap ≈ 140 words/);
    expect(prompt).toMatch(/render|sense|draft|Mi traducción|consultant/i);
  });
});

describe("truncateAtFirstQuestion (checking: exactly ONE probe per turn)", () => {
  it("keeps only the first question when the coach stacks three", () => {
    const stacked =
      "Good progress. What does the word you chose for 'knowledge' mean in your language? " +
      "Does it clearly convey knowing God personally? " +
      "How can you make sure your readers understand that?";
    const { text, truncated } = truncateAtFirstQuestion(stacked);
    expect(truncated).toBe(true);
    expect(text).toContain(
      "What does the word you chose for 'knowledge' mean in your language?",
    );
    expect(text).not.toContain("Does it clearly convey");
    expect(text).not.toContain("How can you make sure");
    // Ends at the first question mark.
    expect(text.trimEnd().endsWith("?")).toBe(true);
  });

  it("preserves hidden HTML markers after truncation", () => {
    const stacked =
      "Ok. What does your word for 'godliness' mean? Does it have other senses?\n" +
      "<!-- CHECK:note:tn97 -->\n<!-- CHECKING:TIT 1:1-4 -->";
    const { text, truncated } = truncateAtFirstQuestion(stacked);
    expect(truncated).toBe(true);
    expect(text).toContain("What does your word for 'godliness' mean?");
    expect(text).not.toContain("Does it have other senses");
    expect(text).toContain("<!-- CHECK:note:tn97 -->");
    expect(text).toContain("<!-- CHECKING:TIT 1:1-4 -->");
  });

  it("cuts at the first Spanish question and drops the stacked second one", () => {
    const es =
      "Bien. ¿Qué significa la palabra que elegiste para 'conocimiento'? ¿Tiene otros sentidos?";
    const { text, truncated } = truncateAtFirstQuestion(es);
    expect(truncated).toBe(true);
    expect(text).toContain(
      "¿Qué significa la palabra que elegiste para 'conocimiento'?",
    );
    expect(text).not.toContain("¿Tiene otros sentidos?");
  });

  it("does not cut mid-sentence at a quoted question mark", () => {
    const quoted =
      'The panel question asks "Why did Paul stay in Crete?" — what would your readers answer?';
    const { text, truncated } = truncateAtFirstQuestion(quoted);
    expect(truncated).toBe(false);
    expect(text).toContain("what would your readers answer?");
  });

  it("leaves replies without a question unchanged (markers intact)", () => {
    const noQ =
      "You already worked through this one.\n<!-- CHECKING:TIT 1:1-4 -->";
    const { text, truncated } = truncateAtFirstQuestion(noQ);
    expect(truncated).toBe(false);
    expect(text).toContain("You already worked through this one.");
    expect(text).toContain("<!-- CHECKING:TIT 1:1-4 -->");
  });

  it("is a no-op cut when the single question already ends the reply", () => {
    const single = "Let's look at v.1. What does your word for 'apostle' mean?";
    const { text, truncated } = truncateAtFirstQuestion(single);
    expect(truncated).toBe(false);
    expect(text).toBe(single);
  });
});

describe("countWords / truncate / enforceReplyBudget", () => {
  it("counts words and ignores HTML markers", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("one two <!-- CHALLENGES:1 [] --> three")).toBe(3);
  });

  it("detects closing questions", () => {
    expect(endsWithQuestion("Shall we start?")).toBe(true);
    expect(endsWithQuestion("¿Quieres continuar?")).toBe(true);
    expect(endsWithQuestion("No question here.")).toBe(false);
  });

  it("truncates oversized replies near the budget", () => {
    const long = words(400);
    const { text, truncated } = truncateAtWordBudget(long, 180);
    expect(truncated).toBe(true);
    expect(countWords(text)).toBeLessThanOrEqual(180);
    expect(countWords(text)).toBeGreaterThan(90);
  });

  it("prefers sentence boundaries when truncating", () => {
    const body =
      words(100, "a") + ". " + words(50, "b") + ". " + words(200, "c") + ".";
    const { text, truncated } = truncateAtWordBudget(body, 180);
    expect(truncated).toBe(true);
    expect(text.endsWith(".")).toBe(true);
    expect(countWords(text)).toBeLessThanOrEqual(180);
  });

  it("appends Spanish coaching closer when truncated", () => {
    const long = words(300) + ".";
    const result = enforceReplyBudget(long, {
      budget: 180,
      language: "es",
      closerKind: "brief",
    });
    expect(result.truncated).toBe(true);
    expect(result.wordCount).toBeLessThanOrEqual(
      180 + countWords(coachingCloser("es", "brief")),
    );
    expect(result.text).toMatch(/no sabes cómo traducir|Mi traducción/i);
    expect(endsWithQuestion(result.text)).toBe(true);
  });

  it("uses drill coaching closer for phrase drills", () => {
    const long = words(250) + ".";
    const result = enforceReplyBudget(long, {
      budget: 140,
      language: "es",
      closerKind: "drill",
    });
    expect(result.text).toMatch(/difícil|Mi traducción/i);
    expect(result.text).not.toMatch(/¿Cómo tradujiste/i);
  });

  it("preserves trailing HTML markers", () => {
    const long = words(250) + "\n<!-- PHRASE_DRILL:1/5 -->";
    const result = enforceReplyBudget(long, {
      budget: 140,
      language: "en",
      closerKind: "drill",
    });
    expect(result.text).toContain("<!-- PHRASE_DRILL:1/5 -->");
    expect(countWords(result.text)).toBeLessThanOrEqual(
      140 + countWords(coachingCloser("en", "drill")),
    );
  });

  it("does not rewrite a short reply that already ends with a question", () => {
    const short =
      "**TIT 1:1** — two decisions here.\n\n1. A\n2. B\n\n¿Qué parte te cuesta traducir?";
    const result = enforceReplyBudget(short, { budget: 180, language: "es" });
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(short);
  });

  it("paceChatReply no-ops for non-paced intents", () => {
    const text = words(500);
    const result = paceChatReply(text, "quiz_answer", "en");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });
});

describe("composeAnnotatedGuideReply pacing", () => {
  it("prompt asks for 2–3 decisions and enforce trims with coaching closer", async () => {
    let capturedSystem = "";
    const llm: LLMProvider = {
      generate: async (messages) => {
        capturedSystem =
          messages.find((m) => m.role === "system")?.content ?? "";
        return words(500) + " Sin pregunta al final.";
      },
      modelId: () => "stub",
    };

    const reply = await composeAnnotatedGuideReply(llm, {
      reference: "TIT 1:1",
      language: "es",
      tnCount: 5,
      twCount: 3,
      challenges: [
        { verse: "1", phrase: "siervo", noteText: "key term note" },
        { verse: "1", phrase: "elegidos", noteText: "chosen ones" },
        { verse: "1", phrase: "conocimiento", noteText: "knowledge" },
      ],
    });

    expect(capturedSystem).toMatch(/at most \*\*2–3\*\*/i);
    expect(capturedSystem).toMatch(/consultant pedagogy|Chat pacing|CANA/i);
    expect(capturedSystem).toMatch(/resources panel/i);
    expect(capturedSystem).toMatch(/Do NOT ask "How did you translate X\?"/i);
    expect(capturedSystem).toMatch(
      /Language lock|source\/conversation language/i,
    );
    expect(capturedSystem).toMatch(
      /Do NOT print section titles|Never echo prompt scaffolding/i,
    );
    expect(capturedSystem).not.toMatch(/\*\*Discourse \/ structure\*\*/);
    expect(capturedSystem).not.toMatch(/\*\*Coach, then ask\*\*/);
    expect(countWords(reply)).toBeLessThanOrEqual(
      CHAT_WORD_BUDGETS.annotated_passage +
        countWords(coachingCloser("es", "brief")),
    );
    expect(reply).toMatch(/Mi traducción|no sabes cómo traducir/i);
    expect(reply).not.toMatch(/¿Cómo tradujiste/i);
  });
});
