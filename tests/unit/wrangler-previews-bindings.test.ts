import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PRODUCTION_KV_ID = "a0b2bcf08829441e932230cb06cb5e07";
const PRODUCTION_ZIP_BUCKET = "translation-helps-mcp-zip-persistence";
const PRODUCTION_PACKS_BUCKET = "language-packs";
const PREVIEW_ZIP_BUCKET = "translation-helps-mcp-zip-previews";

function readToml(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function previewSection(toml: string): string {
  const lines = toml.split(/\r?\n/);
  const out: string[] = [];
  let inPreviews = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inPreviews) {
      if (trimmed === "[previews]") {
        inPreviews = true;
        out.push(line);
      }
      continue;
    }
    if (
      /^\[/.test(trimmed) &&
      trimmed !== "[previews]" &&
      !trimmed.startsWith("[[previews.")
    ) {
      break;
    }
    out.push(line);
  }
  return out.join("\n");
}

function previewR2Buckets(toml: string): Map<string, string> {
  const buckets = new Map<string, string>();
  let inR2Block = false;
  let currentBinding: string | null = null;
  for (const line of previewSection(toml).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[[previews.r2_buckets]]") {
      inR2Block = true;
      currentBinding = null;
      continue;
    }
    if (
      trimmed.startsWith("[[previews.") &&
      trimmed !== "[[previews.r2_buckets]]"
    ) {
      inR2Block = false;
      currentBinding = null;
      continue;
    }
    if (!inR2Block) continue;
    const binding = /^binding\s*=\s*"([^"]+)"$/.exec(trimmed);
    if (binding) {
      currentBinding = binding[1] ?? null;
      continue;
    }
    const bucket = /^bucket_name\s*=\s*"([^"]+)"$/.exec(trimmed);
    if (bucket && currentBinding) {
      buckets.set(currentBinding, bucket[1] ?? "");
      currentBinding = null;
    }
  }
  return buckets;
}

describe("previews bindings stay away from production data", () => {
  const files = [
    { label: "wrangler.toml", path: "../../wrangler.toml" },
    { label: "wrangler.api.toml", path: "../../wrangler.api.toml" },
  ];

  it("keeps production KV and production R2 buckets out of [previews]", () => {
    for (const file of files) {
      const section = previewSection(readToml(file.path));
      expect(section, `${file.label} has [previews]`).toContain("[previews]");
      expect(
        section,
        `${file.label} preview section must not use production KV`,
      ).not.toContain(PRODUCTION_KV_ID);
      expect(
        section,
        `${file.label} preview section must not use production ZIP bucket`,
      ).not.toMatch(
        new RegExp(`bucket_name\\s*=\\s*"${PRODUCTION_ZIP_BUCKET}"`),
      );
      expect(
        section,
        `${file.label} preview section must not use production LANGUAGE_PACKS bucket`,
      ).not.toMatch(
        new RegExp(`bucket_name\\s*=\\s*"${PRODUCTION_PACKS_BUCKET}"`),
      );
    }
  });

  it("uses the dedicated preview ZIP bucket in both worker previews", () => {
    for (const file of files) {
      const zipBucket = previewR2Buckets(readToml(file.path)).get("ZIP_FILES");
      expect(zipBucket, `${file.label} previews ZIP_FILES bucket`).toBe(
        PREVIEW_ZIP_BUCKET,
      );
    }
  });
});
