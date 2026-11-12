#!/usr/bin/env node
/**
 * Builds vendor/language-pack-client/ from a tc-study checkout.
 * Usage: node scripts/vendor-language-pack-client.mjs --tc-study <path to a tc-study checkout at the commit> [--commit <sha>]
 * The bundle re-exports only openFromSegments, verifyCatalogFile and ClientError, so jszip and the store code stay out.
 * Needs `bun` and the checkout's dependencies installed (`bun install` at its root).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const tcStudy = arg("--tc-study");
if (!tcStudy) {
  console.error("usage: vendor-language-pack-client.mjs --tc-study <path> [--commit <sha>]");
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "vendor", "language-pack-client");
const src = resolve(tcStudy);
const clientDir = join(src, "packages", "language-pack-client");

let commit = arg("--commit");
if (!commit) {
  try {
    commit = execFileSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    console.error("not a git checkout: pass --commit <full sha>");
    process.exit(2);
  }
}

// The temporary entry sits inside the package so its imports and node_modules resolve.
const entry = join(clientDir, ".vendor-entry.ts");
writeFileSync(
  entry,
  "export { openFromSegments } from './src/reader'\nexport { verifyCatalogFile } from './src/verify'\nexport { ClientError } from './src/errors'\n",
);
const tmp = mkdtempSync(join(tmpdir(), "lpc-vendor-"));
try {
  // The CLI form is `bun build <entry> --target=browser --format=esm --minify`; it is run through Bun.build so that the zip
  // library, which the v3 package re-exports but the reader never calls, is replaced by an empty stub instead of being bundled.
  const buildScript = join(tmp, "build.mjs");
  writeFileSync(
    buildScript,
    `const [entry, outdir] = process.argv.slice(2);
const stubZip = { name: "stub-zip", setup(b) {
  b.onResolve({ filter: /^jszip$/ }, () => ({ path: "stub-zip", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default class Zip { static loadAsync() { throw new Error('zip files are not supported here'); } }", loader: "js" }));
} };
const r = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true, outdir, naming: "index.js", plugins: [stubZip] });
if (!r.success) { console.error(r.logs.join(", ")); process.exit(1); }
`,
  );
  execFileSync("bun", [buildScript, entry, tmp], { stdio: "inherit", cwd: clientDir });
} finally {
  rmSync(entry, { force: true });
}

mkdirSync(out, { recursive: true });
const js = readFileSync(join(tmp, "index.js"));
writeFileSync(join(out, "index.js"), js);
rmSync(tmp, { recursive: true, force: true });
copyFileSync(join(src, "LICENSE"), join(out, "LICENSE"));

const dts = `// Hand-written types of the vendored bundle: only what the Worker uses (see global constraints, "Allowed library calls").
export type TrustPolicy = { trustedKeys?: Record<string, Uint8Array> };

export type VerifiedCatalog = {
  id: string;
  bytes: Uint8Array;
  catalog: unknown;
  name: string;
  publisher: string;
  revision: number;
  origin: "published" | "local";
  signedBy?: string;
};

export type Answer<T> = {
  query: string;
  data: T | null;
  cites: unknown[];
  revision: { lang?: number; common?: number; units: Record<string, number> };
  coverage?: Record<string, unknown>;
  notInstalled: unknown[];
};

export type PassageData = unknown;
export type ArticleData = unknown;

export interface PackReader {
  lang: string;
  problems: unknown[];
  revisions(): { lang?: number; common?: number };
  installed(unit: string): boolean;
  book(book: string): Promise<unknown | undefined>;
  orig(book: string): Promise<unknown | undefined>;
  articles(group: string): Promise<unknown[] | undefined>;
  size(unit: string): number;
  unitOf(cls: "book" | "art" | "orig", key: string): string | undefined;
  listed(unit: string): boolean;
  passage(ref: string): Promise<Answer<PassageData>>;
  article(id: string, section?: string | "all"): Promise<Answer<ArticleData>>;
}

export class ClientError extends Error {
  code: string;
  status?: number;
  retryAfter?: number;
}

export function verifyCatalogFile(
  bytes: Uint8Array,
  policy: TrustPolicy,
  o: { from: "network" | "transfer" | "store" | "bridge"; expectedId?: string },
): Promise<VerifiedCatalog>;

export function openFromSegments(o: {
  lang: string;
  catalogs: VerifiedCatalog[];
  get: (id: string) => Promise<Uint8Array | undefined>;
}): PackReader;
`;
writeFileSync(join(out, "index.d.ts"), dts);

const bytes = statSync(join(out, "index.js")).size;
const bundleSha256 = createHash("sha256").update(js).digest("hex");
writeFileSync(
  join(out, "SOURCE.json"),
  JSON.stringify({ repo: "unfoldingWord/tc-study", commit, built: new Date().toISOString(), bundleSha256, bytes }, null, 2) + "\n",
);
writeFileSync(
  join(out, "README.md"),
  `# Vendored language pack client

Built from \`packages/language-pack-client\` of unfoldingWord/tc-study at the commit in \`SOURCE.json\`. Do not edit \`index.js\`:
rebuild it with \`node scripts/vendor-language-pack-client.mjs --tc-study <checkout>\`.

Exports: \`openFromSegments\`, \`verifyCatalogFile\`, \`ClientError\`. \`index.d.ts\` is hand-written (the Worker only uses the
calls listed in the plan's global constraints). The library's MIT \`LICENSE\` is copied alongside.
`,
);
console.log(`vendored ${bytes} bytes, sha256 ${bundleSha256}, commit ${commit}`);
