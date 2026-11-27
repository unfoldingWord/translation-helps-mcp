import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "book",
  "orig",
  "passage",
  "articles",
  "article",
  "listed",
  "unitOf",
  "size",
  "installed",
  "revisions",
  "problems",
]);

/**
 * Every `.method(` call on a name bound to a reader (`reader`, `r`, a variable
 * assigned from `openFromSegments(`, or a parameter typed `PackReader`) whose
 * method is not in the allowed list.
 */
export function forbiddenReaderCalls(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const names = new Set<string>(["reader", "r"]);
  for (const m of code.matchAll(
    /(?:const|let|var)\s+(\w+)\s*(?::[^=]*)?=\s*(?:await\s+)?openFromSegments\(/g,
  ))
    names.add(m[1]);
  for (const m of code.matchAll(/(\w+)\s*\??:\s*PackReader\b/g))
    names.add(m[1]);
  const bad = new Set<string>();
  for (const m of code.matchAll(/\b(\w+)\s*(?:\?\.|\.)\s*(\w+)\s*\(/g)) {
    if (names.has(m[1]) && !ALLOWED.has(m[2])) bad.add(`${m[1]}.${m[2]}`);
  }
  return [...bad];
}

/**
 * Second net, independent of variable names: in a file that touches a
 * PackReader or openFromSegments, no forbidden method name may appear as
 * `.name`, `["name"]` or in a destructuring pattern. (tsc is the primary guard:
 * the wrapper's view is typed PackReader, which only declares allowed methods.)
 */
export function forbiddenNamesInReaderFiles(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (!/\bPackReader\b|\bopenFromSegments\b/.test(code)) return [];
  const bad: string[] = [];
  const rules = [
    /\.\s*(maps|mapsOf|lookup|books|topics|concept|context|renderings|search|segments)\b/g,
    /\[\s*["'`](maps|mapsOf|lookup|books|topics|concept|context|renderings|search|segments)["'`]\s*\]/g,
    /\{[^{}]*\b(maps|mapsOf|lookup|books|topics|concept|context|renderings|search|segments)\b[^{}]*\}\s*=(?!=)/g,
  ];
  for (const re of rules) for (const m of code.matchAll(re)) bad.push(m[1]);
  // Indirect access: Reflect, and call/apply/bind on any value in such a file.
  for (const m of code.matchAll(/\bReflect\s*\./g)) bad.push("Reflect");
  for (const m of code.matchAll(/\.\s*(call|apply|bind)\s*\(/g))
    bad.push(`.${m[1]}(`);
  return [...new Set(bad)];
}

/** A forbidden method name as a quoted string anywhere (property access by string). Applies to every src/packs3 file. */
export function forbiddenStringLiterals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(
    /(["'`])(maps|mapsOf|lookup|books|topics|concept|context|renderings|search|segments)\1/g,
  ))
    out.push(`"${m[2]}"`);
  return [...new Set(out)];
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("allowed library calls", () => {
  it("scanner flags planted forbidden calls (self-test)", () => {
    expect(
      forbiddenReaderCalls(
        "const rd = openFromSegments({}); rd.search('x'); reader.maps(); r?.lookup(1)",
      ).sort(),
    ).toEqual(["r.lookup", "rd.search", "reader.maps"]);
    expect(
      forbiddenReaderCalls(
        "function f(x: PackReader){ return x.concept('a'); }",
      ),
    ).toEqual(["x.concept"]);
  });

  it("name scan flags alias, destructuring, other param names and brackets", () => {
    const head = "import { openFromSegments } from 'x';\n";
    const f = forbiddenNamesInReaderFiles;
    expect(f(head + "const g = rd.search; g('x')")).toEqual(["search"]);
    expect(f(head + "const { maps, book } = rd;")).toEqual(["maps"]);
    expect(f(head + "use((x: PackReader) => x.lookup('a'))")).toEqual([
      "lookup",
    ]);
    expect(f(head + "rd['concept']('a')")).toEqual(["concept"]);
    expect(f(head + "rd[`segments`]()")).toEqual(["segments"]);
    expect(f(head + "await rd.book('a'); rd.size('u')")).toEqual([]);
    expect(f("const o = { search: 1 }; o.search")).toEqual([]); // no reader in the file
  });

  it("flags Reflect access and call/apply/bind in reader files", () => {
    const head = "import { openFromSegments } from 'x';\n";
    const f = forbiddenNamesInReaderFiles;
    expect(f(head + "Reflect.get(rd, 'x').call(rd, 'faith')").sort()).toEqual([
      ".call(",
      "Reflect",
    ]);
    expect(f(head + "rd.size.bind(rd)")).toEqual([".bind("]);
    expect(f("const x = fn.call(1)")).toEqual([]); // no reader in the file
  });

  it("flags forbidden names as string literals", () => {
    expect(forbiddenStringLiterals("const k = 'search'; rd[k]")).toEqual([
      '"search"',
    ]);
    expect(forbiddenStringLiterals("x(`maps`)")).toEqual(['"maps"']);
    expect(forbiddenStringLiterals("const s = 'searching'; // 'maps'")).toEqual(
      [],
    );
  });

  it("scanner accepts allowed calls and ignores comments", () => {
    expect(
      forbiddenReaderCalls(
        "const rd = openFromSegments({}); await rd.book('a'); rd.size('u'); // rd.search()\n/* r.maps() */",
      ),
    ).toEqual([]);
  });

  it("src/packs3 calls only allowed methods on readers", () => {
    const found: string[] = [];
    for (const f of files(join(__dirname, "..", "..", "src", "packs3"))) {
      const src = readFileSync(f, "utf8");
      for (const c of [
        ...forbiddenReaderCalls(src),
        ...forbiddenNamesInReaderFiles(src),
        ...forbiddenStringLiterals(src),
      ])
        found.push(`${f}: ${c}`);
    }
    expect(found).toEqual([]);
  });
});
