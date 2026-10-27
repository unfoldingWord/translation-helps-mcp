/**
 * A language can have Bibles and still lack the book asked for. The original
 * (Greek or Hebrew) must not turn that into a success: the route says the book
 * is not available, and get_passage soft-fails. English stand-ins, a book the
 * language does have, a verse past the end, and a language with no Bible stay
 * as they are (#67). When nothing has the book, the message also lists which
 * books the language's catalog entries do cover (#67 available books).
 */
import { describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "@translation-helps/door43";
import { ApiClientError } from "../../src/mcp/apiClient.js";

const books = vi.hoisted(() => ({
  byLang: new Map<string, CatalogEntry[]>(),
  files: new Map<string, string>(),
}));

vi.mock("@translation-helps/door43", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@translation-helps/door43")>();
  return {
    ...actual,
    catalogSearch: async (opts: { lang?: string }) =>
      books.byLang.get(opts.lang ?? "") ?? [],
    resolveCatalogLanguage: async (lang: string) => ({
      language: lang,
      entries: books.byLang.get(lang) ?? [],
    }),
    ZipResourceFetcher2: class {
      lastCacheSource: "memory" | null = "memory";
      async getFileText(url: string): Promise<string | null> {
        return books.files.get(url) ?? null;
      }
    },
  };
});

import { handleScripture } from "../../src/api/routes/scripture.js";
import { getPassageTool } from "../../src/mcp/tools/getPassage.js";

function entry(
  owner: string,
  abbrev: string,
  bookList: string[],
  zip: string,
): CatalogEntry {
  return {
    owner,
    repo: `${owner}_${abbrev}`,
    name: `${owner}_${abbrev}`,
    abbreviation: abbrev,
    ingredients: bookList.map((book) => ({
      identifier: book.toLowerCase(),
      path: `./${book}.usfm`,
    })),
    catalog: { prod: { zipball_url: zip } },
  };
}

function verse(book: string, chapter: string, n: string, text: string): string {
  return `\\id ${book}\n\\c ${chapter}\n\\p\n\\v ${n} ${text}`;
}

const ULT = entry(
  "unfoldingWord",
  "ult",
  ["GEN", "JHN"],
  "https://example.test/ult.zip",
);
const UST = entry(
  "unfoldingWord",
  "ust",
  ["GEN", "JHN"],
  "https://example.test/ust.zip",
);
const T4T = entry(
  "unfoldingWord",
  "t4t",
  ["GEN", "ISA", "JHN"],
  "https://example.test/t4t.zip",
);
const BSB = entry(
  "Worldview",
  "bsb",
  ["GEN", "ISA", "JHN"],
  "https://example.test/bsb.zip",
);
const UGNT = entry(
  "unfoldingWord",
  "ugnt",
  ["JHN"],
  "https://example.test/ugnt.zip",
);
const UHB = entry(
  "unfoldingWord",
  "uhb",
  ["ISA"],
  "https://example.test/uhb.zip",
);
/** Books listed for es-419-style gaps: same set v1 reports, not including John. */
const ES_GAP_BOOKS = ["3JN", "EST", "JON", "NEH", "RUT", "TIT"];
const ULT_GAP = entry(
  "unfoldingWord",
  "ult",
  ES_GAP_BOOKS,
  "https://example.test/ult-gap.zip",
);
const UST_GAP = entry(
  "unfoldingWord",
  "ust",
  ES_GAP_BOOKS,
  "https://example.test/ust-gap.zip",
);
const HGLT = entry(
  "unfoldingWord",
  "hglt",
  ["GEN", "RUT", "MAT"],
  "https://example.test/hglt.zip",
);
const HGST = entry(
  "unfoldingWord",
  "hgst",
  ["GEN", "EXO"],
  "https://example.test/hgst.zip",
);

function resetBooks(): void {
  books.byLang.clear();
  books.files.clear();
  books.files.set(
    UGNT.catalog!.prod!.zipball_url!,
    verse("JHN", "3", "16", "houtos gar egapesen"),
  );
  books.files.set(
    UHB.catalog!.prod!.zipball_url!,
    verse("ISA", "53", "5", "vehu meholal"),
  );
  books.byLang.set("el-x-koine", [UGNT]);
  books.byLang.set("hbo", [UHB]);
}

function putLanguage(
  language: string,
  catalog: CatalogEntry[],
  texts: Array<[CatalogEntry, string]>,
): void {
  books.byLang.set(language, catalog);
  for (const [item, text] of texts) {
    books.files.set(item.catalog!.prod!.zipball_url!, text);
  }
}

async function scripture(
  reference: string,
  language: string,
  all = false,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const params = new URLSearchParams({ reference, language });
  if (all) params.set("all", "1");
  const response = await handleScripture({
    url: new URL(`http://internal/api/v1/scripture?${params}`),
    env: {} as never,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/**
 * The agent turns a scripture 404 into RESOURCE_NOT_AVAILABLE with
 * isError false (src/mcp/agent.ts). This mirrors that branch so a 200
 * that only carries the original cannot pass as a soft-fail.
 */
async function passageAsMcp(
  reference: string,
  language: string,
): Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}> {
  const api = {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(href);
      if (url.pathname.endsWith("/scripture")) {
        return handleScripture({
          url: new URL(`http://internal/api/v1/scripture?${url.searchParams}`),
          env: {} as never,
        });
      }
      return new Response("{}", { status: 202 });
    },
  };
  try {
    return await getPassageTool.handler(
      { reference, language, format: "text" },
      { API: api } as never,
      "missing-book",
    );
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      return {
        isError: false,
        structuredContent: {
          available: false,
          code: "RESOURCE_NOT_AVAILABLE",
          message: err.message,
          hints: [
            "Run list_resources to see what is available for this language.",
          ],
        },
      };
    }
    throw err;
  }
}

const ES_AVAILABLE =
  "Books available in es-419: Ruth, Nehemiah, Esther, Jonah, Titus, 3 John.";
const BN_AVAILABLE =
  "Books available in bn: Ruth, Nehemiah, Esther, Jonah, Titus, 3 John.";
const HI_AVAILABLE = "Books available in hi: Genesis, Exodus, Ruth, Matthew.";
const ES_MISSING = `The ULT (literal) and UST (simplified) do not include John yet, and no other "es-419" version has it. ${ES_AVAILABLE}`;

describe("scripture when no Bible of the language has the book", () => {
  it("says the book is not available, naming the versions and the books that are, even though the original has the text", async () => {
    resetBooks();
    putLanguage("es-419", [ULT_GAP, UST_GAP], []);

    const { status, body } = await scripture("John 3:16", "es-419");

    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: ES_MISSING,
        retryable: false,
      },
    });
  });

  it("get_passage soft-fails with RESOURCE_NOT_AVAILABLE and isError false", async () => {
    resetBooks();
    putLanguage("es-419", [ULT_GAP, UST_GAP], []);

    const result = await passageAsMcp("John 3:16", "es-419");

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: ES_MISSING,
    });
  });

  it("does the same when the caller asks for every version", async () => {
    resetBooks();
    putLanguage("bn", [ULT_GAP, UST_GAP], []);

    const { status, body } = await scripture("John 3:16", "bn", true);
    const error = body.error as { message: string };

    expect(status).toBe(404);
    expect(error.message).toBe(
      `The ULT (literal) and UST (simplified) do not include John yet, and no other "bn" version has it. ${BN_AVAILABLE}`,
    );
  });

  it("says Hindi's literal and simplified versions do not include Isaiah, listing books in canonical order", async () => {
    resetBooks();
    putLanguage("hi", [HGLT, HGST], []);

    const { status, body } = await scripture("Isaiah 53:5", "hi");
    const error = body.error as { message: string };

    expect(status).toBe(404);
    expect(error.message).toBe(
      `The HGLT (literal) and HGST (simplified) do not include Isaiah yet, and no other "hi" version has it. ${HI_AVAILABLE}`,
    );
  });

  it("keeps English stand-ins and the original when another version has the book", async () => {
    resetBooks();
    putLanguage(
      "en",
      [ULT, UST, T4T, BSB],
      [
        [T4T, verse("ISA", "53", "5", "But he was wounded")],
        [BSB, verse("ISA", "53", "5", "But he was pierced")],
      ],
    );

    const { status, body } = await scripture("Isaiah 53:5", "en");
    const versions = body.versions as Array<{
      resourceType: string;
      role: string;
    }>;

    expect(status).toBe(200);
    expect(versions.map((v) => `${v.resourceType}/${v.role}`)).toEqual([
      "t4t/other",
      "bsb/other",
      "uhb/original",
    ]);
    expect(body.versionsNote).toBe(
      "The ULT (literal) and UST (simplified) do not include Isaiah yet; the T4T and BSB are given in their place.",
    );
  });

  it("still returns a book the language has, together with the original", async () => {
    resetBooks();
    putLanguage(
      "en",
      [ULT, UST],
      [
        [ULT, verse("JHN", "3", "16", "For God loved the world")],
        [UST, verse("JHN", "3", "16", "God loved the world")],
      ],
    );

    const { status, body } = await scripture("John 3:16", "en");
    const versions = body.versions as Array<{
      resourceType: string;
      role: string;
    }>;

    expect(status).toBe(200);
    expect(versions.map((v) => `${v.resourceType}/${v.role}`)).toEqual([
      "ult/literal",
      "ust/simplified",
      "ugnt/original",
    ]);
  });

  it("keeps today's message when the book exists but the verse does not", async () => {
    resetBooks();
    const short = "\\id JHN\n\\c 3\n\\p\n\\v 1 One.\n\\v 2 Two.";
    putLanguage(
      "en",
      [ULT, UST],
      [
        [ULT, short],
        [UST, short],
      ],
    );
    books.files.set(UGNT.catalog!.prod!.zipball_url!, short);

    const { status, body } = await scripture("John 3:99", "en");
    const error = body.error as { message: string };

    expect(status).toBe(404);
    expect(error.message).toBe(
      '"John 3:99" does not exist: JHN 3 has 2 verses, so there is no verse 99.',
    );
  });

  it("says the verse is past the end even when only the original has that verse", async () => {
    resetBooks();
    const short = "\\id JHN\n\\c 3\n\\p\n\\v 1 One.\n\\v 2 Two.";
    putLanguage("en", [ULT], [[ULT, short]]);

    const { status, body } = await scripture("John 3:16", "en");
    const error = body.error as { message: string };

    expect(status).toBe(404);
    expect(error.message).toBe(
      '"John 3:16" does not exist: JHN 3 has 2 verses, so there is no verse 16.',
    );
  });

  it("keeps the 404 for a language that has no Bible at all", async () => {
    resetBooks();
    books.byLang.set("xx", []);

    const { status, body } = await scripture("John 3:16", "xx");
    const error = body.error as { message: string };

    expect(status).toBe(404);
    expect(error.message).toBe(
      'No scripture translation available for language "xx". Try "en" or check which languages are available for this resource.',
    );
  });
});
