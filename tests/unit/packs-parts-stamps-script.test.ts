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

function worker(objects: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const path = new URL(url).pathname;
    return path in objects
      ? Response.json(objects[path])
      : Response.json({ error: "not found" }, { status: 404 });
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
