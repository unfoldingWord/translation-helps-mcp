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

export function resetReadersForTests(): void {
  live.clear();
  retired.clear();
}

/** Readers held by this isolate, including recycled ones with calls still running. */
export function liveReadersForTests(): number {
  return live.size + retired.size;
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
 */
export async function withReader<T>(
  env: Packs3Env,
  lang: string,
  use: (r: PackReader, c: Catalogs3) => Promise<T>,
): Promise<T | null> {
  const c = await getCatalogs(env, lang);
  if (!c) return null;

  // A new catalog key for the same language supersedes the old reader.
  for (const [k, old] of [...live]) {
    if (old.lang === lang && k !== c.key) retire(k, old);
  }
  let e = live.get(c.key);
  if (e && e.bytes > READER_BYTE_BUDGET) {
    retire(c.key, e);
    e = undefined;
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
    e = makeEntry(lang, c, env);
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
