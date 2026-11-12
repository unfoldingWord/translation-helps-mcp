import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { formatQuoteDisplay } from "@translation-helps/door43";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import { resetWarnOnceForTests } from "../../src/packs3/keys";
import {
  buildNotesAnswer,
  notesFromPacks3,
  wordLinksFromPacks3,
  VERIFIED_NOTES,
} from "../../src/packs3/adapters/helps";
import { answerFromPacks3 } from "../../src/packs3/answer";

const STAGING =
  "78d2e6299a2de4d0:c2057cec32b948452849e7fcba6af323961a091ea82645eb297bb368e1c8d911";
const DIR = join(__dirname, "..", "fixtures", "packs3");

function env(): Packs3Env {
  const objects: Record<string, Uint8Array> = {};
  for (const d of ["catalog", "seg"]) {
    for (const f of readdirSync(join(DIR, "v3", d))) {
      objects[`v3/${d}/${f}`] = new Uint8Array(
        readFileSync(join(DIR, "v3", d, f)),
      );
    }
  }
  const bucket = {
    async get(key: string) {
      const bytes = objects[key];
      if (!bytes) return null;
      return {
        key,
        etag: `e-${key}`,
        size: bytes.length,
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
  };
  return {
    LANGUAGE_PACKS: bucket as unknown as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
  };
}

type Row = Record<string, unknown>;
type Live = {
  chapters: Record<string, { source: unknown; notes: Row[]; wordLinks: Row[] }>;
};
// Today's answers of the API Worker, read 2026-11-12 (scripts/fetch-packs3-live.mjs): whole chapters.
const live = (name: string): Live =>
  JSON.parse(readFileSync(join(DIR, "live", `${name}.json`), "utf8"));
const enTit = live("en-tit");
const esTit = live("es-419-tit");
const esRut = live("es-419-rut");

const liveLinks = (l: Live, ch: string, verse?: string) =>
  l.chapters[ch].wordLinks.filter((r) => !verse || r.verse === verse);
const withoutBody = ({ note, noteSha, noteLinks, heading, ...row }: Row) => {
  void note;
  void noteSha;
  void noteLinks;
  void heading;
  return row;
};
const indexLink = (r: Row) => ({
  book: r.book,
  chapter: r.chapter,
  verse: r.verse,
  twId: r.twId,
  supportReference: r.supportReference,
  origWords: formatQuoteDisplay(String(r.origWords)),
  occurrence: r.occurrence,
  twLink: r.twLink,
  wordPath: r.wordPath,
  twTitle: r.twTitle,
});

beforeEach(() => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  resetWarnOnceForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("word links", () => {
  it("en TIT 1:1: the first two rows field by field, and the count", async () => {
    const got = (await wordLinksFromPacks3(env(), {
      reference: "Tit 1:1",
      language: "en",
    })) as Row & { wordLinks: Row[] };
    expect(got.wordLinks).toHaveLength(11);
    expect(got.wordLinks.slice(0, 2)).toEqual([
      {
        book: "",
        chapter: "1",
        verse: "1",
        twId: "trr8",
        supportReference: "",
        origWords: "Παῦλος",
        occurrence: "1",
        twLink: "rc://*/tw/dict/bible/names/paul",
        wordPath: "bible/names/paul",
        twTitle: "Paul, Saul",
        gatewayQuote: { original: "Παῦλος", aligned: "Paul" },
      },
      {
        book: "",
        chapter: "1",
        verse: "1",
        twId: "zfgc",
        supportReference: "",
        origWords: "δοῦλος",
        occurrence: "1",
        twLink: "rc://*/tw/dict/bible/other/servant",
        wordPath: "bible/other/servant",
        twTitle: "servant, serve, maidservant, young man, young women",
        gatewayQuote: { original: "δοῦλος", aligned: "a servant" },
      },
    ]);
    expect(got).toEqual({
      reference: "Tit 1:1",
      language: "en",
      book: "TIT",
      chapter: "1",
      verse: "1",
      wordLinks: liveLinks(enTit, "1", "1"),
      meta: { cache: "pack" },
    });
  });

  it("every chapter of en and es-419 TIT equals the live rows, row by row", async () => {
    for (const [lang, l] of [
      ["en", enTit],
      ["es-419", esTit],
    ] as const) {
      for (const ch of ["1", "2", "3"]) {
        const got = (await wordLinksFromPacks3(env(), {
          reference: `Tit ${ch}`,
          language: lang,
        })) as { wordLinks: Row[] };
        expect(got.wordLinks, `${lang} ${ch}`).toEqual(liveLinks(l, ch));
      }
    }
  });

  it("a verse range keeps the rows that overlap it", async () => {
    const got = (await wordLinksFromPacks3(env(), {
      reference: "Tit 2:3-5",
      language: "es-419",
    })) as { verse: string; wordLinks: Row[] };
    // The route echoes the first verse of the range.
    expect(got.verse).toBe("3");
    expect(got.wordLinks).toEqual(
      liveLinks(esTit, "2").filter((r) =>
        ["3", "4", "5"].includes(String(r.verse)),
      ),
    );
    expect(got.wordLinks.length).toBeGreaterThan(0);
  });

  it("answers `es` with the resolved language, like the route", async () => {
    const got = (await wordLinksFromPacks3(env(), {
      reference: "Tit 1:1",
      language: "es",
    })) as { language: string; wordLinks: Row[] };
    expect(got.language).toBe("es-419");
    expect(got.wordLinks).toEqual(liveLinks(esTit, "1", "1"));
  });

  it("en TIT whole book with fields=index: the compact rows of the route, every one of them", async () => {
    const got = (await wordLinksFromPacks3(env(), {
      reference: "Tit",
      language: "en",
      fields: "index",
    })) as Row & { wordLinks: Row[] };
    const expected = ["1", "2", "3"].flatMap((ch) =>
      liveLinks(enTit, ch).map(indexLink),
    );
    expect(got.wordLinks).toHaveLength(182);
    expect(got).toEqual({
      reference: "Tit",
      language: "en",
      book: "TIT",
      chapter: "*",
      verse: null,
      wordLinks: expected,
      meta: { cache: "pack" },
    });
  });

  it("an Old Testament book gives undefined without fields=index: its aligned words differ from the route's in some rows", async () => {
    expect(
      await wordLinksFromPacks3(env(), {
        reference: "Rut 1:1",
        language: "es-419",
      }),
    ).toBeUndefined();
  });

  it("an Old Testament book answers fields=index (no aligned words in it)", async () => {
    const got = (await wordLinksFromPacks3(env(), {
      reference: "Rut",
      language: "es-419",
      fields: "index",
    })) as { wordLinks: Row[] };
    expect(got.wordLinks).toHaveLength(296);
    expect(got.wordLinks[0]).toEqual(
      indexLink(esRut.chapters["1"].wordLinks[0]),
    );
  });
});

describe("notes", () => {
  const sha = (s: string) => createHash("sha1").update(s).digest("hex");

  it("en TIT 1:1: every field but the body of the rows equals the route's; the counts match", async () => {
    const built = await buildNotesAnswer(env(), {
      reference: "Tit 1:1",
      language: "en",
    });
    expect(built).toBeDefined();
    const rows = (built!.answer as { notes: Row[] }).notes;
    const want = enTit.chapters["1"].notes.filter(
      (r) => r.chapter === "front" || r.verse === "intro" || r.verse === "1",
    );
    expect(rows).toHaveLength(6);
    expect(want).toHaveLength(6);
    expect(rows.map(withoutBody)).toEqual(want.map(withoutBody));
    // The first two rows are the book and chapter introductions, as today.
    expect(rows.slice(0, 2).map((r) => [r.chapter, r.verse, r.id])).toEqual([
      ["front", "intro", "m2jl"],
      ["1", "intro", "c7me"],
    ]);
    expect(rows[2]).toMatchObject({
      book: "",
      chapter: "1",
      verse: "1",
      id: "rtc9",
      supportReference: "rc://*/ta/man/translate/figs-abstractnouns",
      quote: "κατὰ πίστιν ἐκλεκτῶν Θεοῦ, καὶ ἐπίγνωσιν ἀληθείας",
      occurrence: "1",
      supportReferenceTitle: "Abstract Nouns",
      gatewayQuote: {
        original: "κατὰ πίστιν ἐκλεκτῶν Θεοῦ, καὶ ἐπίγνωσιν ἀληθείας",
        aligned:
          "for the faith of the chosen people of God and knowledge of the truth",
      },
    });
    expect(built!.answer).toMatchObject({
      reference: "Tit 1:1",
      language: "en",
      book: "TIT",
      chapter: "1",
      verse: "1",
      source: {
        owner: "unfoldingWord",
        repo: "en_tn",
        version: "v91",
        language: "en",
      },
      meta: { cache: "pack" },
    });
  });

  it("a body is the route's exactly when it has no link markup; a body with links is flagged, never answered", async () => {
    for (const [lang, l] of [
      ["en", enTit],
      ["es-419", esTit],
    ] as const) {
      for (let c = 1; c <= 3; c++) {
        const built = await buildNotesAnswer(env(), {
          reference: `Tit ${c}`,
          language: lang,
        });
        expect(built, `${lang} ${c}`).toBeDefined();
        const rows = (built!.answer as { notes: (Row & { note: string })[] })
          .notes;
        const want = l.chapters[String(c)].notes;
        expect(rows.map((r) => r.id)).toEqual(want.map((r) => r.id));
        rows.forEach((r, i) => {
          if (!want[i].noteLinks) {
            expect(sha(r.note), `${lang} ${r.id}`).toBe(want[i].noteSha);
          }
        });
        expect(built!.exact).toBe(!want.some((r) => r.noteLinks));
      }
    }
  });

  it("the adapter gives undefined when a returned body has link markup (en TIT 1:1 has)", async () => {
    expect(
      await notesFromPacks3(env(), { reference: "Tit 1:1", language: "en" }),
    ).toBeUndefined();
  });

  it("en TIT whole book with fields=index: counts, the front:intro row and every row", async () => {
    const got = (await notesFromPacks3(env(), {
      reference: "Tit",
      language: "en",
      fields: "index",
    })) as Row & { notes: Row[] };
    const seen = new Set<unknown>();
    const expected = ["1", "2", "3"]
      .flatMap((ch) => enTit.chapters[ch].notes)
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map((r) => ({
        book: r.book,
        chapter: r.chapter,
        verse: r.verse,
        id: r.id,
        supportReference: r.supportReference,
        supportReferenceTitle: r.supportReferenceTitle,
        quote: r.quote ? formatQuoteDisplay(String(r.quote)) : r.quote,
        occurrence: r.occurrence,
        ...(r.heading ? { heading: r.heading } : {}),
      }));
    expect(got.notes).toHaveLength(206);
    expect(got.notes[0]).toEqual({
      book: "",
      chapter: "front",
      verse: "intro",
      id: "m2jl",
      supportReference: "",
      supportReferenceTitle: null,
      quote: "",
      occurrence: "0",
      heading: "Introduction to Titus",
    });
    expect(got).toEqual({
      reference: "Tit",
      language: "en",
      book: "TIT",
      chapter: "*",
      verse: null,
      notes: expected,
      source: {
        owner: "unfoldingWord",
        repo: "en_tn",
        version: "v91",
        language: "en",
      },
      meta: { cache: "pack" },
    });
  });

  it("es-419 RUT whole book with fields=index (Hebrew original): counts and rows equal the route's", async () => {
    const got = (await notesFromPacks3(env(), {
      reference: "Rut",
      language: "es-419",
      fields: "index",
    })) as { notes: Row[]; source: unknown };
    const seen = new Set<unknown>();
    const expected = ["1", "2", "3", "4"]
      .flatMap((ch) => esRut.chapters[ch].notes)
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    expect(got.notes).toHaveLength(272);
    expect(got.notes.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(got.notes.map((r) => r.supportReferenceTitle)).toEqual(
      expected.map((r) => r.supportReferenceTitle),
    );
    expect(got.notes.map((r) => r.heading)).toEqual(
      expected.map((r) => r.heading),
    );
    expect(got.source).toEqual({
      owner: "es-419_gl",
      repo: "es-419_tn",
      version: "v66",
      language: "es-419",
    });
  });

  it("es-419 RUT 1:1 notes give undefined: its aligned quotes differ from the route's in some rows of the book", async () => {
    expect(
      await notesFromPacks3(env(), {
        reference: "Rut 1:1",
        language: "es-419",
      }),
    ).toBeUndefined();
  });

  it("es-419 TIT 1:1: every verse row, alignedQuote included, equals the route's", async () => {
    const built = await buildNotesAnswer(env(), {
      reference: "Tit 1:1",
      language: "es-419",
    });
    const rows = (built!.answer as { notes: Row[] }).notes;
    const want = esTit.chapters["1"].notes.filter(
      (r) => r.chapter === "front" || r.verse === "intro" || r.verse === "1",
    );
    expect(rows.map(withoutBody)).toEqual(want.map(withoutBody));
    expect(
      rows.filter((r) => (r.gatewayQuote as Row).aligned !== "").length,
    ).toBeGreaterThan(3);
  });
});

describe("fallbacks", () => {
  it.each([
    ["a book alone, no fields", { reference: "Tit", language: "en" }],
    ["a range across chapters", { reference: "Tit 1:15-2:3", language: "en" }],
    ["a language with no catalog", { reference: "Tit 1:1", language: "fr" }],
    [
      "a book the language does not list",
      { reference: "Mat 5:1", language: "es-419" },
    ],
    [
      "a reference that does not parse",
      { reference: "nonsense", language: "en" },
    ],
    ["OBS", { reference: "OBS 3:5", language: "en" }],
    ["no reference", { reference: "", language: "en" }],
  ])("word links: undefined for %s", async (_n, params) => {
    expect(await wordLinksFromPacks3(env(), params)).toBeUndefined();
  });

  it.each([
    ["a book alone, no fields", { reference: "Tit", language: "en" }],
    ["a range across chapters", { reference: "Tit 1:15-2:3", language: "en" }],
    [
      "a language with no catalog",
      { reference: "Tit", language: "fr", fields: "index" },
    ],
    [
      "a book the language does not list",
      { reference: "Mat", language: "es-419", fields: "index" },
    ],
    ["OBS", { reference: "OBS", language: "en", fields: "index" }],
  ])("notes: undefined for %s", async (_n, params) => {
    expect(await notesFromPacks3(env(), params)).toBeUndefined();
  });

  it("notes: undefined, warning once, when the notes resource is not in the verified table", async () => {
    VERIFIED_NOTES.delete("unfoldingWord/en/tn");
    try {
      const params = { reference: "Tit", language: "en", fields: "index" };
      expect(await notesFromPacks3(env(), params)).toBeUndefined();
      expect(await notesFromPacks3(env(), params)).toBeUndefined();
      const warns = (
        console.warn as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter(
        (c) =>
          (c[1] as { reason?: string } | undefined)?.reason ===
          "unverified-resource",
      );
      expect(warns).toHaveLength(1);
    } finally {
      VERIFIED_NOTES.add("unfoldingWord/en/tn");
    }
  });
});

describe("registered adapters", () => {
  it("answers /api/v1/word-links and /api/v1/notes (fields=index) through answerFromPacks3", async () => {
    const wl = (await answerFromPacks3(env(), "/api/v1/word-links", {
      reference: "Tit 1:1",
      language: "en",
    })) as { meta: unknown; wordLinks: unknown[] } | undefined;
    expect(wl?.meta).toEqual({ cache: "pack" });
    expect(wl?.wordLinks).toHaveLength(11);
    const n = (await answerFromPacks3(env(), "/api/v1/notes", {
      reference: "Tit",
      language: "en",
      fields: "index",
    })) as { notes: unknown[] } | undefined;
    expect(n?.notes).toHaveLength(206);
    expect(
      await answerFromPacks3(env(), "/api/v1/notes", {
        reference: "Tit 1:1",
        language: "en",
      }),
    ).toBeUndefined();
  });
});
