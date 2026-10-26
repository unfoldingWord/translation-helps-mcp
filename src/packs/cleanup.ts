/**
 * Deletes parts that no list has named for 30 days (delivery 3, Task 8), and the content-addressed originals lists no
 * language list names any more. Nothing else in the bucket is ever deleted: only keys shaped `parts/<sha256>.part.gz`
 * and `catalog/<parts compat>/originals/<sha256>.json` can be candidates, so `packs/`, `v1/`, `status/`, `cleanup/`,
 * every `catalog/f1.*` key, every language list and every `originals.json` are out of reach by construction.
 *
 * Named is what any current list names, in every parts compat (an older app may still read an older compat): every
 * part of every language list and of `originals.json`, the originals list each language list names and its parts, and
 * the content-addressed copy of `originals.json`. A part is due when the first run that found it unnamed was 30 days
 * ago and R2 last wrote it 30 days ago too; those first dates are kept in a ledger.
 *
 * The ledger is the R2 object `cleanup/parts-orphans.json`, not a KV value: R2 reads its own writes, while KV may
 * serve a read up to a minute old, and a stale ledger could keep an old first date for a part a list named in
 * between, which would shorten its 30 days. It also lives beside what it describes (the staging and production
 * buckets each have their own), and at about 100 bytes a key it stays small.
 *
 * Safe in every order, as far as the Worker can make it:
 * - a parts build that is `running` (in any parts compat, even one with no list yet) postpones the run;
 * - any list or listing that cannot be read, and any list that does not parse, aborts it: a partial view never deletes;
 * - right before deleting, it lists again: a new parts compat, a status that turned `running`, or any list added,
 *   removed or rewritten since it was read aborts the run, and the ledger is left as it was;
 * - "30 days in a row" needs runs to watch them: when the last finished run is more than `LEDGER_GAP_MS` old (the
 *   cleanup was off, aborted or postponed for days), every count starts again;
 * - one run makes at most `CLEANUP_R2_CALLS` R2 calls before its ledger write (under the Free plan's 1,000 calls to
 *   Cloudflare services per invocation; the cleanup has its own cron, so its own invocation) and deletes at most
 *   `MAX_DELETES` keys, in one call; a run that would need more aborts before deleting anything.
 *
 * Each run records the day's outcome (`done`, `postponed` or `aborted`) in the ledger, without touching the first
 * dates or `checked`, so the 04 and 05 UTC retries run only when the day's cleanup did not finish
 * (`cleanupOutcome`), and `ABORT_ALERT_DAYS` days in a row that end aborted log `[packs] cleanup-alert:`, the tag
 * an alert can watch for. A run the runtime kills records nothing; the retries log that under the same tag.
 *
 * What it cannot close: a build reads `has(part)` to skip uploading a part the bucket already has. A build that
 * started after the last listing (milliseconds before the delete) and found an orphan due that very moment would
 * name a deleted part. A build writes `running` minutes before its first `has` (it builds its tools and downloads
 * first), so that window is far shorter than any build's; a status that turned `running` during the deletes is
 * still logged as an error, naming the language, so a person can rebuild it with `force`, and so is a list written
 * since the last look that names a deleted key. tc-study closes it on its side by checking again (HEAD) every part it
 * skipped right before it writes the list.
 *
 * Two runs at once (a cron delivered twice) are safe too: each reads, rechecks and deletes the same due keys, a
 * delete of a key already gone is a no-op, and each writes the ledger it computed from the same reading.
 */

import { COMPAT_RE, RUNNING_STALE_MS, isPartsCompat } from "./dispatch.js";
import { originalsPathOf } from "./partsFreshness.js";
import type { CleanupMode } from "./scheduled.js";

export type CleanupEnv = {
  LANGUAGE_PACKS?: R2Bucket;
  ANALYTICS?: AnalyticsEngineDataset;
};

export type CleanupSummary = {
  state: "done" | "postponed" | "aborted";
  why?: string;
  /** Keys a current list names: parts and originals lists. */
  named: number;
  /** Candidates: parts and originals lists no list names. */
  orphans: number;
  /** Candidates unnamed for `ORPHAN_DAYS`, and written that long ago. */
  due: number;
  deleted: number;
  /** Bytes deleted, or that a dry run would have deleted. */
  bytes: number;
};

export type CleanupState = CleanupSummary["state"];

type Ledger = {
  schema: 1;
  /** When the last finished run wrote it. */
  checked?: string;
  /** Candidate key → when a run first found it unnamed. */
  since: Record<string, string>;
  /** UTC day → the outcome of that day's last run, for the retries and the alert; the last `OUTCOME_DAYS` days. */
  outcomes?: Record<string, CleanupState>;
};

const DAY_MS = 24 * 3_600_000;
export const ORPHAN_DAYS = 30;
/** R2 deletes at most 1000 keys in one call. */
export const MAX_DELETES = 1000;
export const LEDGER = "cleanup/parts-orphans.json";
/** Two missed daily runs are fine; a longer gap restarts every count. */
export const LEDGER_GAP_MS = 3 * DAY_MS;
export const CLEANUP_R2_CALLS = 800;
/** Days in a row that end aborted before the run logs `[packs] cleanup-alert:`. */
export const ABORT_ALERT_DAYS = 3;
const OUTCOME_DAYS = 7;
/** The prefix every cleanup alert is logged with (`console.error`), the tag an alert can watch for. */
export const ALERT_TAG = "[packs] cleanup-alert:";

const SHA256_RE = /^[0-9a-f]{64}$/;
const PART_KEY_RE = /^parts\/[0-9a-f]{64}\.part\.gz$/;
const LEDGER_METADATA = {
  httpMetadata: { contentType: "application/json", cacheControl: "no-cache" },
};

/** Thrown for anything that stops the run; its message is the reason logged. */
class Stop extends Error {
  constructor(
    readonly state: "postponed" | "aborted",
    message: string,
  ) {
    super(message);
  }
}

/** The only keys this module may delete. */
function deletable(key: string): boolean {
  if (PART_KEY_RE.test(key)) return true;
  const m = /^catalog\/([^/]+)\/originals\/([0-9a-f]{64})\.json$/.exec(key);
  return Boolean(m && isPartsCompat(m[1]!) && COMPAT_RE.test(m[1]!));
}

/** The bucket, counting its calls: one more than the budget stops the run. */
function counted(bucket: R2Bucket) {
  let calls = 0;
  const spend = () => {
    if (++calls > CLEANUP_R2_CALLS) {
      throw new Stop(
        "aborted",
        `more than ${CLEANUP_R2_CALLS} R2 calls in one run`,
      );
    }
  };
  return {
    get calls() {
      return calls;
    },
    async list(o: R2ListOptions): Promise<R2Objects> {
      spend();
      try {
        return await bucket.list(o);
      } catch (err) {
        throw new Stop("aborted", `listing ${o.prefix} failed: ${String(err)}`);
      }
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      spend();
      try {
        return await bucket.get(key);
      } catch (err) {
        throw new Stop("aborted", `reading ${key} failed: ${String(err)}`);
      }
    },
    /** The ledger's write, the run's last call: never refused, so deletes already made are always recorded. */
    async put(key: string, value: string): Promise<void> {
      calls++;
      await bucket.put(key, value, LEDGER_METADATA);
    },
    /** As `get`, but never refused: the checks after the deletes, which must not stop the ledger's write. */
    async getReserved(key: string): Promise<R2ObjectBody | null> {
      calls++;
      return bucket.get(key);
    },
    async delete(keys: string[]): Promise<void> {
      spend();
      await bucket.delete(keys);
    },
  };
}

type Bucket = ReturnType<typeof counted>;
type Listed = { key: string; etag: string; size: number; uploaded: Date };

/** Every page of a listing: its objects and its folders. */
async function listAll(
  r2: Bucket,
  prefix: string,
  delimiter?: "/",
): Promise<{ objects: Listed[]; folders: string[] }> {
  const objects: Listed[] = [];
  const folders: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await r2.list({
      prefix,
      ...(cursor ? { cursor } : {}),
      ...(delimiter ? { delimiter } : {}),
    });
    for (const o of page.objects) {
      objects.push({
        key: o.key,
        etag: o.etag,
        size: o.size,
        uploaded: o.uploaded,
      });
    }
    folders.push(...(page.delimitedPrefixes ?? []));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { objects, folders };
}

/** The parts compats the bucket has a folder for, under `catalog/` or only under `status/` (a first build). */
async function partsCompats(r2: Bucket): Promise<string[]> {
  const compats = new Set<string>();
  for (const root of ["catalog/", "status/"]) {
    for (const folder of (await listAll(r2, root, "/")).folders) {
      const compat = folder.slice(root.length, -1);
      if (isPartsCompat(compat)) compats.add(compat);
    }
  }
  return [...compats].sort();
}

/** Each parts compat's statuses, key → etag; stops when a build is running. */
async function statuses(
  r2: Bucket,
  compats: string[],
  now: Date,
  only?: Map<string, string>,
): Promise<Map<string, string>> {
  const etags = new Map<string, string>();
  for (const compat of compats) {
    for (const o of (await listAll(r2, `status/${compat}/`)).objects) {
      etags.set(o.key, o.etag);
      // On a second look, only a status written since the first is read again.
      if (only && only.get(o.key) === o.etag) continue;
      const object = await r2.get(o.key);
      if (object && isRunning(await object.text(), now)) {
        throw new Stop(only ? "aborted" : "postponed", `${o.key} is running`);
      }
    }
  }
  return etags;
}

/** As the dispatch guard reads a status: `running`, and younger than RUNNING_STALE_MS (an unreadable date is old). */
function isRunning(raw: string, now: Date): boolean {
  try {
    const s = JSON.parse(raw) as { state?: unknown; at?: unknown } | null;
    if (s?.state !== "running" || typeof s.at !== "string") return false;
    const at = Date.parse(s.at);
    return !Number.isNaN(at) && now.getTime() - at < RUNNING_STALE_MS;
  } catch {
    return false;
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type ListShape = {
  parts?: unknown;
  originals?: { path?: unknown; sha256?: unknown };
};

/** A list's text, read whole and parsed; anything else stops the run. */
async function readList(
  r2: Bucket,
  key: string,
): Promise<{ list: ListShape; bytes: ArrayBuffer }> {
  const object = await r2.get(key);
  if (!object) throw new Stop("aborted", `${key} vanished while it was read`);
  const bytes = await object.arrayBuffer();
  let list: ListShape;
  try {
    list = JSON.parse(new TextDecoder().decode(bytes)) as ListShape;
  } catch {
    throw new Stop("aborted", `${key} does not parse`);
  }
  if (!list || !Array.isArray(list.parts)) {
    throw new Stop("aborted", `${key} lists no parts`);
  }
  return { list, bytes };
}

function nameParts(list: ListShape, key: string, named: Set<string>): void {
  for (const part of list.parts as Array<{ sha256?: unknown }>) {
    if (typeof part?.sha256 !== "string" || !SHA256_RE.test(part.sha256)) {
      throw new Stop("aborted", `${key} names a part without a sha256`);
    }
    named.add(`parts/${part.sha256}.part.gz`);
  }
}

/** Everything the current lists name, and each compat's top-level lists, key → etag, to see them change. */
async function readNamed(
  r2: Bucket,
  compats: string[],
): Promise<{ named: Set<string>; lists: Map<string, string> }> {
  const named = new Set<string>();
  const lists = new Map<string, string>();
  const originals = new Set<string>();
  for (const compat of compats) {
    const top = `catalog/${compat}/`;
    for (const o of (await topLists(r2, top)).values()) {
      lists.set(o.key, o.etag);
      const { list, bytes } = await readList(r2, o.key);
      nameParts(list, o.key, named);
      if (o.key === `${top}originals.json`) {
        // The latest originals list, at its content address too: the next build names it.
        named.add(`${top}originals/${await sha256Hex(bytes)}.json`);
        continue;
      }
      const path = originalsPathOf(compat, list.originals);
      if (!path) {
        throw new Stop(
          "aborted",
          `${o.key} names no originals list by content`,
        );
      }
      named.add(path);
      originals.add(path);
    }
  }
  for (const key of [...originals].sort()) {
    const object = await r2.get(key);
    if (!object)
      throw new Stop(
        "aborted",
        `a language list names ${key}, which is missing`,
      );
    let list: ListShape;
    try {
      list = JSON.parse(await object.text()) as ListShape;
    } catch {
      throw new Stop("aborted", `${key} does not parse`);
    }
    if (!list || !Array.isArray(list.parts)) {
      throw new Stop("aborted", `${key} lists no parts`);
    }
    nameParts(list, key, named);
  }
  return { named, lists };
}

/** The `.json` objects right under a compat's folder: its language lists and `originals.json`. */
async function topLists(r2: Bucket, top: string): Promise<Map<string, Listed>> {
  const out = new Map<string, Listed>();
  for (const o of (await listAll(r2, top, "/")).objects) {
    if (o.key.endsWith(".json")) out.set(o.key, o);
  }
  return out;
}

async function candidates(
  r2: Bucket,
  compats: string[],
  named: Set<string>,
): Promise<Listed[]> {
  const out: Listed[] = [];
  const unnamed = (o: Listed) => deletable(o.key) && !named.has(o.key);
  out.push(...(await listAll(r2, "parts/")).objects.filter(unnamed));
  for (const compat of compats) {
    const folder = `catalog/${compat}/originals/`;
    out.push(...(await listAll(r2, folder, "/")).objects.filter(unnamed));
  }
  return out;
}

/** The ledger, or null when there is none; `unparsable` when there is one that does not parse. */
function parseLedger(raw: string): Ledger | null {
  try {
    const l = JSON.parse(raw) as Partial<Ledger> | null;
    if (l?.schema === 1 && l.since && typeof l.since === "object") {
      const outcomes =
        l.outcomes && typeof l.outcomes === "object" ? l.outcomes : undefined;
      return {
        schema: 1,
        since: l.since,
        ...(typeof l.checked === "string" ? { checked: l.checked } : {}),
        ...(outcomes ? { outcomes } : {}),
      };
    }
  } catch {
    // Not a ledger.
  }
  return null;
}

type LedgerRead = { ledger: Ledger | null; unparsable: boolean };

async function readLedger(r2: Bucket): Promise<LedgerRead> {
  const object = await r2.get(LEDGER);
  if (!object) return { ledger: null, unparsable: false };
  const ledger = parseLedger(await object.text());
  if (ledger) return { ledger, unparsable: false };
  console.error(
    `[packs] cleanup: ${LEDGER} does not parse; counting again from today`,
  );
  return { ledger: null, unparsable: true };
}

/** The outcome of `day`'s last cleanup run, or null when none is recorded or the ledger cannot be read. */
export async function cleanupOutcome(
  env: CleanupEnv,
  day: string,
): Promise<CleanupState | null> {
  try {
    const object = await env.LANGUAGE_PACKS?.get(LEDGER);
    const outcome = object
      ? parseLedger(await object.text())?.outcomes?.[day]
      : undefined;
    return outcome === "done" ||
      outcome === "postponed" ||
      outcome === "aborted"
      ? outcome
      : null;
  } catch {
    return null;
  }
}

/** The outcomes with `day`'s set, the last `OUTCOME_DAYS` days kept. */
function withOutcome(
  outcomes: Ledger["outcomes"],
  day: string,
  state: CleanupState,
): Record<string, CleanupState> {
  const oldest = Date.parse(day) - (OUTCOME_DAYS - 1) * DAY_MS;
  const kept = Object.entries({ ...outcomes, [day]: state })
    .filter(([d]) => Date.parse(d) >= oldest && d <= day)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(kept);
}

/** The days in a row, ending with `day`, whose outcome is `aborted`, and the first of them. */
function abortStreak(
  outcomes: Record<string, CleanupState>,
  day: string,
): { days: number; since: string } {
  let days = 0;
  let since = day;
  for (let t = Date.parse(day); ; t -= DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (outcomes[d] !== "aborted") break;
    days++;
    since = d;
  }
  return { days, since };
}

/**
 * A run that stopped records its outcome and nothing else: the first dates and `checked` stay as they were. With a
 * ledger that does not parse, nothing is written (the next finished run replaces it). Never throws.
 */
async function recordStop(
  r2: Bucket,
  read: LedgerRead | undefined,
  day: string,
  stop: Stop,
  tag: string,
): Promise<void> {
  try {
    // A run that stopped before reading the ledger reads it now.
    const current =
      read ??
      (await (async () => {
        const object = await r2.getReserved(LEDGER);
        if (!object) return { ledger: null, unparsable: false };
        const ledger = parseLedger(await object.text());
        return { ledger, unparsable: !ledger };
      })());
    if (current.unparsable) return;
    const base: Ledger = current.ledger ?? { schema: 1, since: {} };
    const outcomes = withOutcome(base.outcomes, day, stop.state);
    await r2.put(LEDGER, JSON.stringify({ ...base, outcomes }));
    const streak = abortStreak(outcomes, day);
    if (stop.state === "aborted" && streak.days >= ABORT_ALERT_DAYS) {
      console.error(
        `${ALERT_TAG} aborted ${streak.days} days in a row (since ${streak.since}); last: ${stop.message}`,
      );
    }
  } catch (err) {
    console.error(`${tag}: could not record the day's outcome:`, err);
  }
}

function point(env: CleanupEnv, mode: CleanupMode, s: CleanupSummary): void {
  env.ANALYTICS?.writeDataPoint({
    indexes: ["pack"],
    blobs: ["pack", "cleanup", mode, s.state],
    doubles: [s.deleted, s.bytes, s.due],
  });
}

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Never throws: the cron's handler awaits it. `day` (UTC, `YYYY-MM-DD`) is the day the outcome is recorded for. */
export async function runPartsCleanup(
  env: CleanupEnv,
  o: { now?: Date; mode: CleanupMode; day?: string },
): Promise<CleanupSummary> {
  const now = o.now ?? new Date();
  const { mode } = o;
  const day = o.day ?? now.toISOString().slice(0, 10);
  const summary: CleanupSummary = {
    state: "done",
    named: 0,
    orphans: 0,
    due: 0,
    deleted: 0,
    bytes: 0,
  };
  const tag = `[packs] cleanup (${mode})`;
  const bucket = env.LANGUAGE_PACKS;
  if (!bucket) {
    return { ...summary, state: "aborted", why: "no bucket" };
  }
  const r2 = counted(bucket);
  let read: LedgerRead | undefined;
  try {
    // Read first, so that a run that stops anywhere can record its outcome over what it read.
    read = await readLedger(r2);
    const { ledger } = read;
    const compats = await partsCompats(r2);
    const status = await statuses(r2, compats, now);
    const { named, lists } = await readNamed(r2, compats);
    const orphans = await candidates(r2, compats, named);
    summary.named = named.size;
    summary.orphans = orphans.length;

    const checked = Date.parse(ledger?.checked ?? "");
    const restart =
      !ledger ||
      Number.isNaN(checked) ||
      now.getTime() - checked > LEDGER_GAP_MS;
    if (ledger && restart) {
      // Said once, with its reason: a dry run that would delete nothing for 30 more days is explained here.
      console.log(
        `${tag}: every count starts again, as ` +
          (Number.isNaN(checked)
            ? `the ledger has no date for a finished run`
            : `the last finished run was ${ledger.checked}, more than ${LEDGER_GAP_MS / DAY_MS} days ago`) +
          `; nothing is due before ${new Date(now.getTime() + ORPHAN_DAYS * DAY_MS).toISOString().slice(0, 10)}`,
      );
    }
    // Named keys, and keys gone from the bucket, leave the ledger: a key unnamed again starts from today.
    const since: Record<string, string> = {};
    for (const orphan of orphans) {
      const first = restart ? undefined : ledger?.since[orphan.key];
      since[orphan.key] =
        typeof first === "string" && !Number.isNaN(Date.parse(first))
          ? first
          : now.toISOString();
    }
    const cutoff = now.getTime() - ORPHAN_DAYS * DAY_MS;
    const due = orphans
      .filter(
        (c) =>
          Date.parse(since[c.key]!) <= cutoff && c.uploaded.getTime() <= cutoff,
      )
      .sort(
        (a, b) =>
          since[a.key]!.localeCompare(since[b.key]!) ||
          a.key.localeCompare(b.key),
      );
    summary.due = due.length;
    const doomed = due.slice(0, MAX_DELETES);
    summary.bytes = doomed.reduce((n, c) => n + c.size, 0);

    // Look again right before acting, in both modes, so that a dry run rehearses exactly what a delete would do.
    const again = await partsCompats(r2);
    if (again.join() !== compats.join()) {
      throw new Stop(
        "aborted",
        `the parts compats changed (${again.join(", ")})`,
      );
    }
    const statusAgain = await statuses(r2, compats, now, status);
    for (const compat of compats) {
      const top = await topLists(r2, `catalog/${compat}/`);
      const changed = [...new Set([...top.keys(), ...lists.keys()])]
        .filter((k) => k.startsWith(`catalog/${compat}/`))
        .filter((k) => top.get(k)?.etag !== lists.get(k));
      if (changed.length) {
        throw new Stop(
          "aborted",
          `lists changed while they were read (${changed.join(", ")})`,
        );
      }
    }

    if (mode === "delete" && doomed.length) {
      const keys = doomed.map((c) => c.key);
      if (!keys.every(deletable)) {
        throw new Stop(
          "aborted",
          "a key that is not a part or an originals list",
        );
      }
      await r2.delete(keys);
      summary.deleted = keys.length;
      for (const key of keys) delete since[key];
      await warnIfBuildStarted(r2, compats, now, statusAgain, tag);
      await warnIfListNamesDeleted(r2, compats, lists, named, keys, tag);
    }

    const sorted = Object.fromEntries(
      Object.entries(since).sort(([a], [b]) => a.localeCompare(b)),
    );
    const next: Ledger = {
      schema: 1,
      checked: now.toISOString(),
      since: sorted,
      outcomes: withOutcome(ledger?.outcomes, day, "done"),
    };
    try {
      await r2.put(LEDGER, JSON.stringify(next));
    } catch (err) {
      throw new Stop(
        "aborted",
        `writing ${LEDGER} failed after deleting ${summary.deleted}: ${String(err)}`,
      );
    }

    const left = summary.due - doomed.length;
    console.log(
      `${tag}: done; ${summary.named} named, ${summary.orphans} unnamed, ${summary.due} due; ` +
        (mode === "delete"
          ? `deleted ${summary.deleted} (${mb(summary.bytes)})`
          : `would delete ${doomed.length} (${mb(summary.bytes)})`) +
        (left > 0 ? `, ${left} left for the next run` : "") +
        `; ${r2.calls} R2 calls`,
    );
  } catch (err) {
    const stop = err instanceof Stop ? err : new Stop("aborted", String(err));
    summary.state = stop.state;
    summary.why = stop.message;
    if (summary.deleted === 0) summary.bytes = 0;
    console.log(`${tag}: ${stop.state}, ${stop.message}`);
    await recordStop(r2, read, day, stop, tag);
  }
  point(env, mode, summary);
  return summary;
}

/**
 * After the deletes: a status written since the last look and now `running` belongs to a build that may have found
 * one of the deleted parts present a moment before. Nothing can be undone here; a person can rebuild with `force`.
 */
async function warnIfBuildStarted(
  r2: Bucket,
  compats: string[],
  now: Date,
  seen: Map<string, string>,
  tag: string,
): Promise<void> {
  try {
    await statuses(r2, compats, now, seen);
  } catch (err) {
    if (err instanceof Stop && err.message.endsWith("is running")) {
      console.error(
        `${tag}: ${err.message.replace(" is running", "")} started during the deletes; if its list names a deleted part, rebuild it with force`,
      );
    }
  }
}

/**
 * After the deletes: a top-level list added or rewritten since the last look was written by a build in the window the
 * recheck leaves, and may name a deleted key, directly or through an originals list no list named before. Such a list
 * is logged as an error, with the keys, so a person can rebuild with `force`. The lists read before the deletes named
 * none of them. Never throws: the ledger's write comes next.
 */
async function warnIfListNamesDeleted(
  r2: Bucket,
  compats: string[],
  seen: Map<string, string>,
  named: Set<string>,
  deleted: string[],
  tag: string,
): Promise<void> {
  const gone = new Set(deleted);
  try {
    for (const compat of compats) {
      const top = `catalog/${compat}/`;
      for (const o of (await topLists(r2, top)).values()) {
        if (seen.get(o.key) === o.etag) continue;
        const list = await readLoosely(r2, o.key);
        if (!list) continue;
        const names = partKeys(list);
        // `originals.json` names no originals list; a language list names one by content, or none is read.
        const originals = list.originals
          ? originalsPathOf(compat, list.originals)
          : null;
        if (list.originals && !originals) {
          console.error(
            `${tag}: ${o.key} names no originals list by content; its originals list is not checked`,
          );
        }
        if (originals) {
          names.push(originals);
          // An originals list that was named before had its parts named too; another one is read for its parts.
          if (!named.has(originals) && !gone.has(originals)) {
            const inner = await readLoosely(r2, originals);
            if (inner) names.push(...partKeys(inner));
          }
        }
        const hit = [...new Set(names.filter((k) => gone.has(k)))].sort();
        if (hit.length) {
          console.error(
            `${tag}: ${o.key} names ${hit.length} deleted key${hit.length === 1 ? "" : "s"} (${hit.slice(0, 5).join(", ")}${hit.length > 5 ? ", …" : ""}); it was written during the deletes; rebuild with force`,
          );
        }
      }
    }
  } catch (err) {
    console.error(
      `${tag}: could not check the lists after the deletes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A list read for the check after the deletes: whatever does not read or parse is skipped, never thrown. */
async function readLoosely(r2: Bucket, key: string): Promise<ListShape | null> {
  try {
    const object = await r2.getReserved(key);
    if (!object) return null;
    const list = JSON.parse(await object.text()) as ListShape | null;
    return list && typeof list === "object" ? list : null;
  } catch {
    return null;
  }
}

function partKeys(list: ListShape): string[] {
  if (!Array.isArray(list.parts)) return [];
  return (list.parts as Array<{ sha256?: unknown }>)
    .map((p) => p?.sha256)
    .filter((sha): sha is string => typeof sha === "string")
    .map((sha) => `parts/${sha}.part.gz`);
}
