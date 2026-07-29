/**
 * Translation-consultant pedagogy — prompt fragments + draft-submit intent detectors.
 */
import { describe, it, expect } from "vitest";
import {
  COACH_PERSONA,
  COACH_TEACHING_LOOP,
  COACH_CANA,
  COACH_PLAIN_LANGUAGE,
  COACH_RESOURCE_GROUNDING,
  COACH_NO_ECHO_SCAFFOLD,
  draftCheckCoachInstructions,
  detectDraftSubmitIntent,
  detectDifficultyFollowUp,
  formatDraftSubmitMessage,
  stripCoachScaffoldLabels,
} from "../../src/core/harness/coachPedagogy.js";
import {
  SYSTEM_BASE,
  intentSystemFragment,
} from "../../src/core/rag/PromptFormatter.js";
import { classifyIntent } from "../../src/core/harness/intent.js";
import { selectResources } from "../../src/core/harness/resourceSelector.js";
import {
  fallbackQuizCompleteMessage,
  fallbackQuizSkippedMessage,
} from "../../src/core/harness/QuizAgents.js";
import {
  coachingCloser,
  enforceReplyBudget,
} from "../../src/core/harness/chatPacing.js";

describe("coach pedagogy fragments", () => {
  it("SYSTEM_BASE embeds consultant persona, CANA, resource grounding, plain language, and consultant loop", () => {
    expect(SYSTEM_BASE).toContain("translation consultant");
    expect(SYSTEM_BASE).toMatch(/CANA|Consistent/);
    expect(SYSTEM_BASE).toMatch(/resources panel/i);
    expect(SYSTEM_BASE).toMatch(/Mi traducción/);
    expect(SYSTEM_BASE).toMatch(/Never rewrite the user's draft/i);
    expect(SYSTEM_BASE).toMatch(/Never evaluate/i);
    expect(SYSTEM_BASE).toContain(COACH_PERSONA.slice(0, 40));
    expect(SYSTEM_BASE).toContain(COACH_TEACHING_LOOP.slice(0, 40));
    expect(SYSTEM_BASE).toContain(COACH_PLAIN_LANGUAGE.slice(0, 40));
    expect(SYSTEM_BASE).toContain(COACH_RESOURCE_GROUNDING.slice(0, 40));
    expect(SYSTEM_BASE).toMatch(/RESOURCE GROUNDING/i);
    expect(SYSTEM_BASE).toMatch(/NEVER invent translation principles/i);
    expect(SYSTEM_BASE).toMatch(/abstract nouns/i);
    expect(COACH_PLAIN_LANGUAGE).toMatch(
      /everyday|Plain language|don't understand/i,
    );
    expect(COACH_PLAIN_LANGUAGE).toMatch(/jargon/i);
    expect(COACH_PLAIN_LANGUAGE).toMatch(/loaded note's point/i);
    expect(COACH_CANA).toMatch(/\*\*N\*\*atural|Natural/);
    expect(COACH_CANA).toMatch(
      /will \*\*not\*\* know their receptor language/i,
    );
    expect(COACH_TEACHING_LOOP).toMatch(/PANEL STATE/);
    expect(COACH_TEACHING_LOOP).toMatch(/<!-- PANEL:focus_tab:/);
  });

  it("COACH_RESOURCE_GROUNDING forbids training-data substitute for TN/TW/TA", () => {
    expect(COACH_RESOURCE_GROUNDING).toMatch(/loaded passage resources/i);
    expect(COACH_RESOURCE_GROUNDING).toMatch(
      /NEVER invent translation principles/i,
    );
    expect(COACH_RESOURCE_GROUNDING).toMatch(/abstract nouns/i);
    expect(COACH_RESOURCE_GROUNDING).toMatch(
      /Training knowledge may only be used for conversation glue/i,
    );
    expect(COACH_RESOURCE_GROUNDING).toMatch(
      /admit gap|do not cover|offer to open\/fetch/i,
    );
    expect(COACH_PERSONA).toContain(COACH_RESOURCE_GROUNDING.slice(0, 40));
  });

  it("checking fragment uses draft-check consulting pattern", () => {
    const frag = intentSystemFragment("checking");
    expect(frag).toMatch(/Check-questions consulting/i);
    expect(frag).toMatch(/Acknowledge/i);
    expect(frag).toMatch(/felt hard|hardest/i);
    expect(frag).toMatch(/CANA/);
    expect(frag).toMatch(/Mi traducción/);
    expect(frag).toContain(COACH_NO_ECHO_SCAFFOLD.slice(0, 40));
    expect(frag).not.toMatch(/correct understanding of the passage/i);
    expect(frag).toMatch(/never grade|unknown|receptor language|sounds right/i);
    expect(frag).toMatch(/Checking checklist/i);
    expect(frag).toMatch(/<!-- CHECK:note:/);
    expect(frag).toMatch(/<!-- CHECK:tw:/);
    expect(frag).toMatch(/<!-- CHECK:tq:/);
  });

  it("passage_help fragment forbids echoing English scaffold labels", () => {
    const frag = intentSystemFragment("passage_help");
    expect(frag).toMatch(/never print English scaffolding/i);
    expect(frag).not.toMatch(/\*\*Coach, then ask\*\*/);
    expect(frag).not.toMatch(/\*\*Discourse \/ structure\*\*/);
  });

  it("annotated_passage / open_ended invite panel + hard + draft (no premature translate-how)", () => {
    const annotated = intentSystemFragment("annotated_passage");
    expect(annotated).toMatch(/panel/i);
    expect(annotated).toMatch(/hard|Mi traducción|consultant/i);
    expect(annotated).toMatch(/Do not ask "How did you translate X\?"/i);

    const open = intentSystemFragment("open_ended");
    expect(open).toMatch(/esto me costó/i);
    expect(open).toMatch(/do not rewrite/i);
    expect(open).toMatch(/consultant|CANA/i);
    expect(open).toMatch(/Never ask "How did you translate X\?"/i);
    expect(open).toMatch(/what the word they chose means/i);
  });

  it("draftCheckCoachInstructions forbids target-language grading and rewrite", () => {
    const text = draftCheckCoachInstructions("en");
    expect(text).toMatch(/NEVER claim their draft "sounds right/i);
    expect(text).toMatch(/NEVER rewrite their draft/i);
    expect(text).toMatch(/exactly ONE focused CANA probe question per turn/i);
    expect(text).not.toMatch(/2–4 focused CANA probe/i);
    expect(text).toMatch(/NEVER ask "How did you translate X\?"/);
    expect(text).toMatch(
      /What does the word you chose for X mean in your language\?/,
    );
    expect(text).toMatch(/describing meaning in the source language/i);
    expect(text).toMatch(/one at a time, never stacked/i);
    expect(text).toMatch(/NEVER ask them to paste their receptor draft/i);
    expect(text).toMatch(/NEVER praise, correct, or evaluate target-language/i);
    expect(text).toMatch(/source \/ conversation language \(en\)/i);
    expect(text).not.toMatch(
      /Invite revision in Mi traducción — they improve the draft; you coach/,
    );
    expect(text).toMatch(/Checking checklist/i);
    expect(text).toMatch(/<!-- CHECK:note:<id> -->/);
    expect(text).toMatch(/<!-- CHECK:tw:<path> -->/);
    expect(text).toMatch(/<!-- CHECK:tq:<id> -->/);
    expect(text).toMatch(
      /Ground every probe in the \*\*loaded\*\* TN \/ TW \/ TQ/i,
    );
    expect(text).toMatch(
      /never invent notes, articles, or generic linguistics/i,
    );
  });

  it("consultant loop mentions checklist markers after Pedir revisión", () => {
    expect(COACH_TEACHING_LOOP).toMatch(/Checking checklist/i);
    expect(COACH_TEACHING_LOOP).toMatch(/CHECK:note\|tw\|tq/);
  });

  it("plain-language rules forbid sticky TN jargon for beginners", () => {
    expect(COACH_PLAIN_LANGUAGE).toMatch(/ALWAYS paraphrase/i);
    expect(COACH_PLAIN_LANGUAGE).toMatch(/abstract noun/i);
    expect(COACH_PLAIN_LANGUAGE).toMatch(/passive form/i);
    expect(COACH_PLAIN_LANGUAGE).toMatch(/everyday English/i);
    expect(COACH_PERSONA).toMatch(/source \/ conversation language/i);
    expect(COACH_PERSONA).toMatch(
      /never switch coach replies into the receptor language/i,
    );
    expect(COACH_TEACHING_LOOP).toMatch(
      /Do \*\*not\*\* ask "How did you translate X\?"/i,
    );
  });

  it("persona + loop enforce one question per turn and meaning-based probing", () => {
    expect(COACH_PERSONA).toMatch(/exactly ONE clear consultant question/i);
    expect(COACH_PERSONA).toMatch(/including checking and draft review/i);
    expect(COACH_PERSONA).toMatch(/Never ask "How did you translate X\?"/);
    expect(COACH_PERSONA).toMatch(
      /What does the word you chose for X mean in your language\?/,
    );
    expect(COACH_TEACHING_LOOP).toMatch(
      /exactly ONE focused CANA probe question per turn/i,
    );
    expect(COACH_TEACHING_LOOP).not.toMatch(/2–4 focused CANA probe/i);
    expect(COACH_TEACHING_LOOP).toMatch(
      /What does the word you chose for \[source word\/phrase\] mean/i,
    );
    expect(COACH_TEACHING_LOOP).toMatch(
      /DESCRIBING meaning in the source\/conversation language/i,
    );
  });

  it("SYSTEM_BASE locks coach replies to source language", () => {
    expect(SYSTEM_BASE).toMatch(
      /Always reply in the source \/ conversation language/i,
    );
    expect(SYSTEM_BASE).not.toMatch(
      /Always respond in the same language the user is writing in/i,
    );
  });
});

describe("formatDraftSubmitMessage", () => {
  it("builds ready-for-check cues without the receptor draft body", () => {
    const en = formatDraftSubmitMessage({
      reference: "TIT 1:1-4",
      draft: "Pablo, siervo de Dios…",
      language: "en",
    });
    expect(en).toContain("I'm ready for check questions on TIT 1:1-4");
    expect(en).not.toContain("Pablo, siervo de Dios…");
    expect(detectDraftSubmitIntent(en)).toBe(true);

    const es = formatDraftSubmitMessage({
      reference: "TIT 1:1-4",
      draft: "Pablo, siervo de Dios…",
      language: "es-419",
    });
    expect(es).toContain(
      "Estoy listo para preguntas de revisión sobre TIT 1:1-4",
    );
    expect(es).not.toContain("Pablo, siervo de Dios…");
    expect(detectDraftSubmitIntent(es)).toBe(true);
  });
});

describe("detectDraftSubmitIntent", () => {
  it("matches Spanish and English submit cues", () => {
    expect(detectDraftSubmitIntent("aquí está mi borrador")).toBe(true);
    expect(detectDraftSubmitIntent("revisa mi traducción")).toBe(true);
    expect(detectDraftSubmitIntent("check my draft")).toBe(true);
    expect(detectDraftSubmitIntent("here's my draft")).toBe(true);
    expect(detectDraftSubmitIntent("save draft")).toBe(true);
    expect(detectDraftSubmitIntent("pedir revisión")).toBe(true);
    expect(
      detectDraftSubmitIntent("I'm ready for check questions on TIT 1:1"),
    ).toBe(true);
    expect(
      detectDraftSubmitIntent(
        "Estoy listo para preguntas de revisión sobre TIT 1:1",
      ),
    ).toBe(true);
    expect(
      detectDraftSubmitIntent(
        "Mi borrador:\nPablo, siervo de Dios, y apóstol de Jesucristo…",
      ),
    ).toBe(true);
  });

  it("ignores unrelated chat", () => {
    expect(detectDraftSubmitIntent("Explain Titus 1:1")).toBe(false);
    expect(detectDraftSubmitIntent("quiero estudiar Tito")).toBe(false);
  });

  it("matches NL re-entry to checking (EN + ES)", () => {
    for (const phrase of [
      "let's go back to checking my draft of Titus 1:1-4",
      "go back to the review",
      "resume the review",
      "continue checking",
      "volvamos a la revisión",
      "sigamos con la revisión",
      "retomemos la revisión",
    ]) {
      expect(detectDraftSubmitIntent(phrase), phrase).toBe(true);
    }
  });
});

describe("detectDifficultyFollowUp", () => {
  it("matches ES/EN difficulty cues", () => {
    expect(detectDifficultyFollowUp("esto me costó mucho")).toBe(true);
    expect(detectDifficultyFollowUp("me costó traducir siervo")).toBe(true);
    expect(detectDifficultyFollowUp("this was hard to translate")).toBe(true);
    expect(detectDifficultyFollowUp("the hardest part was grace")).toBe(true);
  });

  it("ignores unrelated chat", () => {
    expect(detectDifficultyFollowUp("siguiente paso")).toBe(false);
  });
});

describe("classifyIntent draft-check routing", () => {
  it("routes draft submit to checking with high confidence", () => {
    const r = classifyIntent("aquí está mi borrador para TIT 1:1");
    expect(r.intent).toBe("checking");
    expect(r.confidence).toBe("high");
    expect(r.reference).toBe("TIT 1:1");
  });

  it("prefers checking over annotated_passage when draft+reference are submitted", () => {
    const msg = formatDraftSubmitMessage({
      reference: "TIT 1:1-4",
      draft: "Pablo, siervo de Dios y apóstol de Jesucristo…",
      language: "en",
    });
    const r = classifyIntent(msg);
    expect(r.intent).toBe("checking");
    expect(r.reference).toBe("TIT 1:1-4");
    expect(r.confidence).toBe("high");
  });

  it("routes difficulty follow-up to checking", () => {
    const r = classifyIntent("esto me costó traducir 'siervo'");
    expect(r.intent).toBe("checking");
    expect(r.confidence).toBe("high");
  });
});

describe("checking resource plan includes TN context", () => {
  it("fetches notes + questions for draft coaching", () => {
    const plan = selectResources(
      { intent: "checking", reference: "TIT 1:1", confidence: "high" },
      "es",
    );
    const tools = plan.initialFetches.map((f) => f.tool);
    expect(tools).toContain("get_passage");
    expect(tools).toContain("get_note");
    expect(tools).toContain("get_questions");
  });
});

describe("quiz soft language invites coach next step", () => {
  it("complete/skip fallbacks point to panel and ask what's hard", () => {
    expect(fallbackQuizCompleteMessage("es")).toMatch(/panel/i);
    expect(fallbackQuizCompleteMessage("es")).toMatch(/Mi traducción|difícil/i);
    expect(fallbackQuizSkippedMessage("es")).toMatch(/panel/i);
    expect(fallbackQuizSkippedMessage("en")).toMatch(
      /don't you know how to translate/i,
    );
  });
});

describe("coachingCloser invites draft (not premature CANA)", () => {
  it("Spanish brief closer asks what's hard or invites draft", () => {
    expect(coachingCloser("es", "brief")).toMatch(
      /no sabes cómo traducir|Mi traducción/i,
    );
    expect(coachingCloser("es", "brief")).not.toMatch(/Cómo tradujiste/i);
  });

  it("Spanish drill closer asks what's hard / invite draft", () => {
    expect(coachingCloser("es", "drill")).toMatch(/difícil|Mi traducción/i);
    expect(coachingCloser("es", "drill")).not.toMatch(/Cómo tradujiste/i);
  });

  it("English closers never use past-tense translate-how before draft", () => {
    expect(coachingCloser("en", "brief")).not.toMatch(/How did you translate/i);
    expect(coachingCloser("en", "drill")).not.toMatch(/How did you translate/i);
    expect(coachingCloser("en", "brief")).toMatch(
      /draft|My translation|don't you know/i,
    );
  });
});

describe("stripCoachScaffoldLabels", () => {
  it("removes English meta-headers but keeps Spanish coaching content", () => {
    const leaked =
      "**Tito 1:1** — lee el texto en el panel.\n\n" +
      "2. **Discourse / structure** — Esta carta presenta a Pablo y el propósito de la fe.\n\n" +
      "**Coach, then ask** — ¿Qué parte te cuesta traducir?\n" +
      "<!-- QUIZ:cleared -->";

    const cleaned = stripCoachScaffoldLabels(leaked);
    expect(cleaned).not.toMatch(/Discourse\s*\/\s*structure/i);
    expect(cleaned).not.toMatch(/Coach,?\s*then\s*ask/i);
    expect(cleaned).toMatch(/Esta carta presenta a Pablo/);
    expect(cleaned).toMatch(/¿Qué parte te cuesta traducir/);
    expect(cleaned).toContain("<!-- QUIZ:cleared -->");
  });

  it("enforceReplyBudget strips scaffolds before pacing", () => {
    const raw =
      "**Priority decisions** — Decide cómo traducir «siervo».\n\n" +
      "Point to the panel: lee las notas.\n\n" +
      "Listo.";
    const paced = enforceReplyBudget(raw, {
      budget: 180,
      language: "es-419",
      ensureCloser: false,
    });
    expect(paced.text).not.toMatch(/Priority decisions/i);
    expect(paced.text).not.toMatch(/Point to the panel/i);
    expect(paced.text).toMatch(/Decide cómo traducir/);
  });
});
