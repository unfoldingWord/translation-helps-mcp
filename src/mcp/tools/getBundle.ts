/**
 * get_bundle — retrieve all translation helps for a passage in one call.
 *
 * Assembly is fully deterministic: scripture, notes, and linked articles
 * all come from the existing DCS fetch tools.  No vector store required.
 *
 * Assembly order:
 *   1. Check BundleCache L1 (in-process LRU) and L2 (KV).
 *   2. fetch_scripture   → bundle.scripture
 *   3. fetch_translation_notes → bundle.notes
 *   4. fetch_translation_word_links → bundle.tw (word paths)
 *   5. TA SupportReferences from notes (rc:// → TA paths) → bundle.ta
 *   6. Persist to L1 + L2 caches.
 */

import { z } from "zod";
import {
  referenceParam,
  languageParam,
  ok,
  type ToolModule,
} from "./shared.js";
import type { Env } from "../agent.js";
import { fetchScriptureTool } from "./fetchScripture.js";
import { fetchTranslationNotesTool } from "./fetchTranslationNotes.js";
import { fetchTranslationWordLinksTool } from "./fetchTranslationWordLinks.js";
import { BundleCache, type Bundle, type ScriptureVersion } from "../../core/rag/BundleCache.js";
import { CFKVStore } from "../../core/rag/CFKVStore.js";
import { parseRcUri } from "../../core/rag/linkNormalizer.js";

const inputSchema = z.object({
  reference: referenceParam,
  language: languageParam,
  includeScripture: z
    .boolean()
    .default(true)
    .describe("Include all available scripture versions in the bundle."),
  includeNotes: z
    .boolean()
    .default(true)
    .describe("Include translation notes (TN) in the bundle."),
  includeWords: z
    .boolean()
    .default(true)
    .describe(
      "Include relevant Translation Words (TW) and Translation Academy (TA) links.",
    ),
});

export type GetBundleParams = z.infer<typeof inputSchema>;

const outputSchema = {
  reference: z.string(),
  language: z.string(),
  bundle: z.object({
    scripture: z
      .object({
        versions: z.array(
          z.object({
            resourceType: z.string(),
            text: z.string(),
            source: z.string(),
          }),
        ),
        format: z.enum(["usfm", "plain"]),
      })
      .optional(),
    notes: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          externalReference: z
            .object({ path: z.string() })
            .optional(),
        }),
      )
      .optional(),
    tw: z
      .array(z.object({ id: z.string(), title: z.string(), path: z.string() }))
      .optional(),
    ta: z
      .array(z.object({ id: z.string(), title: z.string(), path: z.string() }))
      .optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  requestId: z.string(),
};

/** Singleton L1 cache shared across invocations within a worker instance. */
const bundleCache = new BundleCache();

/** Extract the typed payload from a ToolResult via structuredContent (primary) or text JSON (fallback). */
function parseToolResult<T>(result: { structuredContent?: Record<string, unknown>; content: Array<{ type: "text"; text: string }> }): T | null {
  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    return result.structuredContent as unknown as T;
  }
  // Fallback: parse the first JSON-looking text entry
  for (const c of result.content) {
    if (c.text.startsWith("{") || c.text.startsWith("[")) {
      try {
        return JSON.parse(c.text) as T;
      } catch {
        // continue
      }
    }
  }
  return null;
}

export const getBundleTool: ToolModule<typeof inputSchema> = {
  name: "get_bundle",
  description:
    "Get a complete translation help bundle for a Bible passage in a single call. " +
    "Prefer this over separate fetch_scripture / fetch_translation_notes / fetch_translation_word_links calls when you need multiple resource types at once. " +
    "Returns a structured bundle containing: `scripture` text, `notes` array (each with optional TA `externalReference`), `tw` array of Translation Word paths, and `ta` array of Translation Academy paths from note support references. " +
    "Use the boolean flags `includeScripture`, `includeNotes`, `includeWords` to control what sections to include. " +
    "Limitation: scripture includes all versions returned by fetch_scripture (catalog-discovered). TA/TW articles are listed by path — call fetch_translation_academy or fetch_translation_word to read the full content.",
  inputSchema,
  outputSchema,
  annotations: { readOnlyHint: true, title: "Get Translation Bundle" },

  async handler(params: GetBundleParams, env: Env, requestId: string) {
    const { reference, language, includeScripture, includeNotes, includeWords } = params;

    const kvStore = new CFKVStore(env.TRANSLATION_HELPS_CACHE);

    // L1 cache check
    const l1 = bundleCache.get(language, reference);
    if (l1) {
      return ok({ reference, language, bundle: shapedBundle(l1, params), requestId },
        `Bundle for ${reference} (${language}) [memory]`);
    }

    // L2 KV cache check
    const l2 = await bundleCache.getFromKv(kvStore, language, reference);
    if (l2) {
      bundleCache.set(language, reference, l2);
      return ok({ reference, language, bundle: shapedBundle(l2, params), requestId },
        `Bundle for ${reference} (${language}) [edge]`);
    }

    // Assemble bundle from deterministic fetch tools
    const [scriptureResult, notesResult, twlResult] = await Promise.allSettled([
      includeScripture
        ? fetchScriptureTool.handler({ reference, language, format: "text" }, env, requestId)
        : Promise.resolve(null),
      includeNotes || includeWords
        ? fetchTranslationNotesTool.handler({ reference, language }, env, requestId)
        : Promise.resolve(null),
      includeWords
        ? fetchTranslationWordLinksTool.handler({ reference, language }, env, requestId)
        : Promise.resolve(null),
    ]);

    // Scripture — collect all available versions from fetch_scripture's versions[] array
    let scripture: Bundle["scripture"] = { versions: [], format: "plain" };
    if (scriptureResult.status === "fulfilled" && scriptureResult.value) {
      const sd = parseToolResult<{ versions?: ScriptureVersion[] }>(scriptureResult.value);
      if (sd?.versions?.length) {
        scripture = { versions: sd.versions, format: "plain" };
      }
    }

    // Notes + TA link extraction
    const rawNotes: Array<{ id: string; supportReference: string; note: string; book: string; chapter: string; verse: string }> = [];
    if (notesResult.status === "fulfilled" && notesResult.value) {
      const nd = parseToolResult<{ notes?: typeof rawNotes }>(notesResult.value);
      if (nd?.notes) rawNotes.push(...nd.notes);
    }

    const bundleNotes: Bundle["notes"] = rawNotes.map((n) => ({
      id: n.id || `${n.chapter}:${n.verse}`,
      text: n.note,
      ...(n.supportReference && n.supportReference.startsWith("rc://")
        ? { externalReference: { path: parseRcUri(n.supportReference)?.path ?? n.supportReference } }
        : {}),
    }));

    // TW articles from word links
    const twArticles: Bundle["tw"] = [];
    if (twlResult.status === "fulfilled" && twlResult.value) {
      const wd = parseToolResult<{ wordLinks?: Array<{ twId: string; wordPath: string; origWords?: string }> }>(
        twlResult.value,
      );
      const seen = new Set<string>();
      for (const link of wd?.wordLinks ?? []) {
        if (!link.wordPath || seen.has(link.wordPath)) continue;
        seen.add(link.wordPath);
        twArticles.push({
          id: link.twId || link.wordPath,
          title: link.origWords || link.wordPath.split("/").pop() || link.wordPath,
          path: link.wordPath,
        });
      }
    }

    // TA articles from note SupportReferences
    const taArticles: Bundle["ta"] = [];
    {
      const seenTa = new Set<string>();
      for (const n of rawNotes) {
        if (!n.supportReference) continue;
        const rcLinks = n.supportReference
          .split(/\s+/)
          .map((s) => s.trim())
          .filter((s) => s.startsWith("rc://"));
        for (const rc of rcLinks) {
          const parsed = parseRcUri(rc);
          if (!parsed || parsed.type !== "ta" || seenTa.has(parsed.path)) continue;
          seenTa.add(parsed.path);
          taArticles.push({
            id: parsed.path,
            title: parsed.path.split("/").pop() ?? parsed.path,
            path: parsed.path,
          });
        }
      }
    }

    const bundle: Bundle = {
      scripture,
      notes: bundleNotes,
      tw: twArticles,
      ta: taArticles,
      metadata: {
        cacheStatus: "miss",
        license: "CC BY-SA 4.0",
        language,
        reference,
        provenance: [],
      },
    };

    // Persist to L1 + L2
    bundleCache.set(language, reference, bundle);
    bundleCache.setToKv(kvStore, language, reference, bundle).catch(() => {});

    return ok(
      { reference, language, bundle: shapedBundle(bundle, params), requestId },
      `Bundle for ${reference} (${language})`,
    );
  },
};

/**
 * Apply the include* flags to omit sections from the response without
 * discarding them from the cached copy.
 */
function shapedBundle(
  bundle: Bundle,
  params: Pick<GetBundleParams, "includeScripture" | "includeNotes" | "includeWords">,
): Record<string, unknown> {
  const out: Record<string, unknown> = { metadata: bundle.metadata };
  if (params.includeScripture) out["scripture"] = bundle.scripture;
  if (params.includeNotes) out["notes"] = bundle.notes;
  if (params.includeWords) {
    out["tw"] = bundle.tw;
    out["ta"] = bundle.ta;
  }
  return out;
}
