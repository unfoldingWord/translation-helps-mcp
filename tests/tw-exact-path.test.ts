/**
 * Exact Translation Words / Academy paths must not resolve to a neighbour
 * whose filename merely ends with the requested name
 * (covenant vs arkofthecovenant).
 */

import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { initializeR2Env } from "../src/functions/r2-env.js";
import { ZipResourceFetcher2 } from "../src/services/ZipResourceFetcher2.js";

function article(title: string, marker: string): Uint8Array {
  return strToU8(`# ${title}\n\n## Definition\n\n${marker}\n`);
}

// Neighbours are stored first, which is what made the suffix fallback win.
const zipBytes = zipSync(
  {
    "en_tw/bible/kt/arkofthecovenant.md": article(
      "Ark of the Covenant",
      "MARKER_ARK",
    ),
    "en_tw/bible/kt/falsegod.md": article("False God", "MARKER_FALSEGOD"),
    "en_tw/bible/kt/antichrist.md": article("Antichrist", "MARKER_ANTICHRIST"),
    "en_tw/bible/kt/covenant.md": article("Covenant", "MARKER_COVENANT"),
    "en_tw/bible/kt/god.md": article("God", "MARKER_GOD"),
    "en_tw/bible/kt/christ.md": article("Christ", "MARKER_CHRIST"),
    "en_ta/translate/figs-explicitinfo/01.md": article(
      "Explicit Information",
      "[[EXPLICIT_INFO]]",
    ),
    "en_ta/translate/figs-explicit/01.md": article("Explicit", "[[EXPLICIT]]"),
  },
  { level: 0 },
);

function catalogResource(
  name: string,
  subject: string,
  ingredients: Array<{ identifier: string; path: string }>,
) {
  return {
    name,
    repo: name,
    owner: "unfoldingWord",
    subject,
    ingredients,
    catalog: {
      prod: {
        branch_or_tag_name: "v1",
        zipball_url: `https://example.test/${name}/archive/v1.zip`,
      },
    },
  };
}

function makeFetcher(): ZipResourceFetcher2 {
  const fetcher = new ZipResourceFetcher2();
  const tw = catalogResource("en_tw", "Translation Words", [
    { identifier: "kt", path: "./bible/kt" },
    { identifier: "names", path: "./bible/names" },
    { identifier: "other", path: "./bible/other" },
  ]);
  const ta = catalogResource("en_ta", "Translation Academy", [
    { identifier: "translate", path: "./translate" },
  ]);
  (
    fetcher as unknown as {
      kvCache: { get: Function; set: Function; delete: Function };
    }
  ).kvCache = {
    get: async (key: string) => {
      const k = String(key);
      if (!k.includes("catalog/search")) return null;
      if (k.includes("Academy")) return JSON.stringify({ data: [ta] });
      if (k.includes("Words")) return JSON.stringify({ data: [tw] });
      return null;
    },
    set: async () => {},
    delete: async () => {},
  };
  fetcher.getOrDownloadZip = async () => zipBytes;
  return fetcher;
}

async function twArticle(
  identifier: string,
): Promise<{ markdown?: string; articles: Array<{ markdown: string }> }> {
  const result = (await makeFetcher().getMarkdownContent(
    "en",
    "unfoldingWord",
    "tw",
    identifier,
  )) as { articles?: Array<{ markdown: string }> };
  return {
    markdown: result.articles?.[0]?.markdown,
    articles: result.articles || [],
  };
}

describe("exact translation word paths", () => {
  afterEach(() => {
    initializeR2Env(undefined, undefined);
  });

  it("returns covenant, not the ark, for the path and the bare term", async () => {
    for (const id of [
      "bible/kt/covenant",
      "covenant",
      "bible/kt/covenant.md",
    ]) {
      const { markdown } = await twArticle(id);
      expect(markdown, id).toContain("MARKER_COVENANT");
      expect(markdown, id).not.toContain("MARKER_ARK");
    }
  });

  it("returns the ark article for its own path and term", async () => {
    for (const id of ["bible/kt/arkofthecovenant", "arkofthecovenant"]) {
      const { markdown } = await twArticle(id);
      expect(markdown, id).toContain("MARKER_ARK");
      expect(markdown, id).not.toContain("MARKER_COVENANT");
    }
  });

  it("separates god/falsegod and christ/antichrist both ways", async () => {
    const cases: Array<[string, string, string]> = [
      ["god", "MARKER_GOD", "MARKER_FALSEGOD"],
      ["bible/kt/god", "MARKER_GOD", "MARKER_FALSEGOD"],
      ["falsegod", "MARKER_FALSEGOD", "MARKER_GOD"],
      ["bible/kt/falsegod", "MARKER_FALSEGOD", "MARKER_GOD"],
      ["christ", "MARKER_CHRIST", "MARKER_ANTICHRIST"],
      ["bible/kt/christ", "MARKER_CHRIST", "MARKER_ANTICHRIST"],
      ["antichrist", "MARKER_ANTICHRIST", "MARKER_CHRIST"],
      ["bible/kt/antichrist", "MARKER_ANTICHRIST", "MARKER_CHRIST"],
    ];
    for (const [id, want, other] of cases) {
      const { markdown } = await twArticle(id);
      expect(markdown, id).toContain(want);
      expect(markdown, id).not.toContain(other);
    }
  });

  it("returns no article when the exact file is absent", async () => {
    const { articles } = await twArticle("bible/kt/not-a-real-term");
    expect(articles).toEqual([]);
  });

  it("does not take a Translation Academy neighbour that shares a filename", async () => {
    const fetcher = makeFetcher();
    // Repo prefix does not match, so resolution depends on the path-suffix fallback.
    const explicit = await fetcher.extractFileFromZip(
      zipBytes,
      "translate/figs-explicit/01.md",
      "not-the-repo",
    );
    const info = await fetcher.extractFileFromZip(
      zipBytes,
      "translate/figs-explicitinfo/01.md",
      "not-the-repo",
    );
    expect(explicit).toContain("[[EXPLICIT]]");
    expect(explicit).not.toContain("[[EXPLICIT_INFO]]");
    expect(info).toContain("[[EXPLICIT_INFO]]");
    expect(info).not.toContain("[[EXPLICIT]]");

    const missing = await fetcher.extractFileFromZip(
      zipBytes,
      "translate/figs-nope/01.md",
      "not-the-repo",
    );
    expect(missing).toBeNull();
  });

  it("does not serve a markdown file cached under the pre-fix key", async () => {
    const reads: string[] = [];
    const store = new Map<string, string>();
    const legacyKey = "zip:poison-t064/files/bible/kt/covenant.md";
    store.set(legacyKey, "# Ark of the Covenant\n\nMARKER_POISON\n");
    initializeR2Env(
      {
        get: async (key: string) => {
          reads.push(key);
          const text = store.get(key);
          if (text == null) return null;
          return { text: async () => text };
        },
        put: async (key: string, body: string) => {
          store.set(key, typeof body === "string" ? body : String(body));
        },
      },
      undefined,
    );

    const fetcher = makeFetcher();
    const content = await fetcher.extractFileFromZip(
      zipBytes,
      "bible/kt/covenant.md",
      "en_tw",
      "zip:poison-t064",
    );

    expect(content).toContain("MARKER_COVENANT");
    expect(content).not.toContain("MARKER_POISON");
    expect(reads.includes(legacyKey)).toBe(false);
    expect(reads.some((key) => key.includes("/files/md-v2/"))).toBe(true);
  });
});
