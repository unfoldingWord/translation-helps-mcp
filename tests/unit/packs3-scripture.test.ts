import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import {
  BOOKS,
  bookTooLarge,
  catalogEntryOf,
  scriptureFromPacks3,
  verseText,
} from "../../src/packs3/adapters/scripture";
import { scriptureVersionsForBook } from "../../src/api/routes/scripture";
import { answerFromPacks3 } from "../../src/packs3/answer";
import { setVerifiedForTests } from "../../src/packs3/verified";
import { injectFixtureProofs } from "./packs3-fixture-verified";

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

beforeEach(async () => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  await injectFixtureProofs(env());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// The expected answers are the API Worker's own, read on 2026-11-12 (/api/v1/scripture, text, no `all`).
describe("scriptureFromPacks3", () => {
  it("es-419 TIT 1:1, every field", async () => {
    const got = await scriptureFromPacks3(env(), {
      reference: "Tit 1:1",
      language: "es-419",
    });
    expect(got).toEqual({
      reference: "Tit 1:1",
      language: "es-419",
      book: "TIT",
      chapter: "1",
      verse: "1",
      format: "text",
      versions: [
        {
          resourceType: "tpl",
          role: "literal",
          text: "1 Pablo, siervo de Dios y apóstol de Jesucristo, conforme a la fe de los elegidos de Dios y al conocimiento de la verdad que es de acuerdo con la piedad,",
          source: "https://git.door43.org/es-419_gl/es-419_glt/archive/v42.zip",
        },
        {
          resourceType: "gst",
          role: "simplified",
          text: "1 Yo, Pablo, te escribo esta carta, Tito. Soy servidor de Dios y apóstol de Jesús el Mesías. Dios me envió a enseñar al pueblo que él ha escogido como suyo para que confíe más en él. Trabajo para ayudar a su pueblo a saber lo que es verdad, para que puedan vivir de forma que agrade a Dios,",
          source: "https://git.door43.org/es-419_gl/es-419_gst/archive/v40.zip",
        },
        {
          resourceType: "ugnt",
          role: "original",
          text: "1 Παῦλος, δοῦλος Θεοῦ, ἀπόστολος δὲ Ἰησοῦ Χριστοῦ, κατὰ πίστιν ἐκλεκτῶν Θεοῦ, καὶ ἐπίγνωσιν ἀληθείας, τῆς κατ’ εὐσέβειαν",
          source:
            "https://git.door43.org/unfoldingWord/el-x-koine_ugnt/archive/v0.34.zip",
        },
      ],
      meta: { cache: "pack" },
    });
  });

  // Read from the API Worker on 2026-11-15: an Old Testament verse, with the Hebrew original.
  it("es-419 RUT 1:3, every field (Old Testament)", async () => {
    const got = await scriptureFromPacks3(env(), {
      reference: "RUT 1:3",
      language: "es-419",
    });
    expect(got).toEqual({
      reference: "RUT 1:3",
      language: "es-419",
      book: "RUT",
      chapter: "1",
      verse: "3",
      format: "text",
      versions: [
        {
          resourceType: "tpl",
          role: "literal",
          text: "3 Entonces Elimelec, el esposo de Noemí, murió. Y fue dejada ella con sus dos hijos.",
          source: "https://git.door43.org/es-419_gl/es-419_glt/archive/v42.zip",
        },
        {
          resourceType: "gst",
          role: "simplified",
          text: "3 Entonces Elimelec, el esposo de Noemí, murió y solamente quedó ella con sus dos hijos.",
          source: "https://git.door43.org/es-419_gl/es-419_gst/archive/v40.zip",
        },
        {
          resourceType: "uhb",
          role: "original",
          text: "3 \u05d5\u05b7\u2060\u05d9\u05bc\u05b8\u05a5\u05de\u05b8\u05ea \u05d0\u05b1\u05dc\u05b4\u05d9\u05de\u05b6\u0596\u05dc\u05b6\u05da\u05b0 \u05d0\u05b4\u05a3\u05d9\u05e9\u05c1 \u05e0\u05b8\u05e2\u05b3\u05de\u05b4\u0591\u05d9 \u05d5\u05b7\u2060\u05ea\u05bc\u05b4\u05e9\u05c1\u05bc\u05b8\u05d0\u05b5\u05a5\u05e8 \u05d4\u05b4\u0596\u05d9\u05d0 \u05d5\u05bc\u2060\u05e9\u05c1\u05b0\u05e0\u05b5\u05a5\u05d9 \u05d1\u05b8\u05e0\u05b6\u05bd\u05d9\u2060\u05d4\u05b8\u05c3",
          source:
            "https://git.door43.org/unfoldingWord/hbo_uhb/archive/v3.0.0.zip",
        },
      ],
      meta: { cache: "pack" },
    });
  });

  it("en TIT 1:1-3, every field", async () => {
    const got = await scriptureFromPacks3(env(), {
      reference: "Tit 1:1-3",
      language: "en",
    });
    expect(got).toEqual({
      reference: "Tit 1:1-3",
      language: "en",
      book: "TIT",
      chapter: "1",
      verse: "1-3",
      format: "text",
      versions: [
        {
          resourceType: "ult",
          role: "literal",
          text: "1 Paul, a servant of God and an apostle of Jesus Christ, for the faith of the chosen people of God and knowledge of the truth that agrees with godliness, 2 with the certain hope of eternal life that the non-lying God promised before all the ages of time. 3 But at the right time, he revealed his word by the proclamation, the one I was entrusted with by the command of God our Savior.",
          source: "https://git.door43.org/unfoldingWord/en_ult/archive/v91.zip",
        },
        {
          resourceType: "ust",
          role: "simplified",
          text: "1 I, Paul, {write this letter to you, Titus. I} am a servant of God and a representative of Jesus the Messiah. God sent me to teach the people whom he has chosen as his own to trust him more. I work to help his people to know what is true, so that they can live in a way that pleases God. 2 His people can learn how to live like this because they are confident that God will cause them to live forever. Even before the world began, God promised to cause us to live forever, and God does not lie. 3 Then, in God’s own timing, he communicated his plan through this message that he trusted me to preach. I do this in order to obey the command of God, who saves us.",
          source: "https://git.door43.org/unfoldingWord/en_ust/archive/v91.zip",
        },
        {
          resourceType: "ugnt",
          role: "original",
          text: "1 Παῦλος, δοῦλος Θεοῦ, ἀπόστολος δὲ Ἰησοῦ Χριστοῦ, κατὰ πίστιν ἐκλεκτῶν Θεοῦ, καὶ ἐπίγνωσιν ἀληθείας, τῆς κατ’ εὐσέβειαν 2 ἐπ’ ἐλπίδι ζωῆς αἰωνίου, ἣν ἐπηγγείλατο ὁ ἀψευδὴς Θεὸς πρὸ χρόνων αἰωνίων, 3 ἐφανέρωσεν δὲ καιροῖς ἰδίοις τὸν λόγον αὐτοῦ ἐν κηρύγματι, ὃ ἐπιστεύθην ἐγὼ, κατ’ ἐπιταγὴν τοῦ Σωτῆρος ἡμῶν, Θεοῦ;",
          source:
            "https://git.door43.org/unfoldingWord/el-x-koine_ugnt/archive/v0.34.zip",
        },
      ],
      meta: { cache: "pack" },
    });
  });

  it("gives the same answer for `es` as for es-419, with the resolved language", async () => {
    const got = await scriptureFromPacks3(env(), {
      reference: "Tit 1:1",
      language: "es",
    });
    expect(got?.language).toBe("es-419");
    expect(got?.versions.map((v) => v.resourceType)).toEqual([
      "tpl",
      "gst",
      "ugnt",
    ]);
  });

  it.each([
    ["format usfm", { reference: "Tit 1:1", language: "en", format: "usfm" }],
    ["OBS", { reference: "OBS 3:5", language: "en" }],
    [
      "a book es-419 does not list",
      { reference: "Mat 5:1", language: "es-419" },
    ],
    ["a language with no catalog", { reference: "Tit 1:1", language: "fr" }],
    ["a whole chapter", { reference: "Tit 1", language: "en" }],
    ["a range across chapters", { reference: "Tit 1:15-2:3", language: "en" }],
    [
      "a verse the book does not have",
      { reference: "Tit 1:99", language: "en" },
    ],
    [
      "a chapter the book does not have",
      { reference: "Tit 9:1", language: "en" },
    ],
    [
      "a reference that does not parse",
      { reference: "nonsense", language: "en" },
    ],
    ["all=1", { reference: "Tit 1:1", language: "en", all: "1" }],
  ])("returns undefined for %s", async (_name, params) => {
    expect(await scriptureFromPacks3(env(), params)).toBeUndefined();
  });
});

describe("verified resources", () => {
  it("falls back, warning once, when a picked resource has no proof", async () => {
    await injectFixtureProofs(env(), (t) => {
      for (const k of Object.keys(t)) if (k.includes("/en/ust|")) delete t[k];
    });
    try {
      const params = { reference: "Tit 1:1", language: "en" };
      expect(await scriptureFromPacks3(env(), params)).toBeUndefined();
      expect(await scriptureFromPacks3(env(), params)).toBeUndefined();
      const warns = (
        console.warn as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter(
        (c) =>
          (c[1] as { reason?: string } | undefined)?.reason ===
          "unverified-resource",
      );
      expect(warns).toHaveLength(1);
    } finally {
      setVerifiedForTests(undefined);
    }
  });

  it("falls back on an Old Testament verse the sweep listed as an exception", async () => {
    // RUT 1:1: the route's Hebrew keeps a USFM blank line ("\n ") that format 3 does not have.
    await injectFixtureProofs(env(), (t) => {
      for (const k of Object.keys(t))
        if (k.includes("/es-419/glt|")) t[k]!.exceptions = ["RUT 1:1"];
    });
    try {
      expect(
        await scriptureFromPacks3(env(), {
          reference: "Rut 1:1",
          language: "es-419",
        }),
      ).toBeUndefined();
      expect(
        await scriptureFromPacks3(env(), {
          reference: "Rut 1:3",
          language: "es-419",
        }),
      ).toBeDefined();
    } finally {
      setVerifiedForTests(undefined);
    }
  });

  // The sweep compares an OT chapter's range `C:1-N`; where the route's Hebrew keeps a USFM blank line (a newline and
  // a space) that range differs, so no sub-range of the chapter is proven, even of verses that are each clean.
  it("falls back on an Old Testament range in a chapter whose range is an exception", async () => {
    const rut34 = () =>
      scriptureFromPacks3(env(), {
        reference: "Rut 1:3-4",
        language: "es-419",
      });
    expect(await rut34()).toBeDefined();
    await injectFixtureProofs(env(), (t) => {
      for (const k of Object.keys(t))
        if (k.includes("/es-419/glt|")) t[k]!.exceptions = ["RUT 1:1,1-22"];
    });
    try {
      expect(await rut34()).toBeUndefined();
      expect(
        await scriptureFromPacks3(env(), {
          reference: "Rut 1:3",
          language: "es-419",
        }),
      ).toBeDefined();
    } finally {
      setVerifiedForTests(undefined);
    }
  });

  it("uses the table abbreviation where it differs from the resource id", async () => {
    const got = await scriptureFromPacks3(env(), {
      reference: "Tit 1:1",
      language: "es-419",
    });
    expect(got?.versions[0].resourceType).toBe("tpl");
    expect(got?.versions[0].source).toContain("es-419_glt");
  });
});

describe("registered adapter", () => {
  it("answers /api/v1/scripture through answerFromPacks3", async () => {
    const got = (await answerFromPacks3(env(), "/api/v1/scripture", {
      reference: "Tit 1:1",
      language: "es-419",
      format: "text",
    })) as { meta: { cache: string } } | undefined;
    expect(got?.meta).toEqual({ cache: "pack" });
  });
});

// MAT 5:3-5 of the staging en ULT (2026-11-13): format 3 lost the space after `\zaln-e\*` and the line ends, and the
// route shows the `\ts\*` blank line inside a range. Today's text: "3 “Blessed {are} the poor in spirit, for theirs ...".
const W = (t: string): [string, boolean] => [t, true];
const N = (t: string): [string, boolean] => [t, false];
const MAT5 = {
  pieces: [
    N("“"),
    W("Blessed"),
    N("{"),
    W("are"),
    N("} "),
    W("the"),
    N(" "),
    W("poor"),
    N(","),
    W("for"),
    N(" "),
    W("them"),
    N("."),
    W("Blessed"),
    N(" "),
    W("ones"),
    N(". "),
    W("Blessed"),
    N(" "),
    W("meek"),
    N("."),
  ],
  events: [
    [0, "chapter", "5"],
    [0, "open", "para:q1"],
    [0, "verse", "3"],
    [12, "open", "para:q1"],
    [12, "verse", "4"],
    [17, "open", "ms:ts"],
    [17, "close", ""],
    [17, "open", "para:q1"],
    [17, "verse", "5"],
  ] as [number, string, string][],
};

describe("verseText", () => {
  it("falls back when format 3 lost the space between a word and the next piece", () => {
    expect(verseText(MAT5, "5", 3, 3)).toBeUndefined();
  });

  it("falls back when a ts milestone falls between two verses of the range", () => {
    const clean = {
      pieces: [W("a"), N(" "), W("b"), N(". "), W("c"), N(".")],
      events: [
        [0, "chapter", "5"],
        [0, "verse", "4"],
        [4, "open", "ms:ts"],
        [4, "close", ""],
        [4, "verse", "5"],
      ] as [number, string, string][],
    };
    expect(verseText(clean, "5", 4, 4)).toBe("4 a b.");
    expect(verseText(clean, "5", 4, 5)).toBeUndefined();
  });
});

describe("verseText fails closed", () => {
  const unit = (...verses: string[]) => ({
    pieces: verses.map((v) => [`${v} text.`, false] as [string, boolean]),
    events: [
      [0, "chapter", "3"],
      ...verses.map((v, i) => [i, "verse", v] as [number, string, string]),
    ] as Array<[number, string, string]>,
  });
  it("returns every verse of a range it has", () => {
    expect(verseText(unit("14", "15"), "3", 14, 15)).toBe(
      "14 14 text. 15 15 text.",
    );
  });
  it("falls back when the range runs past the chapter's last verse (TIT 3:14-20)", () => {
    expect(verseText(unit("14", "15"), "3", 14, 20)).toBeUndefined();
  });
  it("falls back when a verse inside the range is missing", () => {
    expect(verseText(unit("14", "16"), "3", 14, 16)).toBeUndefined();
  });
  it("falls back when the first verse of the range is missing", () => {
    expect(verseText(unit("15", "16"), "3", 14, 16)).toBeUndefined();
  });
});

describe("verseText whitespace", () => {
  const unit = (...pieces: string[]) => ({
    pieces: pieces.map((w) => [w, false] as [string, boolean]),
    events: [
      [0, "chapter", "5"],
      [0, "verse", "3"],
    ] as Array<[number, string, string]>,
  });
  it("falls back on the glued shapes of the old builder (Task 11)", () => {
    expect(verseText(unit("Blessed", "{are}", "the poor"), "5", 3, 3)).toBe(
      undefined,
    );
    expect(verseText(unit("Blessed", "{are}the poor"), "5", 3, 3)).toBe(
      undefined,
    );
    expect(verseText(unit("spirit,for theirs"), "5", 3, 3)).toBe(undefined);
  });
  it("keeps a suffix the USFM really glues (bird{s})", () => {
    expect(verseText(unit("the bird", "{s}", " sing"), "5", 3, 3)).toBe(
      "3 the bird{s} sing",
    );
  });
  // en JHN 12:36 UGNT (API Worker, 2026-11-15): a `\p` inside the verse is a line break in the USFM, a space in
  // today's text: "36 ὡς τὸ φῶς ἔχετε, ... γένησθε. ταῦτα ἐλάλησεν Ἰησοῦς, ...".
  it("puts a space where a paragraph opens inside a verse", () => {
    const u = {
      pieces: [N("γένησθε."), N("ταῦτα ἐλάλησεν. ")],
      events: [
        [0, "chapter", "12"],
        [0, "verse", "36"],
        [1, "close", ""],
        [1, "open", "para:p"],
      ] as Array<[number, string, string]>,
    };
    expect(verseText(u, "12", 36, 36)).toBe("36 γένησθε. ταῦτα ἐλάλησεν.");
  });
  it("trims the blank a verse slice starts or ends with", () => {
    expect(verseText(unit(" \n", "word ", "\n"), "5", 3, 3)).toBe("3 word");
  });
});

describe("bookTooLarge", () => {
  const reader = (sizes: Record<string, number>) => ({
    unitOf: (cls: string, key: string) =>
      `${cls}:${key}` in sizes ? `${cls}:${key}` : undefined,
    size: (u: string) => sizes[u] ?? 0,
  });
  it("refuses a book whose text and originals pass the reader budget together (en Psalms)", () => {
    // staging en: book:psa 1097745 + orig:psa 418898 compressed bytes, about 80 MB of heap in one call
    expect(
      bookTooLarge(reader({ "book:psa": 1097745, "orig:psa": 418898 }), "psa"),
    ).toBe(true);
  });
  it("reads a book under the budget (en Matthew)", () => {
    expect(
      bookTooLarge(reader({ "book:mat": 670385, "orig:mat": 242959 }), "mat"),
    ).toBe(false);
  });
});

// es-419 EST 1:1 from the API Worker (2026-11-15): the GST lacks Esther, so the route picks the GLT alone and says why.
// The route reads a resource's book list from its ingredients; an empty list means "may have every book".
describe("catalogEntryOf", () => {
  const bits = (...codes: string[]) => {
    const b = new Uint8Array(9);
    for (const c of codes) {
      const i = BOOKS.indexOf(c);
      b[i >> 3]! |= 1 << (i & 7);
    }
    return b;
  };
  const glt = {
    key: "es-419_gl/es-419/glt",
    subject: "Aligned Bible",
    release: "v42",
    books: bits("rut", "est", "tit"),
  };
  const gst = {
    key: "es-419_gl/es-419/gst",
    subject: "Aligned Bible",
    release: "v40",
    books: bits("rut", "tit"),
  };
  it("lists every book the resource has, so the route's pick sees a book it lacks", () => {
    const d = scriptureVersionsForBook(
      [catalogEntryOf(glt), catalogEntryOf(gst)],
      "EST",
      "es-419",
      () => undefined,
    );
    expect(d.picked.map((e) => e.repo)).toEqual(["es-419_glt"]);
    expect(d.versionsNote).toBe(
      'The GST (simplified) does not include Esther yet, and no other "es-419" version has it.',
    );
  });
});
