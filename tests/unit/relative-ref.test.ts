import { describe, expect, it } from "vitest";
import { extractReferenceInfo } from "../../src/core/harness/intent.js";
import {
  composeRelativeReference,
  extractRelativeRefFallback,
  extractSectionVerseRanges,
  mentionsRelativeRef,
  mentionsSectionSelection,
  parsePositiveInt,
  parseStudyRefParts,
  resolveSectionSelection,
} from "../../src/core/harness/relativeRef.js";

const resolveBook = (name: string) => {
  const map: Record<string, string> = { Ruth: "RUT", Titus: "TIT", Rut: "RUT" };
  return map[name] ?? (name.length === 3 ? name.toUpperCase() : null);
};

describe("parseStudyRefParts", () => {
  it("parses bare book, chapter, and verse refs", () => {
    expect(parseStudyRefParts("RUT")).toEqual({ book: "RUT", chapter: null });
    expect(parseStudyRefParts("RUT 1")).toEqual({ book: "RUT", chapter: 1 });
    expect(parseStudyRefParts("RUT 1:1")).toEqual({ book: "RUT", chapter: 1 });
  });
});

describe("composeRelativeReference", () => {
  it("composes chapter from study book + extractedChapter", () => {
    const result = composeRelativeReference(
      {
        extractedBook: null,
        extractedChapter: 1,
        extractedVerse: null,
        extractedVerseEnd: null,
      },
      "RUT",
      resolveBook,
    );
    expect(result).toEqual({
      reference: "RUT 1",
      intent: "passage_overview",
    });
  });

  it("composes verse from study chapter + extractedVerse", () => {
    const result = composeRelativeReference(
      {
        extractedBook: null,
        extractedChapter: null,
        extractedVerse: 1,
        extractedVerseEnd: null,
      },
      "RUT 1",
      resolveBook,
    );
    expect(result).toEqual({
      reference: "RUT 1:1",
      intent: "annotated_passage",
    });
  });

  it("defaults to chapter 1 for verse when only book is known", () => {
    const result = composeRelativeReference(
      {
        extractedBook: null,
        extractedChapter: null,
        extractedVerse: 3,
        extractedVerseEnd: null,
      },
      "RUT",
      resolveBook,
    );
    expect(result).toEqual({
      reference: "RUT 1:3",
      intent: "annotated_passage",
    });
  });

  it("composes verse ranges", () => {
    const result = composeRelativeReference(
      {
        extractedBook: null,
        extractedChapter: null,
        extractedVerse: 1,
        extractedVerseEnd: 5,
      },
      "RUT 1",
      resolveBook,
    );
    expect(result).toEqual({
      reference: "RUT 1:1-5",
      intent: "annotated_passage",
    });
  });

  it("returns null without book context", () => {
    expect(
      composeRelativeReference(
        {
          extractedBook: null,
          extractedChapter: 1,
          extractedVerse: null,
          extractedVerseEnd: null,
        },
        null,
        resolveBook,
      ),
    ).toBeNull();
  });
});

describe("mentionsRelativeRef", () => {
  it("detects relative chapter and verse phrases", () => {
    expect(mentionsRelativeRef("Empecemos por el primer capítulo")).toBe(true);
    expect(mentionsRelativeRef("lets translate verse 1")).toBe(true);
    expect(mentionsRelativeRef("ayudame a traducir el versículo 1")).toBe(true);
    expect(mentionsRelativeRef("chapter 2")).toBe(true);
    expect(mentionsRelativeRef("traduzcamos 1:1-4")).toBe(true);
    expect(mentionsRelativeRef("1:1-4")).toBe(true);
  });

  it("ignores non-reference messages", () => {
    expect(mentionsRelativeRef("gracias")).toBe(false);
    expect(mentionsRelativeRef("explica más sobre el pacto")).toBe(false);
    expect(mentionsRelativeRef("Titus 1:1")).toBe(false);
  });
});

describe("extractRelativeRefFallback", () => {
  it("extracts chapter from continue-to-chapter phrases", () => {
    expect(extractRelativeRefFallback("continue to chapter 1")).toEqual({
      extractedChapter: 1,
      extractedVerse: null,
      extractedVerseEnd: null,
    });
    expect(extractRelativeRefFallback("continuemos con el capítulo 1")).toEqual(
      {
        extractedChapter: 1,
        extractedVerse: null,
        extractedVerseEnd: null,
      },
    );
    expect(
      extractRelativeRefFallback("empecemos por el primer capítulo"),
    ).toEqual({
      extractedChapter: 1,
      extractedVerse: null,
      extractedVerseEnd: null,
    });
  });

  it("extracts verse and verse ranges", () => {
    expect(extractRelativeRefFallback("verse 2")).toEqual({
      extractedChapter: null,
      extractedVerse: 2,
      extractedVerseEnd: null,
    });
    expect(extractRelativeRefFallback("versículos 1-5")).toEqual({
      extractedChapter: null,
      extractedVerse: 1,
      extractedVerseEnd: 5,
    });
    expect(extractRelativeRefFallback("verses 2 al 4")).toEqual({
      extractedChapter: null,
      extractedVerse: 2,
      extractedVerseEnd: 4,
    });
  });

  it("extracts bare C:V and C:V-V references", () => {
    expect(extractRelativeRefFallback("1:1-4")).toEqual({
      extractedChapter: 1,
      extractedVerse: 1,
      extractedVerseEnd: 4,
    });
    expect(extractRelativeRefFallback("traduzcamos 1:1-4")).toEqual({
      extractedChapter: 1,
      extractedVerse: 1,
      extractedVerseEnd: 4,
    });
    expect(extractRelativeRefFallback("vamos con 2:5")).toEqual({
      extractedChapter: 2,
      extractedVerse: 5,
      extractedVerseEnd: null,
    });
  });

  it("returns null for non-relative or full book references", () => {
    expect(extractRelativeRefFallback("gracias")).toBeNull();
    expect(extractRelativeRefFallback("Titus 1:1")).toBeNull();
    expect(extractRelativeRefFallback("Rut 1")).toBeNull();
  });
});

const SAMPLE_OVERVIEW = `Tito 1 es una carta de instrucción.

**Tu camino de traducción para Tito 1:**
☐ 1. Secciones del pasaje
☐ 2. Desafíos de metáforas

---
**Paso 1 — Secciones del pasaje**

- **Versículos 1-4: Introducción y saludo** — Pablo se presenta.
- **Versículos 5-9: Cualificaciones de los ancianos** — requisitos.
- **Versículos 10-16: Falsos maestros** — advertencia.

---
*[Step 1/5] — Dime "next" para continuar*`;

describe("resolveSectionSelection", () => {
  it("detects section selection phrases", () => {
    expect(mentionsSectionSelection("quiero traducir la sección 1")).toBe(true);
    expect(mentionsSectionSelection("section 2")).toBe(true);
    expect(mentionsSectionSelection("la primera sección")).toBe(true);
    expect(mentionsSectionSelection("next")).toBe(false);
  });

  it("extracts ordered verse ranges from overview headings", () => {
    expect(extractSectionVerseRanges(SAMPLE_OVERVIEW)).toEqual([
      { extractedChapter: null, extractedVerse: 1, extractedVerseEnd: 4 },
      { extractedChapter: null, extractedVerse: 5, extractedVerseEnd: 9 },
      { extractedChapter: null, extractedVerse: 10, extractedVerseEnd: 16 },
    ]);
  });

  it("extracts compact v.1–4 style section headings from live overviews", () => {
    const liveStyle = `
**Paso 1 — Estructura del pasaje**
- **v.1–4: Introducción y saludo** — Pablo se presenta.
- **v.5–9: Calificaciones para los ancianos** — requisitos.
- **v.10–16: Falsos maestros** — advertencia.
`;
    expect(extractSectionVerseRanges(liveStyle)).toEqual([
      { extractedChapter: null, extractedVerse: 1, extractedVerseEnd: 4 },
      { extractedChapter: null, extractedVerse: 5, extractedVerseEnd: 9 },
      { extractedChapter: null, extractedVerse: 10, extractedVerseEnd: 16 },
    ]);
    expect(
      resolveSectionSelection("quiero traducir la sección 1", liveStyle),
    ).toEqual({
      extractedChapter: null,
      extractedVerse: 1,
      extractedVerseEnd: 4,
    });
  });

  it("resolves section 1 to verses 1-4", () => {
    expect(
      resolveSectionSelection("quiero traducir la sección 1", SAMPLE_OVERVIEW),
    ).toEqual({
      extractedChapter: null,
      extractedVerse: 1,
      extractedVerseEnd: 4,
    });
    expect(
      resolveSectionSelection("vamos a la primera sección", SAMPLE_OVERVIEW),
    ).toEqual({
      extractedChapter: null,
      extractedVerse: 1,
      extractedVerseEnd: 4,
    });
  });

  it("resolves section 2 and rejects out-of-range", () => {
    expect(resolveSectionSelection("sección 2", SAMPLE_OVERVIEW)).toEqual({
      extractedChapter: null,
      extractedVerse: 5,
      extractedVerseEnd: 9,
    });
    expect(resolveSectionSelection("sección 9", SAMPLE_OVERVIEW)).toBeNull();
    expect(resolveSectionSelection("next", SAMPLE_OVERVIEW)).toBeNull();
  });

  it("composes annotated passage from section selection + study ref", () => {
    const section = resolveSectionSelection(
      "quiero traducir la sección 1",
      SAMPLE_OVERVIEW,
    );
    expect(section).not.toBeNull();
    const composed = composeRelativeReference(
      {
        extractedBook: null,
        extractedChapter: section!.extractedChapter,
        extractedVerse: section!.extractedVerse,
        extractedVerseEnd: section!.extractedVerseEnd,
      },
      "TIT 1",
      resolveBook,
    );
    expect(composed).toEqual({
      reference: "TIT 1:1-4",
      intent: "annotated_passage",
    });
  });
});

describe("extractReferenceInfo passage hints", () => {
  it("parses Passage: TIT 1 hints used by relative-ref composition", () => {
    expect(
      extractReferenceInfo("continuemos con el capítulo 1\n\nPassage: TIT 1"),
    ).toMatchObject({ ref: "TIT 1", isLargeRange: true });
  });

  it("parses bracketed Passage hints after punctuation strip", () => {
    expect(extractReferenceInfo("[Passage: TIT 1]")).toMatchObject({
      ref: "TIT 1",
      isLargeRange: true,
    });
  });
});

describe("parsePositiveInt", () => {
  it("accepts positive ints and numeric strings", () => {
    expect(parsePositiveInt(1)).toBe(1);
    expect(parsePositiveInt("3")).toBe(3);
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt("null")).toBeNull();
  });
});
