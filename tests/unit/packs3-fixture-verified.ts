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
 * passages of TIT and MAT for every Bible resource; notes and links of TIT (en) and TIT, RUT (es-419).
 * Reads the fixture's own releases, so a re-cut fixture needs no edit. Call after `resetPacks3CachesForTests()`.
 */
export async function injectFixtureProofs(
  env: Packs3Env,
  edit: (table: Record<string, VerifiedEntry>) => void = () => {},
): Promise<Record<string, VerifiedEntry>> {
  const table: Record<string, VerifiedEntry> = {};
  for (const lang of ["en", "es-419"]) {
    const cats = await getCatalogs(env, lang);
    const own = cats?.catalogs.find((c) => c.name !== "common");
    const resources = ((own?.catalog as { resources?: any[] })?.resources ??
      []) as Array<{ key: string; subject: string; release: string }>;
    for (const r of resources) {
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
          ? { TIT: 3, MAT: 28 }
          : lang === "en"
            ? { TIT: 3 }
            : { TIT: 3, RUT: 4 };
      table[`${lang}|${r.key}|${r.release}|${kind}`] = {
        items: 0,
        exceptions: [],
        deps: {},
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
