import { parseTrustedKeys, takeNotedReason, warnOnce } from "./keys";
import type { Packs3Env } from "./catalogs";
import {
  academyPathFromPacks3,
  articleAdapterParams,
  wordsPathFromPacks3,
} from "./adapters/articles";
import {
  helpsAdapterParams,
  notesFromPacks3,
  wordLinksFromPacks3,
} from "./adapters/helps";
import {
  questionsAdapterParams,
  questionsFromPacks3,
} from "./adapters/questions";
import {
  scriptureAdapterParams,
  scriptureFromPacks3,
} from "./adapters/scripture";
import { searchAdapterParams, searchFromPacks3 } from "./adapters/search";

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
  {
    match: (path) => path === "/api/v1/questions",
    run: (env, _path, params) =>
      questionsFromPacks3(env, questionsAdapterParams(params)),
  },
  {
    match: (path) => path.startsWith("/api/v1/words/") && path.length > 14,
    run: (env, path, params) =>
      wordsPathFromPacks3(
        env,
        articleAdapterParams(path, "/api/v1/words/", params),
      ),
  },
  {
    match: (path) => path.startsWith("/api/v1/academy/") && path.length > 16,
    run: (env, path, params) =>
      academyPathFromPacks3(
        env,
        articleAdapterParams(path, "/api/v1/academy/", params),
      ),
  },
  {
    match: (path) => path === "/api/v1/search",
    run: (env, _path, params) =>
      searchFromPacks3(env, searchAdapterParams(params)),
  },
];

/**
 * `status` is set only for a proven route error (an article lookup's 404 miss): `value` is then the route's error body,
 * and the caller treats it as the API's own non-2xx answer (apiClient throws the same `ApiClientError`).
 */
export type Packs3Attempt =
  | { hit: true; value: unknown; status?: number }
  | { hit: false; reason: string; detail?: string };

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
    takeNotedReason();
    const value = await adapter.run(env, path, params);
    if (value === undefined) {
      // The adapter's own last logged reason (debug only; another call overlapping this one may have set it).
      const detail = takeNotedReason();
      warnOnce(langOf(params), "adapter-undefined");
      return {
        hit: false,
        reason: "adapter-undefined",
        ...(detail ? { detail } : {}),
      };
    }
    // An adapter answers a route error as the route's own `Response` (only a 404, the proven miss of a term lookup).
    if (value instanceof Response) {
      if (value.status !== 404) {
        warnOnce(langOf(params), "adapter-status");
        return { hit: false, reason: "adapter-status" };
      }
      return { hit: true, status: 404, value: await value.json() };
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
  // A proven route error (the 404 miss) is not an answer: it flows only through `attemptPacks3` to the API client.
  return a.hit && a.status === undefined ? a.value : undefined;
}
