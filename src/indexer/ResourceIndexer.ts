/**
 * ResourceIndexer — greenfield rebuild (T-08).
 *
 * Reads resources exclusively via ZipResourceFetcher2.
 * Produces canonical doc_ids, extracts license metadata, and is idempotent.
 *
 * doc_id format: "resource:{owner}:{project}@{refTag}:{path}:chunk:{n}"
 * r2Key  format: "{owner}/{project}@{refTag}/files/{path}"
 *
 * See CONTRACTS_DETAILED.md for the full specification.
 */

import { randomUUID } from "crypto";
import { ZipResourceFetcher2 } from "../services/ZipResourceFetcher2.js";
import { chunkUsfm } from "./chunkers/usfmChunker.js";
import { chunkTsv } from "./chunkers/tsvChunker.js";
import { chunkMarkdown } from "./chunkers/markdownChunker.js";
import type {
  VectorStore,
  VectorStoreDocumentInput,
  VectorStoreMetadata,
} from "../services/rag/interfaces.js";
import type { EmbeddingService } from "../services/rag/providers/EmbeddingService.js";

export interface IndexResourceArgs {
  owner: string;
  project: string;
  refTag: string;
  /** Canonical zipball URL (from DCS catalog zipball_url) */
  zipballUrl: string | null;
  /** Inferred resource type */
  resourceType:
    | "ult"
    | "ust"
    | "glt"
    | "gst"
    | "tn"
    | "tq"
    | "tw"
    | "ta"
    | "twl";
  language: string; // BCP 47
  license?: string;
  /** File paths to index (from manifest.yaml ingredients) */
  filePaths: string[];
  /** If true, delete existing chunks for this resource before indexing */
  force?: boolean;
}

export interface IndexResourceResult {
  taskId: string;
  status: "queued" | "started" | "completed" | "failed";
  chunksIndexed?: number;
  details?: string;
}

/**
 * Build canonical doc_id.
 * Format: "resource:{owner}:{project}@{refTag}:{path}:chunk:{chunkIndex}"
 */
export function buildDocId(
  owner: string,
  project: string,
  refTag: string,
  path: string,
  chunkIndex: number,
): string {
  return `resource:${owner}:${project}@${refTag}:${path}:chunk:${chunkIndex}`;
}

/**
 * Infer source type from file extension.
 */
function inferSourceType(filePath: string): "usfm" | "tsv" | "markdown" | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".usfm")) return "usfm";
  if (lower.endsWith(".tsv")) return "tsv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return null;
}

/**
 * Extract license string from manifest text (YAML parsing via regex).
 * Returns "CC BY-SA 4.0" as default if not found.
 */
export function extractLicense(manifestYaml: string): string {
  const m = manifestYaml.match(/license\s*:\s*([^\n]+)/i);
  return m?.[1]?.trim() ?? "CC BY-SA 4.0";
}

export class ResourceIndexer {
  private readonly zipFetcher: ZipResourceFetcher2;
  private readonly vectorStore: VectorStore;
  private readonly embeddingService: EmbeddingService;

  constructor(deps: {
    zipFetcher?: ZipResourceFetcher2;
    vectorStore: VectorStore;
    embeddingService: EmbeddingService;
  }) {
    this.zipFetcher = deps.zipFetcher ?? new ZipResourceFetcher2();
    this.vectorStore = deps.vectorStore;
    this.embeddingService = deps.embeddingService;
  }

  async indexResource(args: IndexResourceArgs): Promise<IndexResourceResult> {
    const taskId = randomUUID();

    if (args.force) {
      await this.vectorStore.delete({
        owner: args.owner,
        project: args.project,
        refTag: args.refTag,
      });
    } else {
      // Idempotency check: if we have at least one chunk already, skip
      const existing = await this.vectorStore.query(
        new Array(this.embeddingService.dimensionality()).fill(0),
        1,
        { owner: args.owner, project: args.project, refTag: args.refTag },
      );
      if (existing.length > 0) {
        return {
          taskId,
          status: "completed",
          chunksIndexed: 0,
          details: `Resource ${args.owner}/${args.project}@${args.refTag} already indexed; skipping (use force=true to re-index)`,
        };
      }
    }

    const zipData = await this.zipFetcher.getOrDownloadZip(
      args.owner,
      args.project,
      args.refTag,
      args.zipballUrl,
    );

    if (!zipData) {
      return {
        taskId,
        status: "failed",
        details: `Could not download ZIP for ${args.owner}/${args.project}@${args.refTag}`,
      };
    }

    // Try to extract license from manifest.yaml
    let license = args.license ?? "CC BY-SA 4.0";
    const manifestRaw = await this.zipFetcher.extractFileFromZip(
      zipData,
      "manifest.yaml",
      args.project,
      `zip:${args.owner}/${args.project}:${args.refTag}`,
    );
    if (manifestRaw) {
      license = extractLicense(manifestRaw);
    }

    const allChunks: VectorStoreDocumentInput[] = [];

    for (const filePath of args.filePaths) {
      const sourceType = inferSourceType(filePath);
      if (!sourceType) continue;

      const rawContent = await this.zipFetcher.extractFileFromZip(
        zipData,
        filePath,
        args.project,
        `zip:${args.owner}/${args.project}:${args.refTag}`,
      );

      if (!rawContent) continue;

      const baseMetadata: Omit<VectorStoreMetadata, "chunkIndex"> = {
        language: args.language,
        resourceType: args.resourceType,
        owner: args.owner,
        project: args.project,
        refTag: args.refTag,
        path: filePath,
        license,
      };

      if (sourceType === "usfm") {
        const chunks = chunkUsfm(rawContent);
        for (const chunk of chunks) {
          allChunks.push({
            id: buildDocId(
              args.owner,
              args.project,
              args.refTag,
              filePath,
              chunk.chunkIndex,
            ),
            text: chunk.text,
            metadata: {
              ...baseMetadata,
              chunkIndex: chunk.chunkIndex,
            } as VectorStoreMetadata,
          });
        }
      } else if (sourceType === "tsv") {
        const chunks = chunkTsv(rawContent);
        for (const chunk of chunks) {
          const meta: VectorStoreMetadata = {
            ...baseMetadata,
            chunkIndex: chunk.chunkIndex,
          } as VectorStoreMetadata;
          if (chunk.reference) meta["reference"] = chunk.reference;
          if (chunk.id) meta["tsvId"] = chunk.id;
          if (chunk.supportRef) meta["supportRef"] = chunk.supportRef;
          allChunks.push({
            id: buildDocId(
              args.owner,
              args.project,
              args.refTag,
              filePath,
              chunk.chunkIndex,
            ),
            text: chunk.text,
            metadata: meta,
          });
        }
      } else if (sourceType === "markdown") {
        const chunks = chunkMarkdown(rawContent);
        for (const chunk of chunks) {
          const meta: VectorStoreMetadata = {
            ...baseMetadata,
            chunkIndex: chunk.chunkIndex,
          } as VectorStoreMetadata;
          if (chunk.title) meta["title"] = chunk.title;
          if (chunk.heading) meta["heading"] = chunk.heading;
          if (chunk.rcLink) meta["rcLink"] = chunk.rcLink;
          allChunks.push({
            id: buildDocId(
              args.owner,
              args.project,
              args.refTag,
              filePath,
              chunk.chunkIndex,
            ),
            text: chunk.text,
            metadata: meta,
          });
        }
      }
    }

    if (allChunks.length === 0) {
      return {
        taskId,
        status: "failed",
        details: `No chunks produced for ${args.owner}/${args.project}@${args.refTag}`,
      };
    }

    // Generate embeddings in batches
    const EMBED_BATCH = 64;
    const texts = allChunks.map((c) => c.text);
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = await this.embeddingService.embed(
        texts.slice(i, i + EMBED_BATCH),
      );
      allEmbeddings.push(...batch);
    }

    // Upsert with embeddings
    const docsWithEmbeddings = allChunks.map((doc, i) => ({
      ...doc,
      embedding: allEmbeddings[i],
    }));
    await this.vectorStore.upsert(docsWithEmbeddings);

    return {
      taskId,
      status: "completed",
      chunksIndexed: allChunks.length,
      details: `Indexed ${allChunks.length} chunks for ${args.owner}/${args.project}@${args.refTag}`,
    };
  }
}
