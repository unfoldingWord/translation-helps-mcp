/**
 * What a parts list is built from, read now: the language's Door43 rows, UHB and UGNT, the two lexicons and MACULA,
 * keyed and stamped exactly as tc-study's build writes them into `PartsList.stamps`. The expected strings are copied
 * from tc-study's own tests (cited at each), so a drift on either side fails here, not in a build loop.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import {
  PARTS_SUBJECTS,
  isObsRow,
  languageStamps,
  lexiconStampOf,
  literalOwnerOf,
  maculaStampOf,
  observeParts,
} from "../../src/packs/partsSources";
import type { FreshnessEnv } from "../../src/packs/freshness";

const LANG = "es-419";
const NOW = new Date("2026-10-21T10:00:00Z");
const MINUTE = 60_000;
const RELEASE = "v12#2026-09-01T00_00_00Z";

// tc-study packages/resource-pipeline/src/language/partsFixture.ts
const GLT = "test_gl/es-419/glt";
const GST = "test_gl/es-419/gst";
const TN = "test_gl/es-419/tn";
const TWL = "test_gl/es-419/twl";
const TW = "test_gl/es-419/tw";
const TQ = "test_gl/es-419/tq";
const TA = "test_gl/es-419/ta";
const UHL = "test_gl/es-419/uhl";
const UHB = "unfoldingWord/hbo/uhb";
const UGNT = "unfoldingWord/el-x-koine/ugnt";
// partsFixture.ts UHL_COMMIT
const UHL_COMMIT = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  created: "2026-07-01T00:00:00Z",
};
const MACULA_SHA = "abc1234567" + "0".repeat(30);

function row(
  name: string,
  subject: string,
  stamp = RELEASE,
  o: { owner?: string; language?: string } = {},
): CatalogEntry {
  return {
    owner: o.owner ?? "test_gl",
    repo: name,
    name,
    subject,
    language: o.language ?? LANG,
    stamp,
    ingredients: [],
  };
}

const ROWS: CatalogEntry[] = [
  row("es-419_glt", "Aligned Bible"),
  row("es-419_gst", "Aligned Bible"),
  row("es-419_tn", "TSV Translation Notes"),
  row("es-419_tq", "TSV Translation Questions"),
  row("es-419_twl", "TSV Translation Words Links"),
  row("es-419_tw", "Translation Words"),
  row("es-419_ta", "Translation Academy"),
  row("es-419_obs", "Open Bible Stories"),
  // A lexicon in the search is stamped by its commit, never by its catalog row.
  row("es-419_uhl", "Hebrew Lexicon"),
  row("en_ult", "Aligned Bible", "v86#2026-01-01T00_00_00Z", {
    owner: "unfoldingWord",
    language: "en",
  }),
];

/** Door43's catalog hit for an original, as tc-study's ensureOriginalLanguageInCatalog reads it. */
function originalHit(lang: string, name: string, subject: string) {
  return {
    owner: "unfoldingWord",
    name,
    language: lang,
    subject,
    release: { tag_name: "v2.1.30", published_at: "2026-09-01T00:00:00Z" },
  };
}

type Answer = { status: number; body?: unknown };

function fakeKv() {
  const values = new Map<string, string>();
  const puts: Array<{ key: string; ttl?: number }> = [];
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, o?: { expirationTtl?: number }) {
      values.set(key, value);
      puts.push({ key, ttl: o?.expirationTtl });
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, values, puts };
}

/**
 * Door43 and GitHub in memory. `lexicons` answers the commits of a repository (`owner/name`), which exists when it is
 * there (`lexiconRepos` overrides the repository's own status); the originals answer by language, `github` by path.
 * Every URL asked is recorded with its Authorization header.
 */
function network(
  o: {
    lexicons?: Record<string, Answer>;
    lexiconRepos?: Record<string, number>;
    originals?: Partial<Record<"hbo" | "el-x-koine", Answer>>;
    github?: Partial<Record<"public/trees" | "public/referents", Answer>>;
    token?: Answer;
  } = {},
) {
  const asked: Array<{ url: string; auth: string | null }> = [];
  const lexicons: Record<string, Answer> = o.lexicons ?? {
    "test_gl/es-419_uhl": { status: 200, body: [UHL_COMMIT] },
  };
  const originals = {
    hbo: {
      status: 200,
      body: {
        ok: true,
        data: [originalHit("hbo", "hbo_uhb", "Hebrew Old Testament")],
      },
    },
    "el-x-koine": {
      status: 200,
      body: {
        ok: true,
        data: [
          originalHit("el-x-koine", "el-x-koine_ugnt", "Greek New Testament"),
        ],
      },
    },
    ...o.originals,
  };
  const github = {
    "public/trees": {
      status: 200,
      body: [
        {
          sha: MACULA_SHA,
          commit: { committer: { date: "2026-08-01T00:00:00Z" } },
        },
      ],
    },
    "public/referents": {
      status: 200,
      body: [
        {
          sha: "fedcba9876" + "1".repeat(30),
          commit: { committer: { date: "2026-07-15T00:00:00Z" } },
        },
      ],
    },
    ...o.github,
  };
  const answer = (a: Answer | undefined) =>
    a === undefined
      ? new Response("not found", { status: 404 })
      : new Response(a.body === undefined ? "" : JSON.stringify(a.body), {
          status: a.status,
        });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    asked.push({ url: String(input), auth: headers.get("Authorization") });
    if (url.host === "git.door43.org") {
      if (url.pathname === "/api/v1/catalog/search") {
        return answer(
          originals[url.searchParams.get("lang") as "hbo" | "el-x-koine"],
        );
      }
      const commits = url.pathname.match(
        /^\/api\/v1\/repos\/([^/]+\/[^/]+)\/commits$/,
      );
      if (commits) return answer(lexicons[commits[1]!]);
      const repo = url.pathname.match(/^\/api\/v1\/repos\/([^/]+\/[^/]+)$/);
      if (repo) {
        const status =
          o.lexiconRepos?.[repo[1]!] ?? (lexicons[repo[1]!] ? 200 : 404);
        return answer({ status, body: { full_name: repo[1] } });
      }
    }
    if (url.host === "api.github.com") {
      if (url.pathname.endsWith("/access_tokens")) {
        return answer(o.token ?? { status: 201, body: { token: "ghs_test" } });
      }
      if (url.pathname === "/repos/idiomaspuentes/taller/commits") {
        return answer(
          github[url.searchParams.get("path") as "public/trees"] ?? undefined,
        );
      }
    }
    return new Response("unexpected", { status: 418 });
  };
  return { fetch: fetchImpl as typeof fetch, asked };
}

function setup(
  o: {
    rows?: CatalogEntry[];
    searchThrows?: boolean;
    language?: string;
    app?: boolean;
  } & Parameters<typeof network>[0] = {},
) {
  const { kv, values, puts } = fakeKv();
  const net = network(o);
  const searches: string[] = [];
  const env: FreshnessEnv = {
    TRANSLATION_HELPS_CACHE: kv,
    ...(o.app
      ? {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "unused: the token is cached",
          GITHUB_APP_INSTALLATION_ID: "2",
        }
      : {}),
  };
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const observe = (language = o.language ?? LANG, now = NOW) =>
    observeParts({
      language,
      env,
      ctx,
      now,
      fetch: net.fetch,
      search: async (lang) => {
        searches.push(lang);
        if (o.searchThrows) throw new Error("HTTP 503 from DCS");
        return o.rows ?? ROWS;
      },
    });
  return { observe, asked: net.asked, values, puts, searches, kv };
}

// tc-study buildLanguageParts.test.ts, "the stamps in the list": what the fixture's language list records.
const LIST_STAMPS = {
  [GLT]: RELEASE,
  [GST]: RELEASE,
  [TA]: RELEASE,
  [TN]: RELEASE,
  [TQ]: RELEASE,
  [TW]: RELEASE,
  [TWL]: RELEASE,
  [UHB]: "v2.1.30#2026-09-01T00_00_00Z",
  [UGNT]: "v2.1.30#2026-09-01T00_00_00Z",
  [UHL]: "0123456789#2026-07-01T00_00_00Z",
  "Biblica/hbo/macula": "abc1234567#2026-08-01T00_00_00.000Z",
  "Biblica/el-x-koine/macula": "abc1234567#2026-08-01T00_00_00.000Z",
};

/** LIST_STAMPS without the given keys: what is left when those inputs cannot be read. */
const without = (...keys: string[]) =>
  Object.fromEntries(
    Object.entries(LIST_STAMPS).filter(([key]) => !keys.includes(key)),
  );
const MACULA = ["Biblica/hbo/macula", "Biblica/el-x-koine/macula"];

describe("the stamp formats, as tc-study writes them", () => {
  it("a lexicon is its commit's first ten characters and its date, sanitized (companions.ts lexiconStampOf)", () => {
    expect(
      lexiconStampOf({ sha: "0123456789abcdef", date: "2026-10-01T12:00:00Z" }),
    ).toBe("0123456789#2026-10-01T12_00_00Z");
    // companions.test.ts "lexiconStamps": the date is kept as Door43 wrote it, offset included.
    expect(
      lexiconStampOf({
        sha: "6cca967498146d8ebe12c1fe9124f56baa309e27",
        date: "2026-10-19T19:52:42-04:00",
      }),
    ).toBe("6cca967498#2026-10-19T19_52_42-04_00");
    expect(
      lexiconStampOf({
        sha: "0123456789abcdef0123456789abcdef01234567",
        date: "2026-09-01T10:00:00Z",
      }),
    ).toBe("0123456789#2026-09-01T10_00_00Z");
    // buildLanguageParts.test.ts "the stamps in the list" (partsFixture UHL_COMMIT).
    expect(
      lexiconStampOf({ sha: UHL_COMMIT.sha, date: UHL_COMMIT.created }),
    ).toBe("0123456789#2026-07-01T00_00_00Z");
  });

  it("MACULA is its commit's first ten characters and the date as toISOString writes it (publishLanguageParts.ts)", () => {
    expect(
      maculaStampOf({ sha: "0123456789abcdef", date: "2026-10-01T12:00:00Z" }),
    ).toBe("0123456789#2026-10-01T12_00_00.000Z");
    // buildLanguageParts.test.ts: 'abc1234567#2026-08-01T00_00_00.000Z' for both keys.
    expect(
      maculaStampOf({ sha: MACULA_SHA, date: "2026-08-01T00:00:00Z" }),
    ).toBe("abc1234567#2026-08-01T00_00_00.000Z");
  });

  it("the build's %cI (with its offset) and GitHub's UTC date of the same commit give one MACULA stamp", () => {
    // maculaIdentity.test.ts: git gives '2026-10-01T09:00:00-05:00'; GitHub's committer.date is UTC.
    const sha = "f1e2d3c4b5a6978877665544332211ffeeddccbb";
    expect(maculaStampOf({ sha, date: "2026-10-01T09:00:00-05:00" })).toBe(
      "f1e2d3c4b5#2026-10-01T14_00_00.000Z",
    );
    expect(maculaStampOf({ sha, date: "2026-10-01T14:00:00Z" })).toBe(
      "f1e2d3c4b5#2026-10-01T14_00_00.000Z",
    );
  });
});

describe("which rows of the language", () => {
  it("keeps the language's resources whose subject is in the table, without OBS, lexicons or other languages", () => {
    expect(languageStamps(ROWS, LANG)).toEqual({
      [GLT]: RELEASE,
      [GST]: RELEASE,
      [TN]: RELEASE,
      [TQ]: RELEASE,
      [TWL]: RELEASE,
      [TW]: RELEASE,
      [TA]: RELEASE,
    });
  });

  it("leaves out a subject outside the spec's table", () => {
    expect(languageStamps([row("es-419_sn", "TSV Study Notes")], LANG)).toEqual(
      {},
    );
  });

  it("OBS is any subject matching OBS or Open Bible Stories (door43Stamps.ts isObs)", () => {
    expect(isObsRow({ subject: "Open Bible Stories" })).toBe(true);
    expect(isObsRow({ subject: "TSV OBS Translation Notes" })).toBe(true);
    expect(isObsRow({ subject: "obs translation questions" })).toBe(true);
    expect(isObsRow({ subject: "TSV Translation Notes" })).toBe(false);
    expect(isObsRow({})).toBe(false);
    // In the table so the rule, not the table, is what leaves them out.
    expect(PARTS_SUBJECTS.has("Open Bible Stories")).toBe(true);
  });

  it("the literal text is the language's Aligned Bible whose id ends in lt, the first by key (door43Stamps.ts literalTextOf)", () => {
    expect(literalOwnerOf(ROWS, LANG)).toBe("test_gl");
    expect(
      literalOwnerOf(
        [
          row("es-419_glt", "Aligned Bible", RELEASE, { owner: "zz_gl" }),
          row("es-419_glt", "Aligned Bible", RELEASE, { owner: "aa_gl" }),
        ],
        LANG,
      ),
    ).toBe("aa_gl");
    expect(
      literalOwnerOf([row("es-419_gst", "Aligned Bible")], LANG),
    ).toBeUndefined();
    expect(literalOwnerOf(ROWS, "fr")).toBeUndefined();
  });

  it("two literal texts of different owners: the first by key, whatever order Door43 lists them in", () => {
    const zz = row("es-419_ult", "Aligned Bible", RELEASE, { owner: "zz_org" });
    const bb = row("es-419_glt", "Aligned Bible", RELEASE, { owner: "bb_gl" });
    expect(literalOwnerOf([zz, bb], LANG)).toBe("bb_gl");
    expect(literalOwnerOf([bb, zz], LANG)).toBe("bb_gl");
  });

  it("a hit without a release tag is left out, as discovery leaves it, and is not the literal text", () => {
    const unreleased = {
      ...row("es-419_glt", "Aligned Bible", "master"),
      hasRelease: false,
    };
    const tn = {
      ...row("es-419_tn", "TSV Translation Notes"),
      hasRelease: true,
    };
    expect(languageStamps([unreleased, tn], LANG)).toEqual({ [TN]: RELEASE });
    expect(literalOwnerOf([unreleased, tn], LANG)).toBeUndefined();
  });
});

describe("observeParts", () => {
  it("gives exactly the stamps tc-study's fixture list records", async () => {
    const s = setup();
    expect(await s.observe()).toEqual({ stamps: LIST_STAMPS });
    expect(s.searches).toEqual([LANG]);
  });

  it("asks Door43 for the originals as tc-study does: owner, lang, subject, stage prod, one row, no topic", async () => {
    const s = setup();
    await s.observe();
    const searches = s.asked
      .map((a) => a.url)
      .filter((u) => u.includes("/catalog/search"));
    expect(searches.sort()).toEqual([
      "https://git.door43.org/api/v1/catalog/search?owner=unfoldingWord&lang=el-x-koine&subject=Greek+New+Testament&stage=prod&limit=1",
      "https://git.door43.org/api/v1/catalog/search?owner=unfoldingWord&lang=hbo&subject=Hebrew+Old+Testament&stage=prod&limit=1",
    ]);
  });

  it("an original's published date falls back to the hit's released, as createResourceMetadata does", async () => {
    const s = setup({
      originals: {
        hbo: {
          status: 200,
          body: {
            ok: true,
            data: [
              {
                ...originalHit("hbo", "hbo_uhb", "Hebrew Old Testament"),
                release: { tag_name: "v2.1.31" },
                released: "2026-10-01T00:00:00Z",
              },
            ],
          },
        },
      },
    });
    const observed = await s.observe();
    expect("stamps" in observed && observed.stamps[UHB]).toBe(
      "v2.1.31#2026-10-01T00_00_00Z",
    );
  });

  it("asks es-419's lexicons of the GLT's owner: the repository, then its commit at master (resolveLexicon)", async () => {
    const s = setup();
    await s.observe();
    const lexicons = s.asked
      .map((a) => a.url)
      .filter((u) => u.includes("door43") && u.includes("/repos/"));
    expect(lexicons.sort()).toEqual([
      "https://git.door43.org/api/v1/repos/test_gl/es-419_ugl",
      "https://git.door43.org/api/v1/repos/test_gl/es-419_uhl",
      // es-419_ugl answered 404: no commit is asked of it.
      "https://git.door43.org/api/v1/repos/test_gl/es-419_uhl/commits?sha=master&limit=1&stat=false&files=false&verification=false",
    ]);
  });

  it("asks en's lexicons of test_org (companions.ts LEXICON_OWNERS), keyed under that owner", async () => {
    const s = setup({
      language: "en",
      rows: [
        row("en_ult", "Aligned Bible", "v86#2026-01-01T00_00_00Z", {
          owner: "unfoldingWord",
          language: "en",
        }),
      ],
      lexicons: {
        "test_org/en_ugl": {
          status: 200,
          body: [
            {
              sha: "9876543210fedcba",
              commit: { committer: { date: "2026-06-01T00:00:00Z" } },
            },
          ],
        },
      },
    });
    const observed = await s.observe();
    const lexicons = s.asked
      .map((a) => a.url)
      .filter((u) => u.includes("door43") && u.includes("/repos/"));
    expect(lexicons.sort()).toEqual([
      "https://git.door43.org/api/v1/repos/test_org/en_ugl",
      "https://git.door43.org/api/v1/repos/test_org/en_ugl/commits?sha=master&limit=1&stat=false&files=false&verification=false",
      "https://git.door43.org/api/v1/repos/test_org/en_uhl",
    ]);
    // No `created`: the committer's date, as resolveLexicon falls back.
    expect(observed).toEqual({
      stamps: expect.objectContaining({
        "test_org/en/ugl": "9876543210#2026-06-01T00_00_00Z",
        "unfoldingWord/en/ult": "v86#2026-01-01T00_00_00Z",
      }),
    });
    expect("stamps" in observed && "test_org/en/uhl" in observed.stamps).toBe(
      false,
    );
  });

  it("a lexicon repository Door43 answers 404 for is no lexicon", async () => {
    const observed = await setup({ lexicons: {} }).observe();
    expect("stamps" in observed).toBe(true);
    expect("stamps" in observed && UHL in observed.stamps).toBe(false);
  });

  it("a repository that fails, or one without master (its commits 404), is left out and named, not «no lexicon»", async () => {
    // es-419_ugl fails: es-419_uhl and every other input are still compared.
    const repoFails = setup({ lexiconRepos: { "test_gl/es-419_ugl": 500 } });
    expect(await repoFails.observe()).toEqual({
      stamps: LIST_STAMPS,
      unreadable: ["Door43 answered 500 for test_gl/es-419_ugl"],
    });
    const noMaster = setup({
      lexicons: {
        "test_gl/es-419_uhl": { status: 404, body: { message: "not found" } },
      },
    });
    expect(await noMaster.observe()).toEqual({
      stamps: without(UHL),
      unreadable: [
        "test_gl/es-419_uhl has no ref master (Door43 answered 404)",
      ],
    });
    const commitsFail = setup({
      lexicons: {
        "test_gl/es-419_uhl": { status: 500, body: { message: "boom" } },
      },
    });
    expect(await commitsFail.observe()).toEqual({
      stamps: without(UHL),
      unreadable: [expect.stringContaining("es-419_uhl")],
    });
  });

  it("a lexicon Door43 cannot be reached for (a network error) is left out too", async () => {
    const s = setup();
    const observed = await observeParts({
      language: LANG,
      env: { TRANSLATION_HELPS_CACHE: s.kv },
      ctx: { waitUntil: () => {} } as unknown as ExecutionContext,
      now: NOW,
      search: async () => ROWS,
      fetch: (async (input: RequestInfo | URL) => {
        if (String(input).includes("_uhl")) throw new TypeError("network");
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
    });
    expect("stamps" in observed && UHL in observed.stamps).toBe(false);
    expect("stamps" in observed && observed.unreadable).toContainEqual(
      expect.stringContaining("test_gl/es-419_uhl: TypeError: network"),
    );
  });

  it("a lexicon dated with an offset keeps it, only sanitized (never normalized)", async () => {
    const s = setup({
      lexicons: {
        "test_gl/es-419_uhl": {
          status: 200,
          body: [
            {
              sha: "6cca967498146d8ebe12c1fe9124f56baa309e27",
              created: "2026-10-19T19:52:42-04:00",
            },
          ],
        },
      },
    });
    const observed = await s.observe();
    expect("stamps" in observed && observed.stamps[UHL]).toBe(
      "6cca967498#2026-10-19T19_52_42-04_00",
    );
  });

  it("a lexicon answered with no commit, or a commit with no date, is left out (resolveLexicon throws)", async () => {
    for (const body of [[], [{ sha: "0123456789abcdef" }]]) {
      const s = setup({
        lexicons: { "test_gl/es-419_uhl": { status: 200, body } },
      });
      expect(await s.observe()).toEqual({
        stamps: without(UHL),
        unreadable: ["test_gl/es-419_uhl has no commit at master"],
      });
    }
  });

  it("MACULA keeps the newer of the trees and referents commits, for both keys", async () => {
    const s = setup({
      github: {
        "public/referents": {
          status: 200,
          body: [
            {
              sha: "fedcba9876" + "1".repeat(30),
              commit: { committer: { date: "2026-09-15T00:00:00Z" } },
            },
          ],
        },
      },
    });
    const observed = await s.observe();
    expect(observed).toEqual({
      stamps: expect.objectContaining({
        "Biblica/hbo/macula": "fedcba9876#2026-09-15T00_00_00.000Z",
        "Biblica/el-x-koine/macula": "fedcba9876#2026-09-15T00_00_00.000Z",
      }),
    });
    const github = s.asked.filter((a) => a.url.includes("api.github.com"));
    expect(github.map((a) => a.url).sort()).toEqual([
      "https://api.github.com/repos/idiomaspuentes/taller/commits?path=public%2Freferents&per_page=1",
      "https://api.github.com/repos/idiomaspuentes/taller/commits?path=public%2Ftrees&per_page=1",
    ]);
    // Without the App configured, GitHub is asked without a token.
    expect(github.every((a) => a.auth === null)).toBe(true);
  });

  it("MACULA and the originals are read once an hour for every language (KV), then again", async () => {
    const s = setup();
    await s.observe(LANG, NOW);
    const before = s.asked.length;
    await s.observe(LANG, new Date(NOW.getTime() + 30 * MINUTE));
    const again = s.asked.slice(before).map((a) => a.url);
    expect(again.some((u) => u.includes("api.github.com"))).toBe(false);
    expect(again.some((u) => u.includes("/catalog/search"))).toBe(false);
    // The lexicons are the language's own: asked every time.
    expect(
      again.filter((u) => u.includes("door43") && u.includes("/repos/")),
    ).toHaveLength(3);
    expect(
      s.puts
        .filter((p) => p.key === "packs:macula" || p.key === "packs:originals")
        .map((p) => `${p.key} ${p.ttl}`)
        .sort(),
    ).toEqual(["packs:macula 3600", "packs:originals 3600"]);

    const later = s.asked.length;
    await s.observe(LANG, new Date(NOW.getTime() + 61 * MINUTE));
    expect(
      s.asked.slice(later).some((a) => a.url.includes("api.github.com")),
    ).toBe(true);
  });

  it("asks GitHub with the App's installation token when the App is configured", async () => {
    const s = setup({ app: true });
    // A cached token, so no JWT is signed in the test.
    await s.kv.put(
      "packs:github-token:2",
      JSON.stringify({ token: "ghs_cached", until: NOW.getTime() + 600_000 }),
    );
    expect(await s.observe()).toEqual({ stamps: LIST_STAMPS });
    const github = s.asked.filter((a) =>
      a.url.startsWith("https://api.github.com/repos/idiomaspuentes/"),
    );
    expect(github).toHaveLength(2);
    expect(github.every((a) => a.auth === "Bearer ghs_cached")).toBe(true);
  });

  it("GitHub refusing (403, its rate limit) or failing leaves both MACULA keys out, and is asked again after 10 minutes", async () => {
    for (const status of [403, 429, 500]) {
      const s = setup({
        github: { "public/trees": { status, body: { message: "no" } } },
      });
      expect(await s.observe()).toEqual({
        stamps: without(...MACULA),
        unreadable: [`MACULA: GitHub answered ${status} for public/trees`],
      });
      // The rest of the run (five checks within minutes) does not ask GitHub again...
      const before = s.asked.length;
      await s.observe(LANG, new Date(NOW.getTime() + 9 * MINUTE));
      expect(
        s.asked.slice(before).some((a) => a.url.includes("api.github.com")),
      ).toBe(false);
      // ...but a passing failure does not hide a MACULA commit for the hour.
      const later = s.asked.length;
      await s.observe(LANG, new Date(NOW.getTime() + 11 * MINUTE));
      expect(
        s.asked.slice(later).some((a) => a.url.includes("api.github.com")),
      ).toBe(true);
    }
  });

  it("a GitHub answer without a commit leaves MACULA out", async () => {
    const s = setup({
      github: { "public/referents": { status: 200, body: [] } },
    });
    expect(await s.observe()).toEqual({
      stamps: without(...MACULA),
      unreadable: ["MACULA: GitHub gave no dated commit for public/referents"],
    });
  });

  it("an original Door43 cannot give (5xx, ok false, no row, no tag) is left out; the other one is kept", async () => {
    const answers: Answer[] = [
      { status: 502 },
      { status: 200, body: { ok: false, data: [] } },
      { status: 200, body: { ok: true, data: [] } },
      {
        status: 200,
        body: {
          ok: true,
          data: [
            {
              ...originalHit("hbo", "hbo_uhb", "Hebrew Old Testament"),
              release: {},
            },
          ],
        },
      },
    ];
    for (const hbo of answers) {
      const s = setup({ originals: { hbo } });
      expect(await s.observe(), JSON.stringify(hbo)).toEqual({
        stamps: without(UHB),
        unreadable: [expect.stringContaining(UHB)],
      });
    }
  });

  it("an empty search, or one with no row of the language, is unknown: catalogSearch answers [] on a network error", async () => {
    expect(await setup({ rows: [] }).observe()).toEqual({
      unknown: expect.any(String),
    });
    expect(await setup({ rows: [ROWS[ROWS.length - 1]!] }).observe()).toEqual({
      unknown: expect.any(String),
    });
  });

  it("a search that throws (Door43's 5xx) is unknown, and observeParts does not throw", async () => {
    expect(await setup({ searchThrows: true }).observe()).toEqual({
      unknown: expect.stringContaining("503"),
    });
  });

  it("a language without a literal text has no lexicons, as the build reads them only from its owner", async () => {
    const s = setup({ rows: ROWS.filter((r) => r.name !== "es-419_glt") });
    expect(await s.observe()).toEqual({ stamps: without(UHL, GLT) });
    expect(
      s.asked.some((a) =>
        a.url.startsWith("https://git.door43.org/api/v1/repos/"),
      ),
    ).toBe(false);
    // en too: test_org's lexicons are read only when en has a literal text.
    const en = setup({
      language: "en",
      rows: [
        row("en_ust", "Aligned Bible", RELEASE, {
          owner: "unfoldingWord",
          language: "en",
        }),
      ],
      lexicons: {
        "test_org/en_uhl": { status: 200, body: [UHL_COMMIT] },
      },
    });
    const observed = await en.observe();
    expect(observed).toEqual({
      stamps: expect.objectContaining({ "unfoldingWord/en/ust": RELEASE }),
    });
    expect("stamps" in observed && "test_org/en/uhl" in observed.stamps).toBe(
      false,
    );
    expect(en.asked.some((a) => a.url.includes("/repos/test_org/"))).toBe(
      false,
    );
  });
});

describe("observeParts with the default search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps Door43's raw rows as tc-study does: tag#published_at with : turned into _", async () => {
    const net = network();
    const searched: string[] = [];
    // catalogSearch (packages/door43) reads Door43 with the global fetch.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      searched.push(String(input));
      const raw = (name: string, subject: string) => ({
        owner: "test_gl",
        name,
        subject,
        language: LANG,
        branch_or_tag_name: "v12",
        release: { tag_name: "v12", published_at: "2026-09-01T00:00:00Z" },
        ingredients: [],
      });
      expect(url.searchParams.get("topic")).toBe("tc-ready");
      return Response.json({
        ok: true,
        data: [
          raw("es-419_glt", "Aligned Bible"),
          raw("es-419_tn", "TSV Translation Notes"),
        ],
      });
    });
    const { kv } = fakeKv();
    const observed = await observeParts({
      language: "es-419",
      env: { TRANSLATION_HELPS_CACHE: kv },
      ctx: { waitUntil: () => {} } as unknown as ExecutionContext,
      now: NOW,
      fetch: net.fetch,
    });
    expect(observed).toEqual({
      stamps: expect.objectContaining({ [GLT]: RELEASE, [TN]: RELEASE }),
    });
    const url = new URL(searched[0]!);
    expect(url.searchParams.get("lang")).toBe("es-419");
    expect(url.searchParams.get("stage")).toBe("prod");
    expect(url.searchParams.get("limit")).toBe("500");
  });

  it("asks Door43 on every check, past the catalog's KV and isolate caches", async () => {
    const net = network();
    let searches = 0;
    vi.stubGlobal("fetch", async () => {
      searches += 1;
      return Response.json({ ok: true, data: [] });
    });
    const { kv, values, puts } = fakeKv();
    // The test above left this very search in the isolate's cache; a check must not read it from there.
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
    for (const at of [NOW, new Date(NOW.getTime() + 5 * MINUTE)]) {
      await observeParts({
        language: "es-419",
        env: { TRANSLATION_HELPS_CACHE: kv },
        ctx,
        now: at,
        fetch: net.fetch,
      });
    }
    expect(searches).toBe(2);
    expect([...values.keys()].some((k) => k.startsWith("catalog:"))).toBe(
      false,
    );
    expect(puts.some((p) => p.key.startsWith("catalog:"))).toBe(false);
  });
});
