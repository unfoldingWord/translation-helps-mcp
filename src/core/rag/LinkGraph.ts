/**
 * LinkGraph — tracks rc:// links between resources and resolves external references.
 *
 * A "link graph" is a map from a canonical `{language}:{reference}` key to the
 * list of rc:// paths that are referenced by the notes/questions for that passage.
 *
 * Stored in KV at: "resourceGraph:{language}:{reference}"  (linkGraphKey())
 *
 * Used by RagService.getBundle() to collect TW/TA articles that are linked from
 * translation notes.
 *
 * See DETAILED_SPEC.md "Bundle assembly order" for the authoritative algorithm.
 */

import type { KVStore } from "./interfaces.js";
import { linkGraphKey, LINK_GRAPH_TTL_L3 } from "../cache-ttls.js";
import { extractRcPaths } from "./linkNormalizer.js";

export interface LinkGraphEntry {
  /** rc:// path, e.g. "bible/kt/love" */
  path: string;
  /** "tw" | "ta" — which resource type this rc:// path belongs to */
  resourceType: "tw" | "ta";
  /** Source note ID(s) that reference this path */
  sourceIds: string[];
}

export interface LinkGraph {
  language: string;
  reference: string;
  entries: LinkGraphEntry[];
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * Parse note text chunks and extract all rc:// links, grouped by path.
 */
export function buildLinkGraph(
  language: string,
  reference: string,
  notesWithText: Array<{ id: string; text: string }>,
): LinkGraph {
  const pathMap = new Map<
    string,
    { resourceType: "tw" | "ta"; sourceIds: string[] }
  >();

  for (const note of notesWithText) {
    const paths = extractRcPaths(note.text);
    for (const rcPath of paths) {
      const existing = pathMap.get(rcPath);
      if (existing) {
        existing.sourceIds.push(note.id);
      } else {
        // Determine resource type from path prefix
        const resourceType = rcPath.startsWith("bible/") ? "tw" : "ta";
        pathMap.set(rcPath, { resourceType, sourceIds: [note.id] });
      }
    }
  }

  const entries: LinkGraphEntry[] = [];
  for (const [path, meta] of pathMap) {
    entries.push({
      path,
      resourceType: meta.resourceType,
      sourceIds: meta.sourceIds,
    });
  }

  return { language, reference, entries, updatedAt: new Date().toISOString() };
}

/**
 * Read a cached LinkGraph from KV.
 */
export async function readLinkGraph(
  kv: KVStore,
  language: string,
  reference: string,
): Promise<LinkGraph | null> {
  const key = linkGraphKey(language, reference);
  const raw = await kv.get(key).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LinkGraph;
  } catch {
    return null;
  }
}

/**
 * Persist a LinkGraph to KV.
 */
export async function writeLinkGraph(
  kv: KVStore,
  graph: LinkGraph,
): Promise<void> {
  const key = linkGraphKey(graph.language, graph.reference);
  await kv.set(key, JSON.stringify(graph), LINK_GRAPH_TTL_L3).catch(() => {
    // ignore cache write failures
  });
}
