/**
 * `wrangler.toml` as the packs tests read it: each section's inline `vars = { KEY = "value", … }` table, parsed into
 * the strings the Worker's `env` gets, so a test can pass them to the code that reads them. Every var in the file is
 * a quoted string; anything else in a `vars` table throws, so a value this parser cannot read fails the test.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function wranglerToml(): string {
  return readFileSync(
    fileURLToPath(new URL("../../wrangler.toml", import.meta.url)),
    "utf8",
  );
}

/** Each section's `vars`, by section header (`""` for the top level, whose `[vars]` table is not inline). */
export function wranglerVars(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const line of wranglerToml().split(/\r?\n/)) {
    const header = /^\[+([^\]]+)\]+\s*$/.exec(line);
    if (header) {
      section = header[1] ?? "";
      continue;
    }
    const table = /^vars\s*=\s*\{(.*)\}\s*$/.exec(line);
    if (!table) continue;
    const vars: Record<string, string> = {};
    const rest = table[1]!.replace(
      /\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"\\]*)"\s*(,|$)/g,
      (_m, key: string, value: string) => {
        vars[key] = value;
        return "";
      },
    );
    if (rest.trim()) {
      throw new Error(`[${section}] vars: cannot read ${JSON.stringify(rest)}`);
    }
    out[section] = vars;
  }
  return out;
}
