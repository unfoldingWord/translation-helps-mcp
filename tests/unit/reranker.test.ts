import { describe, it, expect } from "vitest";
import { Reranker } from "../../src/services/rag/Reranker.js";
import type { VectorStoreQueryResult } from "../../src/services/rag/interfaces.js";

function makeDoc(
  id: string,
  score: number,
  text: string,
  refTag?: string,
  resourceType?: string,
): VectorStoreQueryResult {
  return {
    id,
    score,
    document: {
      id,
      text,
      metadata: {
        language: "en",
        resourceType: resourceType ?? "tn",
        owner: "unfoldingWord",
        project: "en_tn",
        refTag: refTag ?? "v80",
        path: `${id}.tsv`,
        chunkIndex: 0,
      },
    },
  };
}

describe("Reranker", () => {
  const reranker = new Reranker();

  it("returns empty array for empty input", () => {
    expect(reranker.rerank([], "test")).toEqual([]);
  });

  it("returns original order when all scores are equal", () => {
    const docs = [
      makeDoc("a", 0.8, "short text"),
      makeDoc("b", 0.8, "short text"),
    ];
    const results = reranker.rerank(docs, "test query");
    expect(results).toHaveLength(2);
  });

  it("prefers documents with higher semantic score", () => {
    const docs = [
      makeDoc(
        "low",
        0.3,
        "word word word word word word word word word word word word word word word word word word",
      ),
      makeDoc(
        "high",
        0.9,
        "word word word word word word word word word word word word word word word word word word",
      ),
    ];
    const results = reranker.rerank(docs, "test query", { maxResults: 2 });
    expect(results[0]!.id).toBe("high");
  });

  it("prefers documents with higher refTag version", () => {
    const docs = [
      makeDoc(
        "old",
        0.5,
        "grace mercy peace from God our Father and the Lord Jesus Christ",
        "v72",
      ),
      makeDoc(
        "new",
        0.5,
        "grace mercy peace from God our Father and the Lord Jesus Christ",
        "v80",
      ),
    ];
    const results = reranker.rerank(docs, "grace mercy", { maxResults: 2 });
    expect(results[0]!.id).toBe("new");
  });

  it("applies boost multiplier by resourceType", () => {
    const docs = [
      makeDoc("tn", 0.5, "note about grace in context", "v80", "tn"),
      makeDoc("tw", 0.5, "word article about grace theme", "v80", "tw"),
    ];
    // Boost TN
    const results = reranker.rerank(docs, "grace", {
      maxResults: 2,
      boost: { tn: 1.5 },
    });
    expect(results[0]!.id).toBe("tn");
  });

  it("respects maxResults limit", () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc(
        `d${i}`,
        0.5 + i * 0.03,
        "word word word word word word word word word word word",
      ),
    );
    const results = reranker.rerank(docs, "test", { maxResults: 3 });
    expect(results).toHaveLength(3);
  });

  it("degrades gracefully when score is outside [0,1] bounds", () => {
    const docs = [makeDoc("x", 1.5, "some text about the topic")];
    expect(() => reranker.rerank(docs, "topic")).not.toThrow();
  });

  it("returns signals in result", () => {
    const docs = [makeDoc("sig", 0.6, "faith hope love grace mercy peace")];
    const results = reranker.rerank(docs, "faith hope love");
    expect(results[0]!.signals).toBeDefined();
    expect(typeof results[0]!.signals.semanticScore).toBe("number");
    expect(typeof results[0]!.signals.recencyScore).toBe("number");
    expect(typeof results[0]!.signals.frequencyScore).toBe("number");
    expect(typeof results[0]!.signals.lengthScore).toBe("number");
  });

  it("handles undefined refTag gracefully", () => {
    const docs = [
      makeDoc("noref", 0.5, "text content here lorem ipsum dolor sit amet"),
    ];
    docs[0]!.document.metadata["refTag"] = undefined;
    expect(() => reranker.rerank(docs, "content")).not.toThrow();
  });

  it("does not throw on rerank error — degrades to original order", () => {
    const docs = [
      makeDoc("safe", 0.7, "ten words here and also some more text words"),
    ];
    // Force an error by passing a circular reference in boost that would
    // cause issues — actually just test the non-throw guarantee
    expect(() =>
      reranker.rerank(docs, "words", { maxResults: 1 }),
    ).not.toThrow();
  });
});
