/**
 * The gate before a parts check may dispatch (delivery 3, Task 12 Step 4): the stamps the Worker computes from Door43
 * and GitHub must be the ones a published list records. The script prints every key where they differ; these tests
 * run it on fixtures, never on the real services.
 */

import { describe, it, expect } from "vitest";
import { diffForReport, run } from "../../scripts/packs-parts-stamps";
import { CURRENT_PARTS_COMPAT } from "../../src/packs/dispatch";
import type { Observed } from "../../src/packs/partsSources";

const COMPAT = CURRENT_PARTS_COMPAT;
const GLT = "test_gl/es-419/glt";
const TN = "test_gl/es-419/tn";
const UHB = "unfoldingWord/hbo/uhb";
const RELEASE = "v12#2026-09-01T00_00_00Z";
const ORIGINALS_SHA = "e".repeat(64);

describe("diffForReport", () => {
  it("is empty when every key agrees", () => {
    expect(diffForReport({ [GLT]: RELEASE }, { [GLT]: RELEASE })).toEqual([]);
  });

  it("lists a moved stamp, a key only observed and a key only listed, by key", () => {
    expect(
      diffForReport(
        { [GLT]: RELEASE, [TN]: RELEASE, [UHB]: "v2.1.30#x" },
        { [GLT]: "v13#2026-10-20T09_00_00Z", [UHB]: "v2.1.30#x", new: "v1" },
      ),
    ).toEqual([
      { key: "new", list: null, now: "v1" },
      { key: GLT, list: RELEASE, now: "v13#2026-10-20T09_00_00Z" },
      { key: TN, list: RELEASE, now: null },
    ]);
  });
});

/** An answer with another status than 200: `{ [ANSWER]: 202, body }`. */
const ANSWER = Symbol("status");

function worker(objects: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const parsed = new URL(url);
    const found = objects[parsed.pathname] ?? objects[url];
    if (found === undefined) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const o = found as { [ANSWER]?: number; body?: unknown };
    return o[ANSWER]
      ? Response.json(o.body, { status: o[ANSWER] })
      : Response.json(found);
  };
  return { fetch: fetchImpl as typeof fetch, asked };
}

function runWith(
  argv: string[],
  objects: Record<string, unknown>,
  observed: Observed,
) {
  const out: string[] = [];
  const err: string[] = [];
  const w = worker(objects);
  const observedFor: string[] = [];
  const done = run(argv, {
    fetch: w.fetch,
    observe: async ({ language }) => {
      observedFor.push(language);
      return observed;
    },
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
  });
  return { done, out, err, asked: w.asked, observedFor };
}

const LIST = {
  schema: 2,
  language: "es-419",
  compat: COMPAT,
  code: `${COMPAT}+7bc31e739fbeed69`,
  resources: [{ key: GLT, stamp: RELEASE, role: "text" }],
  originals: {
    path: `catalog/${COMPAT}/originals/${ORIGINALS_SHA}.json`,
    sha256: ORIGINALS_SHA,
  },
  stamps: { [GLT]: RELEASE, [UHB]: "v2.1.30#2026-09-01T00_00_00Z" },
};
const LIST_PATH = `/v2/packs/${COMPAT}/es-419`;

describe("run", () => {
  it("prints [] and exits 0 when the Worker's stamps are the list's", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev/", "--lang", "es-419"],
      { [LIST_PATH]: LIST },
      { stamps: { ...LIST.stamps } },
    );
    expect(await r.done).toBe(0);
    expect(r.out).toEqual(["[]"]);
    expect(r.asked).toEqual([
      `https://preview.example.workers.dev${LIST_PATH}`,
    ]);
    expect(r.observedFor).toEqual(["es-419"]);
  });

  it("prints every difference as JSON and exits 1", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      { [LIST_PATH]: LIST },
      {
        stamps: { [GLT]: "v13#2026-10-20T09_00_00Z", [UHB]: LIST.stamps[UHB] },
      },
    );
    expect(await r.done).toBe(1);
    expect(JSON.parse(r.out.join("\n"))).toEqual([
      { key: GLT, list: RELEASE, now: "v13#2026-10-20T09_00_00Z" },
    ]);
  });

  it("an unknown observation exits 1 and says why", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      { [LIST_PATH]: LIST },
      { unknown: "GitHub answered 403 for public/trees" },
    );
    expect(await r.done).toBe(1);
    expect(JSON.parse(r.out.join("\n"))).toEqual({
      unknown: "GitHub answered 403 for public/trees",
    });
  });

  it("MACULA keys the list does not have are not compared, as the check does not compare them", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      { [LIST_PATH]: LIST },
      {
        stamps: {
          ...LIST.stamps,
          "Biblica/hbo/macula": "abc1234567#2026-08-01T00_00_00.000Z",
        },
      },
    );
    expect(await r.done).toBe(0);
    expect(r.out).toEqual(["[]"]);
  });

  it("an unreadable input is named, and its key, only in the list, keeps the gate shut", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      { [LIST_PATH]: LIST },
      {
        stamps: { [GLT]: RELEASE },
        unreadable: ["Door43 answered 502 for unfoldingWord/hbo/uhb"],
      },
    );
    expect(await r.done).toBe(1);
    expect(JSON.parse(r.out.join("\n"))).toEqual([
      { key: UHB, list: LIST.stamps[UHB], now: null },
    ]);
    expect(r.err.join("\n")).toContain(
      "Unreadable, so not compared: Door43 answered 502 for unfoldingWord/hbo/uhb",
    );
  });

  it("a list without stamps is compared with its resources and its originals list's", async () => {
    const legacy = { ...LIST, stamps: undefined };
    const originals = {
      schema: 2,
      language: "originals",
      compat: COMPAT,
      code: LIST.code,
      resources: [{ key: UHB, stamp: "v2.1.29#2026-01-01T00_00_00Z" }],
    };
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      {
        [LIST_PATH]: legacy,
        [`/v2/packs/${COMPAT}/originals/${ORIGINALS_SHA}`]: originals,
      },
      { stamps: { [GLT]: RELEASE, [UHB]: "v2.1.30#2026-09-01T00_00_00Z" } },
    );
    expect(await r.done).toBe(1);
    expect(JSON.parse(r.out.join("\n"))).toEqual([
      {
        key: UHB,
        list: "v2.1.29#2026-01-01T00_00_00Z",
        now: "v2.1.30#2026-09-01T00_00_00Z",
      },
    ]);
  });

  it("a list read from a file (wrangler r2 object get) needs no Worker", async () => {
    const out: string[] = [];
    const code = await run(["--list", "es-419.json", "--lang", "es-419"], {
      fetch: (async () => {
        throw new Error("no network in this test");
      }) as typeof fetch,
      readFile: async (path) => {
        expect(path).toBe("es-419.json");
        return JSON.stringify(LIST);
      },
      observe: async () => ({ stamps: { ...LIST.stamps } }),
      out: (line) => void out.push(line),
      err: () => {},
    });
    expect(code).toBe(0);
    expect(out).toEqual(["[]"]);
  });

  it("a 202 (the Worker asked for a build) or any answer but 200 is an error, not a list", async () => {
    const accepted = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      {
        [LIST_PATH]: {
          [ANSWER]: 202,
          body: { status: "building", retryAfter: 900 },
        },
      },
      { stamps: {} },
    );
    expect(await accepted.done).toBe(2);
    expect(accepted.err.join("\n")).toContain("202");
    expect(accepted.observedFor).toEqual([]);
  });

  it("a list that is not a schema 2 parts list is an error, from the Worker or a file", async () => {
    for (const body of [{ ...LIST, schema: 1 }, { error: "x" }, [LIST]]) {
      const r = runWith(
        ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
        { [LIST_PATH]: body },
        { stamps: {} },
      );
      expect(await r.done, JSON.stringify(body)).toBe(2);
      expect(r.err.join("\n")).toContain("schema 2");
      expect(r.observedFor).toEqual([]);
    }
    const err: string[] = [];
    const code = await run(["--list", "f1.json", "--lang", "es-419"], {
      readFile: async () => JSON.stringify({ ...LIST, schema: 1 }),
      observe: async () => ({ stamps: {} }),
      out: () => {},
      err: (line) => void err.push(line),
    });
    expect(code).toBe(2);
  });

  it("an originals list the Worker answers with anything but 200 is an error too", async () => {
    const r = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      {
        [LIST_PATH]: { ...LIST, stamps: undefined },
        [`/v2/packs/${COMPAT}/originals/${ORIGINALS_SHA}`]: {
          [ANSWER]: 202,
          body: {},
        },
      },
      { stamps: {} },
    );
    expect(await r.done).toBe(2);
  });

  describe("--builder: the list's code against the one master builds", () => {
    const builder = (code: string, compat = COMPAT) => ({
      compat,
      code,
      commit: "4863174" + "0".repeat(33),
      at: "2026-10-20T00:00:00Z",
    });
    const withBuilder = (b: unknown, source = "builder.json") => {
      const out: string[] = [];
      const err: string[] = [];
      const done = run(
        ["--list", "es-419.json", "--lang", "es-419", "--builder", source],
        {
          fetch: (async (input: RequestInfo | URL) =>
            String(input) === "https://example.test/builder.json"
              ? Response.json(b)
              : new Response("no", { status: 404 })) as typeof fetch,
          readFile: async (path) =>
            JSON.stringify(path === "builder.json" ? b : LIST),
          observe: async () => ({ stamps: { ...LIST.stamps } }),
          out: (line) => void out.push(line),
          err: (line) => void err.push(line),
        },
      );
      return { done, out, err };
    };

    it("the same code: [] and 0", async () => {
      const r = withBuilder(builder(LIST.code));
      expect(await r.done).toBe(0);
      expect(r.out).toEqual(["[]"]);
    });

    it("another code is reported as the code key and exits 1, as the check would rebuild it", async () => {
      const newCode = `${COMPAT}+0123456789abcdef`;
      for (const source of [
        "builder.json",
        "https://example.test/builder.json",
      ]) {
        const r = withBuilder(builder(newCode), source);
        expect(await r.done, source).toBe(1);
        expect(JSON.parse(r.out.join("\n"))).toEqual([
          { key: "code", list: LIST.code, now: newCode },
        ]);
      }
    });

    it("a builder of another compat is said, and its code not compared (the check does not rebuild for it)", async () => {
      const r = withBuilder(
        builder("f2.1-x+00", "f2.1-u2.3.0-p6000230-q9-a12-t1"),
      );
      expect(await r.done).toBe(0);
      expect(r.err.join("\n")).toContain("f2.1-u2.3.0-p6000230-q9-a12-t1");
    });

    it("a builder file that is missing or malformed exits 2", async () => {
      for (const b of [{ compat: COMPAT }, "nonsense"]) {
        expect(await withBuilder(b).done).toBe(2);
      }
      expect(
        await withBuilder(builder(LIST.code), "https://example.test/none").done,
      ).toBe(2);
    });
  });

  it("a list the Worker does not have, or bad arguments, exit 2", async () => {
    const missing = runWith(
      ["--base", "https://preview.example.workers.dev", "--lang", "es-419"],
      {},
      { stamps: {} },
    );
    expect(await missing.done).toBe(2);
    expect(missing.err.join("\n")).toContain("404");
    expect(missing.observedFor).toEqual([]);

    for (const argv of [[], ["--lang", "es-419"], ["--base", "https://x"]]) {
      const r = runWith(argv, {}, { stamps: {} });
      expect(await r.done, argv.join(" ")).toBe(2);
    }
  });
});
