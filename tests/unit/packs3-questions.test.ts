import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  resetPacks3CachesForTests,
  type Packs3Env,
} from "../../src/packs3/catalogs";
import { resetReadersForTests } from "../../src/packs3/readers";
import { resetWarnOnceForTests } from "../../src/packs3/keys";
import {
  questionsFromPacks3,
  questionRefOf,
} from "../../src/packs3/adapters/questions";
import { injectFixtureProofs } from "./packs3-fixture-verified";
import { setVerifiedForTests } from "../../src/packs3/verified";
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
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
    },
  };
  return {
    LANGUAGE_PACKS: bucket as unknown as R2Bucket,
    PACKS_V3: "on",
    PACKS_V3_TRUSTED_KEYS: STAGING,
  };
}

type Answer = {
  questions: Array<Record<string, unknown>>;
} & Record<string, unknown>;
const ask = (reference: string, language: string) =>
  questionsFromPacks3(env(), { reference, language }) as Promise<
    Answer | undefined
  >;
const sha = (rows: Array<Record<string, unknown>>) =>
  createHash("sha1")
    .update(
      JSON.stringify(
        rows.map((r) => Object.fromEntries(Object.entries(r).sort())),
      ),
    )
    .digest("hex");

// Today's answers of the API Worker (GET /api/v1/questions, read 2026-11-12): whole chapters, as count and SHA-1 of the
// questions (keys sorted).
const LIVE: Array<[string, string, number, number, string]> = [
  ["en", "Tit", 1, 16, "a23afa289f075904425828b14f829ddff6901724"],
  ["en", "Tit", 2, 11, "f2c86a8f46df897cbcadfedde906494c3b4a7d81"],
  ["en", "Tit", 3, 9, "bae9be5612347331583ddc2b47e7156df62d81a8"],
  ["es-419", "Tit", 1, 16, "62a4b5c4af43918ee438de668e182c6cb16ae16e"],
  ["es-419", "Tit", 2, 11, "cd30b81b84a6b6e8b870e9181735e61ce4677660"],
  ["es-419", "Tit", 3, 9, "e60aafdbf4354bd3871df06b9a48e501dfc3b52e"],
  ["es-419", "Rut", 1, 13, "87349d71bf0bf203e1dc2f680ace8606e9c617b7"],
  ["es-419", "Rut", 2, 14, "4e5379f6acd5a2acfb4af3054a256836169c76ad"],
  ["es-419", "Rut", 3, 13, "576a6f8d97c82599e803f80755786605e7ac8056"],
  ["es-419", "Rut", 4, 16, "1a9f26a5e5c215c88df8bc1fcdf7ed83bb806841"],
];

beforeEach(async () => {
  resetPacks3CachesForTests();
  resetReadersForTests();
  resetWarnOnceForTests();
  await injectFixtureProofs(env());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("questions", () => {
  it("en TIT 1:1-3: every field of every record, and the source", async () => {
    expect(await ask("Tit 1:1-3", "en")).toEqual({
      reference: "Tit 1:1-3",
      language: "en",
      book: "TIT",
      chapter: "1",
      verse: "1",
      verseEnd: "3",
      questions: [
        {
          book: "",
          chapter: "1",
          verse: "1",
          id: "y5pp",
          question: "What was Paul’s purpose in his service to God?",
          response:
            "His purpose was to establish the faith of God’s chosen people and to establish the knowledge of the truth.",
        },
        {
          book: "",
          chapter: "1",
          verse: "2",
          id: "ymzh",
          question:
            "When did God promise everlasting life to his chosen people?",
          response: "He promised it to them before all the ages of time.",
        },
        {
          book: "",
          chapter: "1",
          verse: "2",
          id: "eauf",
          question: "Does God lie?",
          response: "No.",
        },
        {
          book: "",
          chapter: "1",
          verse: "3",
          id: "sens",
          question:
            "To whom did God entrust his proclamation at the right time?",
          response: "God entrusted it to the apostle Paul.",
        },
      ],
      source: {
        owner: "unfoldingWord",
        repo: "en_tq",
        version: "v91",
        language: "en",
      },
      meta: { cache: "pack" },
    });
  });

  it("every chapter of en TIT, es-419 TIT and RUT equals the live questions", async () => {
    for (const [lang, book, ch, count, hash] of LIVE) {
      const got = await ask(`${book} ${ch}`, lang);
      expect(got, `${lang} ${book} ${ch}`).toBeDefined();
      expect(got!.questions).toHaveLength(count);
      expect(sha(got!.questions), `${lang} ${book} ${ch}`).toBe(hash);
      expect(got).toMatchObject({
        chapter: String(ch),
        verse: null,
        verseEnd: null,
      });
    }
  });

  it("es-419 RUT 1: the count and the source", async () => {
    const got = await ask("Rut 1", "es-419");
    expect(got!.questions).toHaveLength(13);
    expect(got!.source).toEqual({
      owner: "es-419_gl",
      repo: "es-419_tq",
      version: "v38",
      language: "es-419",
    });
  });

  it("`es` answers with the resolved language, like the route", async () => {
    const got = await ask("Tit 2", "es");
    expect(got!.language).toBe("es-419");
    expect(got!.questions).toHaveLength(11);
  });

  it("a verse keeps the questions that cover it", async () => {
    const got = await ask("Tit 1:2", "en");
    expect(got!.questions.map((q) => q.id)).toEqual(["ymzh", "eauf"]);
    expect(got).toMatchObject({ verse: "2", verseEnd: null });
  });

  it("is answered through answerFromPacks3", async () => {
    const got = (await answerFromPacks3(env(), "/api/v1/questions", {
      reference: "Tit 1:1",
      language: "en",
    })) as Answer;
    expect(got.questions).toHaveLength(1);
  });

  it("gives undefined for what the route could answer in another shape", async () => {
    // OBS, study questions, a format other than the default, a whole book, a range across chapters.
    expect(await ask("OBS 1:1", "en")).toBeUndefined();
    expect(
      await answerFromPacks3(env(), "/api/v1/questions", {
        reference: "Tit 1:1",
        language: "en",
        format: "usfm",
      }),
    ).toBeUndefined();
    expect(await ask("Tit", "en")).toBeUndefined();
    expect(await ask("Tit 1:1-2:3", "en")).toBeUndefined();
    expect(await ask("", "en")).toBeUndefined();
    expect(await ask("Tit 1", "")).toBeUndefined();
    expect(
      await answerFromPacks3(env(), "/api/v1/questions", {
        reference: "OBS 1:1",
        language: "en",
        resourceType: "study-questions",
      }),
    ).toBeUndefined();
  });

  it("gives undefined for a book the pack lacks and a language it lacks", async () => {
    expect(await ask("Gen 1", "en")).toBeUndefined();
    expect(await ask("Tit 1", "fr")).toBeUndefined();
  });

  it("sweep: a listed chapter serves; a release bump, an exception and an unlisted chapter fall back", async () => {
    expect(await ask("Tit 1", "en")).toBeDefined();
    // Not listed (the sweep did not record chapter 9).
    expect(await ask("Tit 9", "en")).toBeUndefined();
    // An exception item.
    await injectFixtureProofs(env(), (t) => {
      for (const [k, e] of Object.entries(t))
        if (k.includes("/en/tq|")) e.exceptions = ["TIT 2"];
    });
    expect(await ask("Tit 2", "en")).toBeUndefined();
    expect(await ask("Tit 1", "en")).toBeDefined();
    // A release bump: no entry for the catalog's release.
    await injectFixtureProofs(env(), (t) => {
      for (const k of Object.keys(t))
        if (k.includes("/en/tq|")) {
          t[k.replace(/\|[^|]*\|questions$/, "|v0-bumped|questions")] = t[k]!;
          delete t[k];
        }
    });
    expect(await ask("Tit 1", "en")).toBeUndefined();
    const warns = (
      console.warn as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.filter(
      (c) =>
        (c[1] as { reason?: string } | undefined)?.reason ===
        "unverified-resource",
    );
    expect(warns.length).toBeGreaterThan(0);
  });

  it("a comma list reference keeps its tail like the route", () => {
    const row = (ref: string, from: number, to: number) =>
      ({ id: "x", ref, from, to, cols: {} }) as never;
    expect(questionRefOf(row("6:9,11", 20006009, 20006011))).toEqual({
      chapter: "6",
      verse: "9,11",
    });
    expect(questionRefOf(row("18:17,25-26", 43018017, 43018026))).toEqual({
      chapter: "18",
      verse: "17,25-26",
    });
    expect(questionRefOf(row("1:2-3", 1001002, 1001003))).toEqual({
      chapter: "1",
      verse: "2-3",
    });
    expect(questionRefOf(row("6:9,11", 20006009, 20006012))).toBeUndefined();
    expect(questionRefOf(row("6:intro", 20006001, 20006001))).toBeUndefined();
  });
});
