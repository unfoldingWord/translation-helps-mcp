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

  it("scanner accepts allowed calls and ignores comments", () => {
    expect(
      forbiddenReaderCalls(
        "const rd = openFromSegments({}); await rd.book('a'); rd.size('u'); // rd.search()\n/* r.maps() */",
      ),
    ).toEqual([]);
  });

  it("src/packs3 calls only allowed methods on readers", () => {
    const found: string[] = [];
    for (const f of files(join(__dirname, "..", "..", "src", "packs3")))
      for (const c of forbiddenReaderCalls(readFileSync(f, "utf8")))
        found.push(`${f}: ${c}`);
    expect(found).toEqual([]);
  });
});
