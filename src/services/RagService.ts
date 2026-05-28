// PLACEHOLDER — replaced in T-09 (src/services/rag/RagService.ts)
// Kept here only so T-02..T-08 typecheck passes; will be deleted in T-09/T-12.

export interface RagQueryArgs {
  query: string;
  language?: string;
  reference?: string;
  filters?: Record<string, unknown>;
  k?: number;
  enableExact?: boolean;
  requestId?: string;
}

export interface RagDocument {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface RagQueryResponse {
  documents: RagDocument[];
  requestId: string;
  cached: boolean;
  durationMs: number;
}

export interface GetBundleArgs {
  reference: string;
  language: string;
  resources?: string[];
  requestId?: string;
}

export interface GetBundleResult {
  reference: string;
  language: string;
  scripture?: string;
  notes?: RagDocument[];
  words?: RagDocument[];
  academy?: RagDocument[];
  cacheStatus: "hit" | "miss" | "partial";
  requestId: string;
  durationMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

export interface RagService {
  query(args: RagQueryArgs): Promise<RagQueryResponse>;
  getBundle(args: GetBundleArgs): Promise<GetBundleResult>;
  indexResource(args: {
    resourceId?: string;
    zipUrl?: string;
    zipPath?: string;
    force?: boolean;
  }): Promise<{ taskId: string; status: string; details?: string }>;
  /** @deprecated used by old tests — removed in T-09 */
  clearIndex(): void;
  /** @deprecated used by old tests — removed in T-09 */
  prewarmReferences(refs: string[]): Promise<void>;
  /** @deprecated used by old tests — removed in T-09 */
  getCacheStats(): CacheStats;
  /** @deprecated used by old tests — removed in T-09 */
  setCacheConfig(config: Partial<{ maxSize: number }>): void;
}

export function createRagService(): RagService {
  return {
    async query(args) {
      return {
        documents: [],
        requestId: args.requestId ?? crypto.randomUUID(),
        cached: false,
        durationMs: 0,
      };
    },
    async getBundle(args) {
      return {
        reference: args.reference,
        language: args.language,
        notes: [],
        words: [],
        academy: [],
        cacheStatus: "miss",
        requestId: args.requestId ?? crypto.randomUUID(),
        durationMs: 0,
      };
    },
    async indexResource() {
      return { taskId: crypto.randomUUID(), status: "queued" };
    },
    clearIndex() {},
    async prewarmReferences() {},
    getCacheStats() {
      return { hits: 0, misses: 0, size: 0 };
    },
    setCacheConfig() {},
  };
}
