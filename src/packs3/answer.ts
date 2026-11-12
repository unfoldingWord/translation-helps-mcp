import { parseTrustedKeys, warnOnce } from "./keys";
import type { Packs3Env } from "./catalogs";
import {
  helpsAdapterParams,
  notesFromPacks3,
  wordLinksFromPacks3,
} from "./adapters/helps";
import {
  scriptureAdapterParams,
  scriptureFromPacks3,
} from "./adapters/scripture";

/** `auto` tries format 3 then the API; `off` skips format 3; `only` never calls the API (comparisons only). */
export type Packs3Mode = "auto" | "off" | "only";

export type Packs3Params = Record<string, string | number | undefined>;

export type Packs3Adapter = {
  match: (path: string) => boolean;
  run: (
    env: Packs3Env,
    path: string,
    params: Packs3Params,
  ) => Promise<unknown | undefined>;
};

/** One entry per API path format 3 can answer. Tasks 5-9 add them. */
export const ADAPTERS: Packs3Adapter[] = [
  {
    match: (path) => path === "/api/v1/scripture",
    run: (env, _path, params) =>
      scriptureFromPacks3(env, scriptureAdapterParams(params)),
  },
  {
    match: (path) => path === "/api/v1/notes",
    run: (env, _path, params) =>
      notesFromPacks3(env, helpsAdapterParams(params)),
  },
  {
    match: (path) => path === "/api/v1/word-links",
    run: (env, _path, params) =>
      wordLinksFromPacks3(env, helpsAdapterParams(params)),
  },
];

export type Packs3Attempt =
  | { hit: true; value: unknown }
  | { hit: false; reason: string };

function langOf(params: Packs3Params): string {
  const l = params.language ?? params.lang;
  return l === undefined || l === "" ? "-" : String(l);
}

/** Like `answerFromPacks3`, but says why format 3 did not answer. */
export async function attemptPacks3(
  env: Packs3Env,
  path: string,
  params: Packs3Params,
): Promise<Packs3Attempt> {
  if (env.PACKS_V3 !== "on") return { hit: false, reason: "v3-off" };
  if (!parseTrustedKeys(env.PACKS_V3_TRUSTED_KEYS)) {
    return { hit: false, reason: "no-keys" };
  }
  const adapter = ADAPTERS.find((a) => a.match(path));
  if (!adapter) return { hit: false, reason: "no-adapter" };
  try {
    const value = await adapter.run(env, path, params);
    if (value === undefined) {
      warnOnce(langOf(params), "adapter-undefined");
      return { hit: false, reason: "adapter-undefined" };
    }
    return { hit: true, value };
  } catch {
    warnOnce(langOf(params), "adapter-exception");
    return { hit: false, reason: "adapter-exception" };
  }
}

/** The answer format 3 gives for an API path, or `undefined` to fall back to the API Worker. */
export async function answerFromPacks3(
  env: Packs3Env,
  path: string,
  params: Packs3Params,
): Promise<unknown | undefined> {
  const a = await attemptPacks3(env, path, params);
  return a.hit ? a.value : undefined;
}
