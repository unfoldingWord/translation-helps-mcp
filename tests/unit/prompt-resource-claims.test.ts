/**
 * Guardrails against false advertising of TW/TA articles in prompts.
 */
import { describe, it, expect } from "vitest";
import {
  SYSTEM_BASE,
  intentSystemFragment,
  renderEnrichedBundle,
} from "../../src/core/rag/PromptFormatter.js";
import type { EnrichedBundle } from "../../src/core/harness/budgeter.js";
import { fallbackQuizOfferFooter } from "../../src/core/harness/QuizAgents.js";

describe("resource claim guardrails", () => {
  it("SYSTEM_BASE forbids claiming unretrieved resources", () => {
    expect(SYSTEM_BASE).toMatch(/NO FALSE RESOURCE CLAIMS/i);
    expect(SYSTEM_BASE).toMatch(/unless its full body appears/i);
  });

  it("SYSTEM_BASE embeds RESOURCE GROUNDING against training-data substitute", () => {
    expect(SYSTEM_BASE).toMatch(/RESOURCE GROUNDING/i);
    expect(SYSTEM_BASE).toMatch(/NEVER invent translation principles/i);
    expect(SYSTEM_BASE).toMatch(/abstract nouns/i);
    expect(SYSTEM_BASE).toMatch(/offer to open\/fetch/i);
  });

  it("word_study fragment requires honesty when article missing", () => {
    const frag = intentSystemFragment("word_study");
    expect(frag).toMatch(/could not be retrieved/i);
    expect(frag).toMatch(/Do NOT invent/i);
    expect(frag).toMatch(/English|GST|nota|apology|plain language|everyday/i);
  });

  it("renderEnrichedBundle surfaces dataWarning for EN TW fallback", () => {
    const bundle: EnrichedBundle = {
      scripture: { versions: [], format: "plain" },
      scriptures: [],
      notes: [],
      tw: [
        {
          id: "tw-1",
          title: "servant",
          path: "bible/other/servant",
          article: "# servant\n\nA person who serves.",
        },
      ],
      ta: [],
      tq: [],
      metadata: {
        cacheStatus: "miss",
        license: "CC BY-SA 4.0",
        language: "es-419",
        reference: "",
        provenance: [],
      },
      dataWarning: "No hay Translation Words en `es-419`; usando EN.",
    };
    const rendered = renderEnrichedBundle(bundle);
    expect(rendered).toMatch(/Resource availability notice/i);
    expect(rendered).toMatch(/es-419/);
    expect(rendered).toMatch(/usando EN/i);
  });

  it("renderEnrichedBundle marks path-only TW as not retrieved", () => {
    const bundle: EnrichedBundle = {
      scripture: { versions: [], format: "plain" },
      scriptures: [],
      notes: [],
      tw: [
        {
          id: "tw-1",
          title: "siervo",
          path: "bible/kt/servant",
        },
      ],
      ta: [],
      tq: [],
      metadata: {
        cacheStatus: "miss",
        license: "CC BY-SA 4.0",
        language: "es",
        reference: "TIT 1:1",
        provenance: [],
      },
    };
    const rendered = renderEnrichedBundle(bundle);
    expect(rendered).toMatch(/NOT retrieved/i);
    expect(rendered).not.toMatch(
      /use get_word_article to retrieve full article/i,
    );
  });

  it("quiz offer fallback is framed as optional secondary", () => {
    expect(fallbackQuizOfferFooter("es", 4)).toMatch(/Opcional/i);
    expect(fallbackQuizOfferFooter("en", 4)).toMatch(/Optional/i);
  });
});
