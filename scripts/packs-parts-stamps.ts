/**
 * Whether the stamps the Worker computes for a language (src/packs/partsSources.ts, from Door43 and GitHub now) are
 * the ones its published parts list records: the gate before any parts check may dispatch (delivery 3, Task 12
 * Step 4). A key derived another way on the two sides would read as a change on every check.
 *
 *   npx tsx scripts/packs-parts-stamps.ts --list <file> [--originals <file>] [--builder <file|url>] --lang <code>
 *   npx tsx scripts/packs-parts-stamps.ts --base <Worker URL> [--builder <file|url>] --lang <code>
 *
 * Run the real-data gate with `--list`, BEFORE the preview Worker is deployed, on a list saved from the bucket:
 * `npx wrangler r2 object get language-packs-staging/catalog/<compat>/<lang>.json --remote --file <lang>.json` (and,
 * for a list without `stamps`, its originals list the same way, passed with `--originals`). `--base` GETs the list
 * from a Worker under `CURRENT_PARTS_COMPAT`, and a GET of a parts list runs the Worker's own freshness check, which
 * can dispatch a build: use it only against a Worker with PACKS_PARTS_DISPATCH off. Its answer must be a 200 with a
 * schema 2 list (a 202 or a 404 is an error, not a list).
 *
 * `--builder` takes `status/builder.json` (a file saved the same way, or a URL) and compares its code with the
 * list's, as the check does: another code is reported as the key `code` (a builder of another compat is said on
 * stderr and not compared). Door43 and GitHub are read for real (GitHub without a token), with KV kept in memory for
 * this run.
 *
 * Prints `[]` when every key agrees, else `[{key, list, now}]` (a key only in the list is listed too, though the
 * check ignores it), or `{unknown}` when the language's search failed. An input that could not be read (an original,
 * a lexicon, MACULA) is named on stderr and its keys show as only in the list, so the gate does not pass without it.
 * Exits 0 on `[]`, 1 on any difference or unknown, 2 on bad arguments or an unreadable list or builder file.
 */

import { readFile as readFileFs } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CURRENT_PARTS_COMPAT } from "../src/packs/dispatch.js";
import {
  builtStamps,
  comparedStamps,
  parsePartsBuilder,
  type PartsBuilder,
  type PartsListLite,
} from "../src/packs/partsFreshness.js";
import { observeParts } from "../src/packs/partsSources.js";

export type ReportEntry = {
  key: string;
  list: string | null;
  now: string | null;
};

/** Every key where the list and the observation differ, by key; `null` where one side has no such key. */
export function diffForReport(
  built: Record<string, string>,
  observed: Record<string, string>,
): ReportEntry[] {
  const keys = [
    ...new Set([...Object.keys(built), ...Object.keys(observed)]),
  ].sort();
  return keys
    .filter((key) => built[key] !== observed[key])
    .map((key) => ({
      key,
      list: built[key] ?? null,
      now: observed[key] ?? null,
    }));
}

type Deps = {
  fetch?: typeof fetch;
  observe?: typeof observeParts;
  readFile?: (path: string) => Promise<string>;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** A KV namespace kept in memory: the shared reads (originals, MACULA) are cached for this run only. */
function memoryKv(): KVNamespace {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => void values.set(key, value),
    delete: async (key: string) => void values.delete(key),
  } as unknown as KVNamespace;
}

/** The script's work, with what it reads injectable; returns the exit code. */
export async function run(argv: string[], deps: Deps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  const fetchImpl = deps.fetch ?? fetch;
  const readFile =
    deps.readFile ?? ((path: string) => readFileFs(path, "utf8"));
  const lang = option(argv, "lang");
  const base = option(argv, "base")?.replace(/\/+$/, "");
  const listFile = option(argv, "list");
  if (!lang || (!base && !listFile)) {
    err(
      "Usage: packs-parts-stamps --list <file> [--originals <file>] | --base <Worker URL> (dispatch off), [--builder <file|url>] --lang <code>",
    );
    return 2;
  }
  const packs =
    base && `${base.replace(/\/v2$/, "")}/v2/packs/${CURRENT_PARTS_COMPAT}`;

  // Only a 200 is a list: the Worker answers 202 while it builds one (and may just have asked for that build).
  const fetch200 = async (url: string): Promise<string> => {
    const res = await fetchImpl(url);
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new Error(`${url} answered ${res.status}, not 200`);
    }
    return res.text();
  };
  const partsList = (text: string, from: string): PartsListLite => {
    const parsed = JSON.parse(text) as PartsListLite | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.schema !== 2
    ) {
      throw new Error(`${from} is not a schema 2 parts list`);
    }
    return parsed;
  };
  const fromWorker = async (url: string) => partsList(await fetch200(url), url);
  const fromFile = async (path: string) =>
    partsList(await readFile(path), path);
  let list: PartsListLite;
  let originals: PartsListLite | null = null;
  try {
    list = listFile
      ? await fromFile(listFile)
      : await fromWorker(`${packs}/${lang}`);
    if (!list.stamps) {
      const originalsFile = option(argv, "originals");
      const sha = list.originals?.sha256;
      if (originalsFile) {
        originals = await fromFile(originalsFile);
      } else if (packs && sha) {
        originals = await fromWorker(`${packs}/originals/${sha}`);
      }
      err(
        `The list has no stamps (published before tc-study recorded them): comparing its resources${originals ? " and its originals list's" : ""}.`,
      );
    }
  } catch (e) {
    err(
      `Could not read the list: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 2;
  }

  let builder: PartsBuilder | null = null;
  const builderSource = option(argv, "builder");
  if (builderSource) {
    try {
      builder = parsePartsBuilder(
        /^https?:\/\//.test(builderSource)
          ? await fetch200(builderSource)
          : await readFile(builderSource),
      );
      if (!builder) throw new Error(`${builderSource} is not a builder file`);
    } catch (e) {
      err(
        `Could not read the builder file: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 2;
    }
  }

  const observed = await (deps.observe ?? observeParts)({
    language: lang,
    env: { TRANSLATION_HELPS_CACHE: memoryKv() },
    ctx: {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if ("unknown" in observed) {
    out(JSON.stringify({ unknown: observed.unknown }, null, 2));
    return 1;
  }
  if (observed.unreadable?.length) {
    // Left out, so their keys show as only in the list: the gate does not pass until they are read.
    err(`Unreadable, so not compared: ${observed.unreadable.join("; ")}`);
  }
  const built = builtStamps(list, originals);
  const report = diffForReport(built, comparedStamps(built, observed.stamps));
  if (builder && builder.compat !== CURRENT_PARTS_COMPAT) {
    err(
      `The builder builds ${builder.compat}, not ${CURRENT_PARTS_COMPAT}: its code is not compared (the check logs compat-drift and rebuilds no code).`,
    );
  } else if (builder && builder.code !== list.code) {
    // As the check: a code change asks for a rebuild, until an ok run of that code.
    report.push({ key: "code", list: list.code, now: builder.code });
  }
  out(report.length ? JSON.stringify(report, null, 2) : "[]");
  return report.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await run(process.argv.slice(2));
}
