/**
 * What a parts list is built from, as Door43 and GitHub have it now, keyed and stamped exactly as tc-study's build
 * writes `PartsList.stamps` (resource-pipeline `buildLanguageParts.ts`, `ResourceFiles.stamp`). The Worker compares
 * the two maps as strings, so every rule here is a copy of tc-study's, named at each; a key derived another way
 * would read as a change on every check.
 *
 * The inputs: the language's rows of the tc-ready catalog search, UHB and UGNT, the language's two lexicons and
 * MACULA (Taller's `public/trees` and `public/referents`).
 */

import type { CatalogEntry } from "@translation-helps/door43";
import {
  catalogKey,
  catalogResourceId,
  currentStamps,
  freshSearch,
  type FreshnessEnv,
  type Search,
} from "./freshness.js";
import {
  GITHUB_API,
  forgetInstallationToken,
  githubHeaders,
  installationToken,
} from "./githubApp";

const DOOR43 = "https://git.door43.org";

/**
 * The subjects a parts build reads (spec 2026-10-21-language-packs-parts-design.md §2, "The type comes from the
 * Door43 subject", tc-study's resource types). The OBS subjects are here as they are there; `isObsRow` then leaves
 * them out, since OBS is off.
 */
export const PARTS_SUBJECTS: ReadonlySet<string> = new Set([
  "Bible",
  "Aligned Bible",
  "Greek New Testament",
  "Hebrew Old Testament",
  "TSV Translation Notes",
  "TSV Translation Questions",
  "TSV Translation Words Links",
  "Translation Words",
  "Translation Academy",
  "Open Bible Stories",
  "OBS Translation Notes",
  "OBS Translation Questions",
  "OBS Translation Words Links",
  "TSV OBS Translation Notes",
  "TSV OBS Translation Questions",
  "TSV OBS Translation Words Links",
]);

/** tc-study resource-pipeline `door43Stamps.ts` `isObs`: the rule the build's candidates use. */
export function isObsRow(row: { subject?: unknown }): boolean {
  return /OBS|Open Bible Stories/i.test(String(row.subject ?? ""));
}

/**
 * The language's rows a build reads, through `currentStamps` (which also leaves lexicon repositories out). A hit
 * without a release tag is left out, as tc-study's discovery leaves it (`no-release`), rather than stamped by its
 * branch. The key's id is the repository name after the first `_`. tc-study's catalogIdentity takes a hit's
 * `identifier` first; the Worker's catalog rows do not map one, so a hit whose identifier differed from its name
 * would show as a moved key in `scripts/packs-parts-stamps.ts`.
 */
export function languageStamps(
  rows: CatalogEntry[],
  language: string,
): Record<string, string> {
  return currentStamps(
    rows.filter(
      (row) =>
        row.language === language &&
        row.hasRelease !== false &&
        PARTS_SUBJECTS.has(row.subject ?? "") &&
        !isObsRow(row),
    ),
    language,
  );
}

/**
 * The owner of the language's literal text: tc-study `door43Stamps.ts` `literalTextOf`, the Aligned Bible whose id
 * ends in `lt`, the first by key (buildLanguageParts sorts its candidates by key).
 */
export function literalOwnerOf(
  rows: CatalogEntry[],
  language: string,
): string | undefined {
  const literals = rows
    .filter(
      (row) =>
        row.language === language &&
        row.hasRelease !== false &&
        row.subject === "Aligned Bible" &&
        /lt$/.test(catalogResourceId(row)),
    )
    .map((row) => ({ owner: row.owner, key: catalogKey(row, language) ?? "" }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return literals[0]?.owner;
}

/** tc-study resource-catalog `ingestReceipt.ts` `sanitizeStampPart`. */
function sanitizeStampPart(value: string): string {
  return value.replace(/[:|@]/g, "_");
}

/** tc-study `resourceContentStamp` for a release's tag (or version) and published date. */
function contentStamp(tag: string, published: string): string {
  const t = tag.trim();
  const p = published.trim();
  if (t && p) return `${sanitizeStampPart(t)}#${sanitizeStampPart(p)}`;
  if (t) return sanitizeStampPart(t);
  if (p) return sanitizeStampPart(p);
  return "nostamp";
}

/** tc-study resource-pipeline `cli/companions.ts` `lexiconStampOf`: the date as Door43 wrote it. */
export function lexiconStampOf(commit: { sha: string; date: string }): string {
  return contentStamp(commit.sha.slice(0, 10), commit.date);
}

/**
 * MACULA's stamp: tc-study `publishLanguageParts.ts` gives the build `version: commit.slice(0, 10)` and
 * `publishedAt: new Date(%cI).toISOString()`, stamped as a release. The same instant gives the same string whatever
 * offset the date was written with, so git's `%cI` and GitHub's UTC date agree. Throws on a date that does not parse.
 */
export function maculaStampOf(commit: { sha: string; date: string }): string {
  return contentStamp(
    commit.sha.slice(0, 10),
    new Date(commit.date).toISOString(),
  );
}

/** tc-study `scripture/originalLanguageSpecs.ts`: the keys are fixed, not derived from the repository name. */
const ORIGINALS = [
  {
    key: "unfoldingWord/el-x-koine/ugnt",
    subject: "Greek New Testament",
  },
  {
    key: "unfoldingWord/hbo/uhb",
    subject: "Hebrew Old Testament",
  },
] as const;

/** tc-study `cli/companions.ts` `LEXICON_OWNERS`, `lexiconRepos`. */
const LEXICON_OWNERS: Readonly<Record<string, string>> = { en: "test_org" };
const LEXICON_IDS = ["uhl", "ugl"] as const;
/** tc-study's workflow passes `--lexicons-ref master`. */
const LEXICONS_REF = "master";

/** tc-study `cli/companions.ts` `MACULA_KEYS`: both get the one stamp. */
export const MACULA_KEYS: readonly string[] = [
  "Biblica/hbo/macula",
  "Biblica/el-x-koine/macula",
];
const MACULA_REPO = "idiomaspuentes/taller";
const MACULA_PATHS = ["public/trees", "public/referents"];

/** The same originals and MACULA for every language: read once an hour, not once per language. */
const SHARED_TTL_S = 3600;
/**
 * A shared reading with an input left out is read again after this long: soon enough that a passing failure does not
 * hide a release for the hour, late enough that one cron run (five checks) asks Door43 or GitHub only once.
 */
const PARTIAL_TTL_S = 600;
const ORIGINALS_CACHE = "packs:originals";
const MACULA_CACHE = "packs:macula";

/**
 * What the build would read, as Door43 and GitHub have it now. An input that cannot be read is left out of `stamps`
 * and named in `unreadable`: a key only in the list is never a change, so leaving one out cannot ask for a build,
 * and the other inputs are still compared. `unknown` only when the language's own search fails or has no row of it.
 */
export type Observed =
  | { stamps: Record<string, string>; unreadable?: string[] }
  | { unknown: string };

/** What a reader got, and why anything it would have read was left out. */
type Reading<T> = { value: T; unreadable: string[] };

/** Thrown for an input that cannot be read; its message is the reason logged. */
class Unreadable extends Error {}

const reason = (err: unknown) =>
  err instanceof Unreadable ? err.message : String(err);

type Shared<T> = { at: string; reading: Reading<T> };

async function cached<T>(
  kv: KVNamespace,
  key: string,
  now: Date,
  read: () => Promise<Reading<T>>,
): Promise<Reading<T>> {
  try {
    const hit = JSON.parse((await kv.get(key)) ?? "null") as Shared<T> | null;
    const at = Date.parse(hit?.at ?? "");
    const reading = hit?.reading;
    if (reading && Array.isArray(reading.unreadable) && !Number.isNaN(at)) {
      const ttl = reading.unreadable.length ? PARTIAL_TTL_S : SHARED_TTL_S;
      if (now.getTime() - at < ttl * 1000) return reading;
    }
  } catch {
    // A miss.
  }
  const reading = await read();
  try {
    const entry: Shared<T> = { at: now.toISOString(), reading };
    await kv.put(key, JSON.stringify(entry), { expirationTtl: SHARED_TTL_S });
  } catch {
    // Read again next time.
  }
  return reading;
}

type RawOriginalHit = {
  tag_name?: string;
  released?: string;
  release?: { tag_name?: string; published_at?: string };
};

/**
 * UHB and UGNT as tc-study's `discover/originalLanguageCatalog.ts` finds them: Door43ApiClient.searchCatalog with
 * owner, subject, `stage=prod` and `limit=1`, without the tc-ready topic `catalogSearch` always adds. No `lang`: the
 * build passes `lang:`, but searchCatalog reads `language`, so its real query has none, and the Worker sends what the
 * build sends so that both find the same row. Both sides should move to `language=` together. Stamped
 * as `createResourceMetadata` builds the row (tag `release.tag_name ?? tag_name`, date `release.published_at ||
 * released`), then `resourceContentStamp`. Each original is read on its own: one Door43 cannot give is left out.
 */
async function originalStamps(
  fetchImpl: typeof fetch,
): Promise<Reading<Record<string, string>>> {
  const stamps: Record<string, string> = {};
  const unreadable: string[] = [];
  await Promise.all(
    ORIGINALS.map(async ({ key, subject }) => {
      try {
        const query = new URLSearchParams();
        query.append("owner", "unfoldingWord");
        query.append("subject", subject);
        query.append("stage", "prod");
        query.append("limit", "1");
        const res = await fetchImpl(
          `${DOOR43}/api/v1/catalog/search?${query}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) {
          await res.body?.cancel();
          throw new Unreadable(`Door43 answered ${res.status} for ${key}`);
        }
        const body = (await res.json()) as { ok?: boolean; data?: unknown };
        const hit = (
          body?.ok && Array.isArray(body.data) ? body.data[0] : undefined
        ) as RawOriginalHit | undefined;
        const tag = hit?.release?.tag_name ?? hit?.tag_name;
        if (!hit || !tag) {
          throw new Unreadable(`Door43 has no release of ${key}`);
        }
        stamps[key] = contentStamp(
          tag,
          hit.release?.published_at || hit.released || "",
        );
      } catch (err) {
        unreadable.push(
          err instanceof Unreadable ? err.message : `${key}: ${String(err)}`,
        );
      }
    }),
  );
  return { value: stamps, unreadable: unreadable.sort() };
}

type RawCommit = {
  sha?: string;
  created?: string;
  commit?: { committer?: { date?: string } };
};

/**
 * The lexicons at master, as tc-study's `resolveLexicon` reads them: the first commit Door43 lists, dated `created`,
 * else the committer's date. Only a repository that answers 404 is no lexicon, as there; a repository without the ref,
 * or anything else that gives no commit and date, is unreadable (where tc-study's build would fail) and left out.
 */
async function lexiconStamps(
  language: string,
  owner: string,
  fetchImpl: typeof fetch,
): Promise<Reading<Record<string, string>>> {
  const stamps: Record<string, string> = {};
  const unreadable: string[] = [];
  await Promise.all(
    LEXICON_IDS.map(async (id) => {
      const repo = `${encodeURIComponent(owner)}/${encodeURIComponent(`${language}_${id}`)}`;
      try {
        const info = await fetchImpl(`${DOOR43}/api/v1/repos/${repo}`, {
          headers: { Accept: "application/json" },
        });
        await info.body?.cancel();
        // Only a repository Door43 lacks is no lexicon; one without the ref fails tc-study's build.
        if (info.status === 404) return;
        if (!info.ok) {
          throw new Unreadable(`Door43 answered ${info.status} for ${repo}`);
        }
        const res = await fetchImpl(
          `${DOOR43}/api/v1/repos/${repo}/commits?sha=${LEXICONS_REF}&limit=1&stat=false&files=false&verification=false`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) {
          await res.body?.cancel();
          throw new Unreadable(
            `${repo} has no ref ${LEXICONS_REF} (Door43 answered ${res.status})`,
          );
        }
        const [commit] = (await res.json()) as RawCommit[];
        const date = commit?.created ?? commit?.commit?.committer?.date;
        if (!commit?.sha || !date) {
          throw new Unreadable(`${repo} has no commit at ${LEXICONS_REF}`);
        }
        stamps[`${owner}/${language}/${id}`] = lexiconStampOf({
          sha: commit.sha,
          date,
        });
      } catch (err) {
        unreadable.push(
          err instanceof Unreadable ? err.message : `${repo}: ${String(err)}`,
        );
      }
    }),
  );
  return { value: stamps, unreadable: unreadable.sort() };
}

/**
 * MACULA's commit as tc-study's `cli/maculaIdentity.ts` takes it from a clone of Taller's default branch:
 * `git log -1 -- public/trees public/referents`, the newer of the last commits touching each folder, dated by its
 * committer. With the App's installation token when the App is configured, else without one. Unreadable (no token, a
 * refusal, GitHub's rate limit, no dated commit) is no commit.
 */
async function maculaCommit(
  env: FreshnessEnv,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<Reading<{ sha: string; date: string } | null>> {
  try {
    return {
      value: await readMaculaCommit(env, now, fetchImpl),
      unreadable: [],
    };
  } catch (err) {
    return { value: null, unreadable: [`MACULA: ${reason(err)}`] };
  }
}

async function readMaculaCommit(
  env: FreshnessEnv,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<{ sha: string; date: string }> {
  const kv = env.TRANSLATION_HELPS_CACHE;
  const app = Boolean(
    env.GITHUB_APP_ID &&
      env.GITHUB_APP_PRIVATE_KEY &&
      env.GITHUB_APP_INSTALLATION_ID,
  );
  let headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "translation-helps-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (app) {
    try {
      headers = githubHeaders(await installationToken(env, kv, now, fetchImpl));
    } catch (err) {
      throw new Unreadable(`no GitHub token: ${String(err)}`);
    }
  }
  const latest = await Promise.all(
    MACULA_PATHS.map(async (path) => {
      const query = new URLSearchParams({ path, per_page: "1" });
      const res = await fetchImpl(
        `${GITHUB_API}/repos/${MACULA_REPO}/commits?${query}`,
        { headers },
      );
      if (!res.ok) {
        await res.body?.cancel();
        // A token GitHub no longer accepts is minted again on the next check.
        if (app && res.status === 401) await forgetInstallationToken(env, kv);
        throw new Unreadable(`GitHub answered ${res.status} for ${path}`);
      }
      const [commit] = (await res.json()) as RawCommit[];
      const date = commit?.commit?.committer?.date;
      if (!commit?.sha || !date || Number.isNaN(Date.parse(date))) {
        throw new Unreadable(`GitHub gave no dated commit for ${path}`);
      }
      return { sha: commit.sha, date };
    }),
  );
  return latest.reduce((a, b) =>
    Date.parse(b.date) > Date.parse(a.date) ? b : a,
  );
}

/**
 * Never throws. `unknown` only when the language's search fails or has no row of the language (which is also how a
 * Door43 network failure reads): then there is nothing to compare. Any other input that cannot be read (an original,
 * a lexicon, MACULA) is left out and named in `unreadable`. A language without a literal text gets no lexicons, as
 * the build reads them only from its literal text's owner.
 */
export async function observeParts(o: {
  language: string;
  env: FreshnessEnv;
  ctx: ExecutionContext;
  now?: Date;
  search?: Search;
  fetch?: typeof fetch;
}): Promise<Observed> {
  const { language, env } = o;
  const now = o.now ?? new Date();
  const fetchImpl = o.fetch ?? fetch;
  const kv = env.TRANSLATION_HELPS_CACHE;
  try {
    const rows = await (o.search ?? freshSearch)(language, env, o.ctx);
    if (!rows.some((row) => row.language === language)) {
      return { unknown: `the catalog search has no row of ${language}` };
    }
    // buildLanguageParts reads the lexicons only when the language has a literal text with an owner, en included.
    const literalOwner = literalOwnerOf(rows, language);
    const lexiconOwner = literalOwner
      ? (LEXICON_OWNERS[language] ?? literalOwner)
      : undefined;

    const [originals, lexicons, macula] = await Promise.all([
      cached(kv, ORIGINALS_CACHE, now, () => originalStamps(fetchImpl)),
      lexiconOwner
        ? lexiconStamps(language, lexiconOwner, fetchImpl)
        : { value: {}, unreadable: [] },
      cached(kv, MACULA_CACHE, now, () => maculaCommit(env, now, fetchImpl)),
    ]);
    const maculaStamp = macula.value ? maculaStampOf(macula.value) : null;
    const unreadable = [
      ...originals.unreadable,
      ...lexicons.unreadable,
      ...macula.unreadable,
    ];
    return {
      stamps: {
        ...languageStamps(rows, language),
        ...originals.value,
        // As in the build, a lexicon's commit stamp wins over any catalog row of the same key.
        ...lexicons.value,
        ...(maculaStamp
          ? Object.fromEntries(MACULA_KEYS.map((key) => [key, maculaStamp]))
          : {}),
      },
      ...(unreadable.length ? { unreadable } : {}),
    };
  } catch (err) {
    return { unknown: reason(err) };
  }
}
