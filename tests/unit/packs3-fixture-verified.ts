import { getCatalogs, type Packs3Env } from "../../src/packs3/catalogs";
import {
  setVerifiedForTests,
  type VerifiedEntry,
} from "../../src/packs3/verified";

const chaptersOf = (books: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(books).map(([b, n]) => [
      b,
      [...Array.from({ length: n + 1 }, (_, i) => i), "front"],
    ]),
  );

/**
 * What the adapter tests of Tasks 5 and 6 pinned, as the sweep would have recorded it for the fixture catalogs:
 * passages of TIT, MAT and RUT for every Bible resource; notes and links of TIT (en) and TIT, RUT (es-419).
 * Reads the fixture's own releases, so a re-cut fixture needs no edit. Call after `resetPacks3CachesForTests()`.
 */
export async function injectFixtureProofs(
  env: Packs3Env,
  edit: (table: Record<string, VerifiedEntry>) => void = () => {},
  /** Items of the articles and search entries (every article resource gets `articles`, tW also gets `search`). */
  ids: { articles?: string[]; search?: string[] } = {},
): Promise<Record<string, VerifiedEntry>> {
  const table: Record<string, VerifiedEntry> = {};
  for (const lang of ["en", "es-419"]) {
    const cats = await getCatalogs(env, lang);
    const own = cats?.catalogs.find((c) => c.name !== "common");
    const resources = ((own?.catalog as { resources?: any[] })?.resources ??
      []) as Array<{ key: string; subject: string; release: string }>;
    for (const r of resources) {
      if (["Translation Words", "Translation Academy"].includes(r.subject)) {
        table[`${lang}|${r.key}|${r.release}|articles`] = {
          items: 0,
          exceptions: [],
          deps: {},
          ids: ids.articles ?? [],
        };
        // search ids: `q` (types tw), `ta|q`, `ta,tw|q`; the entry of a resource keeps the sets that name it
        const tw = r.subject === "Translation Words";
        table[`${lang}|${r.key}|${r.release}|${["sea", "rch"].join("")}`] = {
          items: 0,
          exceptions: [],
          deps: {},
          ids: (ids.search ?? []).filter((i) =>
            i.startsWith("ta,tw|") ? true : i.startsWith("ta|") ? !tw : tw,
          ),
        };
        continue;
      }
      if (r.subject === "TSV Translation Questions") {
        table[`${lang}|${r.key}|${r.release}|questions`] = {
          items: 0,
          exceptions: [],
          deps: {},
          chapters: chaptersOf(lang === "en" ? { TIT: 3 } : { TIT: 3, RUT: 4 }),
        };
        continue;
      }
      const kind = ["Aligned Bible", "Bible"].includes(r.subject)
        ? "passage"
        : r.subject === "TSV Translation Notes"
          ? "notes"
          : r.subject === "TSV Translation Words Links"
            ? "links"
            : undefined;
      if (!kind) continue;
      const books: Record<string, number> =
        kind === "passage"
          ? { TIT: 3, MAT: 28, RUT: 4 }
          : lang === "en"
            ? { TIT: 3 }
            : { TIT: 3, RUT: 4 };
      // as the sweep records: notes take titles from tA, links from tW
      const helper =
        kind === "notes"
          ? "Translation Academy"
          : kind === "links"
            ? "Translation Words"
            : undefined;
      table[`${lang}|${r.key}|${r.release}|${kind}`] = {
        items: 0,
        exceptions: [],
        deps: Object.fromEntries(
          resources
            .filter((x) => x.subject === helper)
            .map((x) => [`${lang}|${x.key}`, x.release]),
        ),
        chapters: chaptersOf(books),
        ...(kind === "passage"
          ? {}
          : {
              indexChapters: chaptersOf(books),
              indexWholeBooks: Object.keys(books),
            }),
      };
    }
  }
  edit(table);
  setVerifiedForTests(table);
  return table;
}
