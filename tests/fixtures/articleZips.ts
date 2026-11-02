/**
 * Tiny TW/TA zips for path-resolution tests.
 * Keys are the zip URL the catalog mock returns. Values are zip entry names.
 */

export const EN_TW_ZIP = "https://example.test/en-tw.zip";
export const EN_TA_ZIP = "https://example.test/en-ta.zip";
export const ES_TW_ZIP = "https://example.test/es-419-tw.zip";

const HADES = [
  "# Hades, Sheol",
  "",
  "See [the promise](../kt/promise.md).",
  "",
  "A note: [Genesis 37:35](rc://en/tn/help/gen/37/35)",
  "",
].join("\n");

export function fillArticleZips(zips: Map<string, Map<string, string>>): void {
  zips.set(
    EN_TW_ZIP,
    new Map([
      ["en_tw/bible/kt/hades.md", HADES],
      ["en_tw/bible/kt/covenant.md", "# Covenant\n"],
      ["en_tw/bible/kt/sonofgod.md", "# Son of God, the Son\n"],
      ["en_tw/bible/kt/sonsofgod.md", "# sons of God\n"],
      ["en_tw/bible/kt/promise.md", "# Promise\n"],
      ["en_tw/bible/names/paul.md", "# Paul\n"],
      ["en_tw/bible/other/paul.md", "# Paul (other)\n"],
    ]),
  );
  zips.set(
    EN_TA_ZIP,
    new Map([
      [
        "en_ta/translate/figs-metaphor/01.md",
        "# Metaphor\n\nLike a [simile](../figs-simile/01.md).\n",
      ],
      ["en_ta/translate/figs-metaphor/title.md", "# Metaphor\n"],
      ["en_ta/translate/figs-simile/01.md", "# Simile\n"],
      ["en_ta/translate/figs-simile/title.md", "# Simile\n"],
      ["en_ta/translate/figs-complexmetaphor/01.md", "# Complex Metaphor\n"],
      ["en_ta/translate/figs-complexmetaphor/title.md", "# Complex Metaphor\n"],
      ["en_ta/translate/figs-metonymy/01.md", "# Metonymy\n"],
      ["en_ta/translate/figs-metonymy/title.md", "# Metonymy\n"],
    ]),
  );
  zips.set(
    ES_TW_ZIP,
    new Map([["es_tw/bible/kt/covenant.md", "# Pacto, alianza\n"]]),
  );
}
