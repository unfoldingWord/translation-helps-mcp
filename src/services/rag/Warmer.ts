/**
 * Warmer — Pre-warms the bundle cache for top-20 languages × top-100 references.
 *
 * Algorithm from CACHING_STRATEGY.md "WARM-UP ALGORITHM":
 *   1. Top 20 priority languages (hardcoded from DOOR43_INTEGRATION.md)
 *   2. Top 100 passages by request frequency (read from KV sorted set; fall back to Gospel list)
 *   3. Concurrency: max 10 parallel bundle fetches (token bucket, refill 10/s)
 *   4. Failures are non-fatal — log warning and continue.
 *
 * Trigger points:
 *   - On startup (after indexer marks job complete)
 *   - Nightly cron (3am UTC via Cloudflare Cron Trigger)
 *   - After index:updated event (for affected references)
 */

import type { KVStore } from "./interfaces.js";
import type { RagService } from "./RagService.js";

// ---------------------------------------------------------------------------
// Priority constants (from DOOR43_INTEGRATION.md and CACHING_STRATEGY.md)
// ---------------------------------------------------------------------------

/** Top 20 strategic languages ordered by translation priority. */
export const PRIORITY_LANGUAGES: readonly string[] = [
  "en",
  "es-419",
  "fr",
  "pt-BR",
  "id",
  "hi",
  "am",
  "ru",
  "zh-Hans",
  "de",
  "ar",
  "sw",
  "fil",
  "ha",
  "ko",
  "vi",
  "th",
  "tr",
  "uk",
  "ro",
];

/**
 * Default top-100 passages when no usage history is available.
 * Ordered by global theological relevance + known translation difficulty.
 */
export const DEFAULT_TOP_REFERENCES: readonly string[] = [
  "JHN 3:16",
  "JHN 1:1",
  "MAT 5:1",
  "LUK 2:1",
  "GEN 1:1",
  "PSA 23:1",
  "ROM 8:1",
  "PRO 3:5",
  "PHP 4:13",
  "1CO 13:4",
  "EPH 2:8",
  "JER 29:11",
  "ISA 53:1",
  "REV 21:1",
  "ACT 1:1",
  "HEB 11:1",
  "JAS 1:1",
  "1PE 1:1",
  "2TI 3:16",
  "MAT 28:19",
  "LUK 15:11",
  "ROM 3:23",
  "ROM 6:23",
  "ROM 5:8",
  "JHN 14:6",
  "MAT 6:9",
  "MAT 22:37",
  "GAL 5:22",
  "COL 3:16",
  "PSA 119:1",
  "GEN 1:26",
  "EXO 20:1",
  "DEU 6:4",
  "JOS 1:9",
  "1SA 17:45",
  "PSA 1:1",
  "PSA 46:1",
  "ISA 40:31",
  "JER 31:31",
  "EZE 37:1",
  "DAN 3:17",
  "JON 1:1",
  "MIC 6:8",
  "MAL 3:10",
  "MAT 1:1",
  "MAT 5:3",
  "MAT 11:28",
  "MAT 16:18",
  "MAT 25:31",
  "MAR 1:1",
  "LUK 1:28",
  "LUK 4:18",
  "LUK 10:27",
  "LUK 19:10",
  "JHN 4:14",
  "JHN 10:10",
  "JHN 11:25",
  "JHN 13:34",
  "JHN 15:5",
  "JHN 17:1",
  "ACT 2:38",
  "ACT 4:12",
  "ROM 1:16",
  "ROM 8:28",
  "ROM 12:1",
  "1CO 1:18",
  "1CO 10:13",
  "1CO 15:1",
  "2CO 5:17",
  "2CO 12:9",
  "GAL 2:20",
  "GAL 3:28",
  "EPH 4:11",
  "EPH 6:10",
  "PHP 2:5",
  "PHP 3:14",
  "PHP 4:7",
  "COL 1:15",
  "1TH 5:16",
  "2TH 3:3",
  "1TI 2:5",
  "2TI 4:7",
  "TIT 3:5",
  "PHM 1:1",
  "HEB 4:12",
  "HEB 12:1",
  "JAS 2:17",
  "1PE 3:15",
  "1PE 5:7",
  "2PE 1:21",
  "1JN 1:9",
  "1JN 4:8",
  "JUD 1:3",
  "REV 1:1",
  "REV 3:20",
  "REV 22:13",
  "PSA 91:1",
  "ISA 9:6",
  "ISA 7:14",
  "MAT 5:44",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WarmupTarget {
  language: string;
  reference: string;
}

export interface WarmupResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface WarmerConfig {
  /** Max concurrent bundle fetches (default: 10). */
  concurrency?: number;
  /** Max targets to warm per run (default: all = 20 × 100 = 2000). */
  maxTargets?: number;
}

// ---------------------------------------------------------------------------
// KV sorted-set key for request frequency tracking
// ---------------------------------------------------------------------------

export function requestCountKey(language: string): string {
  return `warm:request-count:${language}`;
}

/**
 * Increment the request count for a language:reference pair.
 * Used by the RAG query path to build frequency data for warm-up.
 */
export async function recordRequest(
  kvStore: KVStore,
  language: string,
  reference: string,
): Promise<void> {
  try {
    const key = `${requestCountKey(language)}:${reference}`;
    const existing = await kvStore.get(key);
    const count = existing ? parseInt(existing, 10) + 1 : 1;
    await kvStore.set(key, String(count), 60 * 60 * 24 * 30); // 30 days TTL
  } catch {
    // Non-fatal — warm-up tracking should never block the request path
  }
}

// ---------------------------------------------------------------------------
// Warmer class
// ---------------------------------------------------------------------------

export class Warmer {
  private readonly concurrency: number;
  private readonly maxTargets: number;

  constructor(
    private readonly ragService: RagService,
    private readonly kvStore: KVStore,
    config: WarmerConfig = {},
  ) {
    this.concurrency = config.concurrency ?? 10;
    this.maxTargets =
      config.maxTargets ??
      PRIORITY_LANGUAGES.length * DEFAULT_TOP_REFERENCES.length;
  }

  /**
   * Compute warm-up targets in priority order:
   * Top-5 languages × top-20 passages first, then the rest.
   */
  async computeTargets(): Promise<WarmupTarget[]> {
    const targets: WarmupTarget[] = [];
    const seen = new Set<string>();

    const addTarget = (language: string, reference: string) => {
      const key = `${language}:${reference}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ language, reference });
      }
    };

    // Tier 1: top-5 languages × top-20 passages (highest priority)
    for (const lang of PRIORITY_LANGUAGES.slice(0, 5)) {
      const topRefs = await this.getTopReferences(lang, 20);
      for (const ref of topRefs) {
        addTarget(lang, ref);
      }
    }

    // Tier 2: remaining languages × top-100 passages
    for (const lang of PRIORITY_LANGUAGES) {
      const topRefs = await this.getTopReferences(lang, 100);
      for (const ref of topRefs) {
        addTarget(lang, ref);
      }
    }

    return targets.slice(0, this.maxTargets);
  }

  /**
   * Get top N references for a language from KV frequency data.
   * Falls back to DEFAULT_TOP_REFERENCES if no frequency data.
   */
  private async getTopReferences(
    language: string,
    n: number,
  ): Promise<string[]> {
    try {
      const scores: Array<{ reference: string; count: number }> = [];

      for (const ref of DEFAULT_TOP_REFERENCES) {
        const key = `${requestCountKey(language)}:${ref}`;
        const raw = await this.kvStore.get(key);
        if (raw) {
          scores.push({ reference: ref, count: parseInt(raw, 10) });
        }
      }

      if (scores.length > 0) {
        scores.sort((a, b) => b.count - a.count);
        const ranked = scores.slice(0, n).map((s) => s.reference);
        // Fill remaining slots with defaults not already in ranked
        const extra = DEFAULT_TOP_REFERENCES.filter((r) => !ranked.includes(r));
        return [...ranked, ...extra].slice(0, n);
      }
    } catch {
      // Fall through to defaults
    }

    return [...DEFAULT_TOP_REFERENCES].slice(0, n);
  }

  /**
   * Run the full warm-up sweep.
   * Concurrency-limited with token bucket (max `this.concurrency` in flight).
   */
  async run(): Promise<WarmupResult> {
    const start = Date.now();
    const targets = await this.computeTargets();

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // Process in chunks of `this.concurrency`
    for (let i = 0; i < targets.length; i += this.concurrency) {
      const chunk = targets.slice(i, i + this.concurrency);

      await Promise.all(
        chunk.map(async ({ language, reference }) => {
          try {
            const result = await this.ragService.getBundle({
              language,
              reference,
              requestId: `warmer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            });

            if (result.bundle.metadata.cacheStatus === "memory") {
              skipped++;
            } else {
              succeeded++;
            }
          } catch (err) {
            failed++;
            // Warn but don't abort
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[Warmer] Failed to warm ${language}:${reference}: ${msg}`,
            );
          }
        }),
      );
    }

    return {
      total: targets.length,
      succeeded,
      failed,
      skipped,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWarmer(
  ragService: RagService,
  kvStore: KVStore,
  config?: WarmerConfig,
): Warmer {
  return new Warmer(ragService, kvStore, config);
}
