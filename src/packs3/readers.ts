import {
  openFromSegments,
  type PackReader,
} from "../../vendor/language-pack-client/index.js";
import { getCatalogs, type Catalogs3, type Packs3Env } from "./catalogs";
import { segmentGetter } from "./segments";

/** Live readers per isolate; the least recently used is dropped past this. */
export const MAX_READERS = 2;
/** Compressed bytes of opened units after which the next call gets a fresh reader (about 30 MB inflated). */
export const READER_BYTE_BUDGET = 3 * 1024 * 1024;

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
  const count = (cls: "book" | "orig" | "art", key: string) => {
    const unit = reader.unitOf(cls, key);
    if (!unit || e.counted.has(unit)) return;
    e.counted.add(unit);
    e.bytes += reader.size(unit);
  };
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
    passage: (ref) => {
      const book = ref.trim().split(/[\s.:]/)[0];
      if (book) count("book", book);
      return reader.passage(ref);
    },
    article: (id, section) => reader.article(id, section),
  };
  return e;
}

/**
 * Runs `use` with the reader for the language's verified catalogs. One live
 * reader per catalog key, at most MAX_READERS per isolate. Past the byte budget
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
    e = makeEntry(lang, c, env);
    live.set(c.key, e);
    while (live.size > MAX_READERS) {
      const [oldKey, oldest] = live.entries().next().value as [string, Entry];
      retire(oldKey, oldest);
    }
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
