/**
 * `/api/v1/scripture` from format 3 books. It answers only what the route would answer the same way and gives
 * `undefined` for the rest (see the gaps in the Task 5 report): the route's own reference parsing and version picking
 * are reused, the text is rebuilt from the book's pieces with the verse number in front, as `extractVerses` gives it.
 */
import type {
  CatalogEntry,
  ScriptureVersion,
  ScriptureVersionRole,
} from "@translation-helps/door43";
import {
  isCanonicalUsfmBook,
  resolveScriptureVersionRole,
} from "@translation-helps/door43";
import { requireReferenceAndLanguage } from "../../api/routes/helpers";
import { scriptureVersionsForBook } from "../../api/routes/scripture";
import type { Packs3Env } from "../catalogs";
import { warnOnce } from "../keys";
import { withReader } from "../readers";
import type { Packs3Params } from "../answer";

export type ScriptureApiResponse = {
  reference: string;
  language: string;
  book: string;
  chapter: string;
  verse: string | null;
  format: "text";
  versions: ScriptureVersion[];
  versionsNote?: string;
  meta: { cache: "pack" };
};

/** Canonical order of ids.md: the position in this list, from 0, is the bit of a book in a catalog's `books`. */
export const BOOKS =
  "gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sng isa jer lam ezk dan hos jol amo oba jon mic nam hab zep hag zec mal mat mrk luk jhn act rom 1co 2co gal eph php col 1th 2th 1ti 2ti tit phm heb jas 1pe 2pe 1jn 2jn 3jn jud rev".split(
    " ",
  );
export const FIRST_NT = BOOKS.indexOf("mat");

/**
 * The resources this adapter may answer with, key (`owner/lang/id`) -> the `resourceType` the route gives
 * (the catalog's abbreviation, which format 3 does not keep: es-419_glt is `tpl`). Every entry was checked against
 * live answers of the API Worker (read-only GET /api/v1/scripture, 2026-11-12; en TIT, MAT, MRK; es-419 and `es` TIT):
 * the abbreviation as shown, no version dropped for its `\id` language/script, no `versionsNote`. To add one, repeat
 * that check for the new key on a few books and add the line. A picked resource that is not here makes the adapter
 * give `undefined` (the route answers). The lasting fix is the builder carrying the abbreviation in the catalog.
 */
export const VERIFIED: Record<string, string> = {
  "unfoldingWord/en/ult": "ult",
  "unfoldingWord/en/ust": "ust",
  "es-419_gl/es-419/glt": "tpl",
  "es-419_gl/es-419/gst": "gst",
};

type Piece = [string, boolean];
type Event = [number, string, string];
type TextUnit = { res?: string; pieces?: Piece[]; events?: Event[] };

/** An open marker with no text of its own (a paragraph, the ts milestone), so the pieces equal what the route strips from USFM. */
const PLAIN_PARA = /^(para:(p|m|mi|nb|b|pi\d?|q\d?|li\d?)|ms:ts)$/;

/**
 * The verses `start`..`end` of `chapter`, each with its number in front, joined by a space, or `undefined` when the
 * unit has something the route would show differently (notes, headings, bridges) or lacks the passage.
 */
function verseText(
  unit: TextUnit,
  chapter: string,
  start: number,
  end: number,
): string | undefined {
  const { pieces, events } = unit;
  if (!pieces || !events) return undefined;
  let inChapter = false;
  let chapterSeen = false;
  const found: string[] = [];
  let open: { n: number; from: number } | undefined;
  const close = (to: number) => {
    if (!open) return;
    const text = pieces
      .slice(open.from, to)
      .map((p) => p[0])
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    found.push(`${open.n} ${text}`);
    open = undefined;
  };
  for (const [at, kind, value] of events) {
    if (kind === "chapter") {
      close(at);
      inChapter = value === chapter;
      chapterSeen ||= inChapter;
      continue;
    }
    if (!inChapter) continue;
    if (kind === "verse") {
      close(at);
      if (!/^\d+$/.test(value)) return undefined;
      const n = Number(value);
      if (n >= start && n <= end) open = { n, from: at };
      continue;
    }
    if (!open) continue;
    if (kind === "close") continue;
    if (kind === "open" && PLAIN_PARA.test(value)) continue;
    return undefined;
  }
  close(pieces.length);
  if (!chapterSeen || found.length === 0) return undefined;
  return found.join(" ");
}

type Resource = {
  key: string;
  subject: string;
  release: string;
  books?: ArrayLike<number>;
};

function resourcesOf(catalog: unknown): Resource[] {
  const r = (catalog as { resources?: Resource[] } | undefined)?.resources;
  return Array.isArray(r) ? r : [];
}

function hasBit(books: ArrayLike<number> | undefined, index: number): boolean {
  return !!books && ((books[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function entryOf(res: Resource, index: number, code: string): CatalogEntry {
  const [owner, lang, id] = res.key.split("/");
  const repo = `${lang}_${id}`;
  return {
    owner,
    repo,
    name: repo,
    abbreviation: VERIFIED[res.key] ?? id,
    ingredients: hasBit(res.books, index) ? [{ identifier: code }] : [],
  } as unknown as CatalogEntry;
}

const zipUrl = (res: Resource): string => {
  const [owner, lang, id] = res.key.split("/");
  return `https://git.door43.org/${owner}/${lang}_${id}/archive/${res.release}.zip`;
};

export async function scriptureFromPacks3(
  env: Packs3Env,
  params: {
    reference: string;
    language: string;
    format?: string;
    all?: string;
  },
): Promise<ScriptureApiResponse | undefined> {
  if (params.format !== undefined && params.format !== "text") return undefined;
  if (params.all !== undefined && params.all !== "") return undefined;

  let ref: ReturnType<typeof requireReferenceAndLanguage>;
  try {
    const url = new URL("https://packs3.invalid/api/v1/scripture");
    url.searchParams.set("reference", params.reference);
    url.searchParams.set("language", params.language);
    ref = requireReferenceAndLanguage(url);
  } catch {
    return undefined;
  }
  const { reference, book, chapter, verseStart, verseEnd, endChapter } = ref;
  // A whole chapter or a range across chapters is not what the pieces rebuild.
  if (!verseStart || endChapter) return undefined;
  if (!isCanonicalUsfmBook(book)) return undefined;
  const code = book.toLowerCase();
  const index = BOOKS.indexOf(code);
  // The Hebrew in the route's answer has line breaks of the USFM that format 3 does not keep.
  if (index < FIRST_NT) return undefined;
  const first = Number(verseStart);
  const last = verseEnd ? Number(verseEnd) : first;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return undefined;
  const verseStr = verseEnd ? `${verseStart}-${verseEnd}` : verseStart;

  const answer = await withReader(
    env,
    params.language,
    async (reader, catalogs): Promise<ScriptureApiResponse | undefined> => {
      const language = catalogs.lang;
      if (!reader.listed(`book:${code}`)) return undefined;

      const common = catalogs.catalogs.find((c) => c.name === "common");
      const own = catalogs.catalogs.find((c) => c.name !== "common");
      const resources = resourcesOf(own?.catalog).filter(
        (r) => r.subject === "Aligned Bible" || r.subject === "Bible",
      );
      // A resource that lists no book at all would count as "may have it" in the route.
      if (resources.some((r) => Array.from(r.books ?? []).every((b) => !b)))
        return undefined;
      const entries = resources.map((r) =>
        entryOf(r, index, code.toUpperCase()),
      );
      const pick = (list: CatalogEntry[]) =>
        scriptureVersionsForBook(list, book, language, () => undefined);
      const decision = pick(entries);
      // The order of the route's catalog is not known: a pick that depends on it is not ours to make.
      const again = pick([...entries].reverse());
      const ids = (d: typeof decision) => d.picked.map((e) => e.repo).join(",");
      if (
        ids(decision) !== ids(again) ||
        decision.versionsNote !== again.versionsNote
      )
        return undefined;
      if (decision.picked.length === 0) return undefined;
      const unverified = decision.picked.some(
        (e) => !(resources[entries.indexOf(e)].key in VERIFIED),
      );
      if (unverified) {
        warnOnce(params.language, "unverified-resource");
        return undefined;
      }

      const data = (await reader.book(code)) as
        | { texts?: TextUnit[] }
        | undefined;
      if (!data?.texts) return undefined;
      // `scriptureVersionsForBook` already put `describeStandIns` into the note.
      const versionsNote = decision.versionsNote;

      const versions: ScriptureVersion[] = [];
      for (const entry of decision.picked) {
        const res = resources[entries.indexOf(entry)];
        const unit = data.texts.find((t) => t.res === res.key);
        const text = unit && verseText(unit, chapter, first, last);
        if (text === undefined) return undefined;
        const abbrev = entry.abbreviation as string;
        versions.push({
          resourceType: abbrev,
          role: resolveScriptureVersionRole(abbrev) as ScriptureVersionRole,
          text,
          source: zipUrl(res),
        } as ScriptureVersion);
      }

      const orig = (await reader.orig(code)) as
        | (TextUnit & { key?: string })
        | undefined;
      if (!orig?.key) return undefined;
      const origRes = resourcesOf(common?.catalog).find(
        (r) => r.key === orig.key,
      );
      if (!origRes) return undefined;
      const origText = verseText(orig, chapter, first, last);
      if (origText === undefined) return undefined;
      versions.push({
        resourceType: orig.key.split("/").pop() as string,
        role: "original",
        text: origText,
        source: zipUrl(origRes),
      } as ScriptureVersion);

      return {
        reference,
        language,
        book,
        chapter,
        verse: verseStr,
        format: "text",
        versions,
        ...(versionsNote ? { versionsNote } : {}),
        meta: { cache: "pack" },
      };
    },
  );
  return answer ?? undefined;
}

/** Registered in `ADAPTERS` for `/api/v1/scripture`. */
export function scriptureAdapterParams(params: Packs3Params) {
  return {
    reference: String(params.reference ?? ""),
    language: String(params.language ?? ""),
    format: params.format === undefined ? undefined : String(params.format),
    all: params.all === undefined ? undefined : String(params.all),
  };
}
