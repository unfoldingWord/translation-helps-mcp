import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import {
  scriptureFromPacks3,
  verseText,
  VERIFIED,
} from "../../src/packs3/adapters/scripture";
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

beforeEach(() => {
  resetPacks3CachesForTests();
  resetReadersForTests();
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
      "an Old Testament book (Hebrew line breaks)",
      { reference: "Rut 1:1", language: "es-419" },
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
  it("falls back, warning once, when a picked resource is not in the table", async () => {
    const saved = VERIFIED["unfoldingWord/en/ust"];
    delete VERIFIED["unfoldingWord/en/ust"];
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
      VERIFIED["unfoldingWord/en/ust"] = saved;
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
