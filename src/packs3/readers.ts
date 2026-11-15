import {
  openFromSegments,
  type PackReader,
} from "../../vendor/language-pack-client/index.js";
import { getCatalogs, type Catalogs3, type Packs3Env } from "./catalogs";
import { warnOnce } from "./keys";
import { segmentGetter } from "./segments";

/** Readers held by an isolate, live and recycled-but-running together. A call that would need a third gets null. */
export const MAX_READERS = 2;
/**
 * Compressed bytes of opened units after which the next call gets a fresh reader.
 * Task 1 measured about 41 MB of heap per compressed MB; see the arithmetic and the
 * overshoot caveat in docs/packs3-measurements.md. A reader is replaced between
 * calls, so one unit (Psalms) can take it past the budget inside a callback.
 */
export const READER_BYTE_BUDGET = 1 * 1024 * 1024;
/**
 * A call whose `need` is over the budget (en Psalms 1.1 + 0.42 MB, en Genesis 1.13 MB) runs in an exclusive reader:
 * a fresh reader opened only when no other reader has a call running (idle live readers are dropped first), that
 * blocks every other call while it runs (`readers-busy`) and is retired right after its call. Over this cap the call
 * falls back (`book-too-large`). Heap measured in docs/packs3-measurements.md (Task 14a-OT).
 */
export const EXCLUSIVE_BYTE_CAP = 1.8 * 1024 * 1024;

/** What `need` may ask of the reader: the compressed size of units, from the catalogs (no unit is opened). */
export type SizeProbe = Pick<PackReader, "unitOf" | "size">;
export type WithReaderOptions = {
  /** Compressed bytes the call will open; over READER_BYTE_BUDGET it runs in an exclusive reader. */
  need?: (r: SizeProbe) => number;
};

type Entry = {
  lang: string;
  reader: PackReader;
  counted: Set<string>;
  bytes: number;
  running: number;
  /** The wrapper handed to callers: counts bytes, calls only allowed methods. */
  view: PackReader;
};

/** Insertion order is recency order (oldest first). */
const live = new Map<string, Entry>();
/** Recycled or evicted readers that still have calls running. */
const retired = new Set<Entry>();
/** The exclusive reader while its call runs: no other reader is held meanwhile. */
let exclusive: Entry | undefined;
let exclusiveSince = 0;
let abandonedLogged = false;
/** Wall time after which an exclusive call that has not returned is treated as abandoned. */
export const EXCLUSIVE_DEADLINE_MS = 30_000;
let now: () => number = () => Date.now();

export function setReaderClockForTests(fn: (() => number) | undefined): void {
  now = fn ?? (() => Date.now());
}

export function resetReadersForTests(): void {
  live.clear();
  retired.clear();
  exclusive = undefined;
  abandonedLogged = false;
  now = () => Date.now();
}

/** Readers held by this isolate, including recycled ones with calls still running and the exclusive one. */
export function liveReadersForTests(): number {
  return live.size + retired.size + (exclusive ? 1 : 0);
}

function retire(key: string, e: Entry): void {
  live.delete(key);
  if (e.running > 0) retired.add(e);
}

function makeEntry(lang: string, c: Catalogs3, env: Packs3Env): Entry {
  const reader = openFromSegments({
    lang: c.lang,
    catalogs: c.catalogs,
    get: segmentGetter(env),
  });
  const e: Entry = {
    lang,
    reader,
    counted: new Set(),
    bytes: 0,
    running: 0,
    view: undefined as unknown as PackReader,
  };
  const countUnit = (unit: string | undefined) => {
    if (!unit || e.counted.has(unit)) return;
    e.counted.add(unit);
    e.bytes += reader.size(unit);
  };
  const count = (cls: "book" | "orig" | "art", key: string) =>
    countUnit(reader.unitOf(cls, key));
  /** Units the library itself reports having used for an answer (its own reference parsing). */
  const countRelated = (a: unknown) => {
    // The library opens the groups of related articles through the raw reader.
    const rel = (a as { data?: { related?: Array<{ id?: unknown }> } })?.data
      ?.related;
    for (const x of rel ?? []) {
      if (typeof x?.id !== "string") continue;
      const unit =
        reader.unitOf("art", x.id) ??
        `art:${x.id.includes("/") ? x.id.slice(0, x.id.lastIndexOf("/")) : x.id}`;
      if (reader.installed(unit)) countUnit(unit);
    }
  };
  const countAnswer = <A>(a: A): A => {
    const units = (a as { revision?: { units?: Record<string, number> } })
      ?.revision?.units;
    for (const u of Object.keys(units ?? {}))
      if (/^(book|orig|art):|^map$/.test(u)) countUnit(u);
    return a;
  };
  // The view is typed PackReader and built from allowed methods only: tsc is the
  // primary guard, the allowed-calls test the second.
  e.view = {
    get lang() {
      return reader.lang;
    },
    get problems() {
      return reader.problems;
    },
    revisions: () => reader.revisions(),
    installed: (u) => reader.installed(u),
    listed: (u) => reader.listed(u),
    unitOf: (cls, key) => reader.unitOf(cls, key),
    size: (u) => reader.size(u),
    book: (b) => (count("book", b), reader.book(b)),
    orig: (b) => (count("orig", b), reader.orig(b)),
    articles: (g) => (count("art", g), reader.articles(g)),
    passage: async (ref) => countAnswer(await reader.passage(ref)),
    article: async (id, section) => {
      // Same unit the library derives: unitOf("art", id), else "art:" + id up to the last "/".
      countUnit(
        reader.unitOf("art", id) ?? `art:${id.slice(0, id.lastIndexOf("/"))}`,
      );
      const a = await reader.article(id, section);
      countRelated(a);
      return countAnswer(a);
    },
  };
  return e;
}

/**
 * Runs `use` with the reader for the language's verified catalogs. One live
 * reader per catalog key, at most MAX_READERS per isolate (live and recycled together; `null` and a
 * `readers-busy` fallback when all are running). Past the byte budget
 * the next call gets a fresh reader; calls already running keep theirs, and a
 * dropped reader is released when its last call ends. `null` without catalogs.
 * With `opts.need` over the budget the call runs in an exclusive reader (EXCLUSIVE_BYTE_CAP).
 */
export async function withReader<T>(
  env: Packs3Env,
  lang: string,
  use: (r: PackReader, c: Catalogs3) => Promise<T>,
  opts: WithReaderOptions = {},
): Promise<T | null> {
  const c = await getCatalogs(env, lang);
  if (!c) return null;
  // From here to `use` nothing awaits, so the checks below hold when the reader is handed out.
  if (exclusive && now() - exclusiveSince > EXCLUSIVE_DEADLINE_MS) {
    // A hung call must not block every read for the life of the isolate.
    exclusive = undefined;
    if (!abandonedLogged) {
      abandonedLogged = true;
      console.warn("packs3 exclusive reader abandoned", { lang });
    }
  }
  if (exclusive) {
    warnOnce(lang, "readers-busy");
    return null;
  }

  // A new catalog key for the same language supersedes the old reader.
  for (const [k, old] of [...live]) {
    if (old.lang === lang && k !== c.key) retire(k, old);
  }
  let e = live.get(c.key);
  if (e && e.bytes > READER_BYTE_BUDGET) {
    retire(c.key, e);
    e = undefined;
  }
  let fresh: Entry | undefined;
  const need = opts.need
    ? opts.need((e ?? (fresh = makeEntry(lang, c, env))).reader)
    : 0;
  if (need > EXCLUSIVE_BYTE_CAP) {
    warnOnce(lang, "book-too-large");
    return null;
  }
  if (need > READER_BYTE_BUDGET) {
    if (retired.size > 0 || [...live.values()].some((x) => x.running > 0)) {
      warnOnce(lang, "readers-busy");
      return null;
    }
    live.clear(); // idle readers only: their memory goes before the big book comes in
    const x = fresh ?? makeEntry(lang, c, env);
    exclusive = x;
    exclusiveSince = now();
    x.running++;
    try {
      return await use(x.view, c);
    } finally {
      x.running--;
      if (exclusive === x) exclusive = undefined; // an abandoned call must not clear a newer slot
    }
  }
  if (e) {
    live.delete(c.key); // refresh recency
    live.set(c.key, e);
  } else {
    // Live and retired readers count together; only an idle live reader can be dropped for a new one.
    while (live.size + retired.size >= MAX_READERS) {
      const idle = [...live].find(([, x]) => x.running === 0);
      if (!idle) {
        warnOnce(lang, "readers-busy");
        return null;
      }
      live.delete(idle[0]);
    }
    e = fresh ?? makeEntry(lang, c, env);
    live.set(c.key, e);
  }

  const entry = e;
  entry.running++;
  try {
    return await use(entry.view, c);
  } finally {
    entry.running--;
    if (entry.running === 0) retired.delete(entry);
  }
}
