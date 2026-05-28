import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLinkGraph,
  readLinkGraph,
  writeLinkGraph,
} from "../../src/services/rag/LinkGraph.js";
import { InMemoryKVStore } from "../../src/services/rag/InMemoryKVStore.js";

describe("buildLinkGraph()", () => {
  it("returns empty entries when notes have no rc:// links", () => {
    const graph = buildLinkGraph("en", "JHN 3:16", [
      { id: "n1", text: "The verse speaks of love." },
      { id: "n2", text: "God sent his son as a gift." },
    ]);
    expect(graph.language).toBe("en");
    expect(graph.reference).toBe("JHN 3:16");
    expect(graph.entries).toHaveLength(0);
    expect(graph.updatedAt).toMatch(/^\d{4}-/);
  });

  it("extracts rc:// paths from note text", () => {
    const graph = buildLinkGraph("en", "JHN 3:16", [
      {
        id: "n1",
        text: "See rc://en/tw/bible/kt/love and rc://en/ta/man/translate/figs-metaphor",
      },
    ]);
    expect(graph.entries.length).toBeGreaterThan(0);
    const paths = graph.entries.map((e) => e.path);
    // rc:// paths should be extracted (path portion)
    expect(paths.some((p) => p.includes("love") || p.includes("bible"))).toBe(
      true,
    );
  });

  it("deduplicates the same path referenced by multiple notes", () => {
    const graph = buildLinkGraph("en", "MAT 5:3", [
      { id: "n1", text: "See rc://en/tw/bible/kt/love for context." },
      {
        id: "n2",
        text: "The word love: rc://en/tw/bible/kt/love explains it.",
      },
    ]);
    const lovePaths = graph.entries.filter((e) => e.path.includes("love"));
    expect(lovePaths).toHaveLength(1);
    expect(lovePaths[0]!.sourceIds).toContain("n1");
    expect(lovePaths[0]!.sourceIds).toContain("n2");
  });

  it("classifies tw paths as 'tw' resourceType", () => {
    const graph = buildLinkGraph("en", "GEN 1:1", [
      { id: "n1", text: "rc://en/tw/bible/kt/god is relevant here" },
    ]);
    const entry = graph.entries.find((e) => e.path.includes("bible"));
    expect(entry?.resourceType).toBe("tw");
  });

  it("classifies non-bible paths as 'ta' resourceType", () => {
    const graph = buildLinkGraph("en", "GEN 1:1", [
      {
        id: "n1",
        text: "rc://en/ta/man/translate/figs-metaphor explains the figure",
      },
    ]);
    const entry = graph.entries.find((e) => e.path.includes("translate"));
    expect(entry?.resourceType).toBe("ta");
  });
});

describe("readLinkGraph / writeLinkGraph", () => {
  let kv: InMemoryKVStore;

  beforeEach(() => {
    kv = new InMemoryKVStore();
  });

  it("returns null for non-existent graph", async () => {
    const result = await readLinkGraph(kv, "en", "JHN 3:16");
    expect(result).toBeNull();
  });

  it("round-trips a graph through KV", async () => {
    const graph = buildLinkGraph("en", "JHN 3:16", [
      { id: "n1", text: "rc://en/tw/bible/kt/love is present here" },
    ]);
    await writeLinkGraph(kv, graph);
    const read = await readLinkGraph(kv, "en", "JHN 3:16");
    expect(read).not.toBeNull();
    expect(read!.language).toBe("en");
    expect(read!.reference).toBe("JHN 3:16");
    expect(read!.entries.length).toBeGreaterThan(0);
  });

  it("returns null for malformed KV entry", async () => {
    const { linkGraphKey } = await import("../../src/config/cache-ttls.js");
    await kv.set(linkGraphKey("en", "ROM 1:1"), "not-json", 3600);
    const result = await readLinkGraph(kv, "en", "ROM 1:1");
    expect(result).toBeNull();
  });
});
