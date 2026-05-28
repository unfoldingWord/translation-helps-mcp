import { describe, it, expect } from "vitest";
import { FakeEmbeddingService } from "../../src/services/rag/providers/FakeEmbeddingService.js";
import { FakeLLMProvider } from "../../src/services/rag/providers/FakeLLMProvider.js";

describe("FakeEmbeddingService", () => {
  const svc = new FakeEmbeddingService();

  it("returns a vector with correct dimensionality", async () => {
    const [vec] = await svc.embed(["hello world"]);
    expect(vec).toHaveLength(svc.dimensionality());
    expect(svc.dimensionality()).toBe(768);
  });

  it("returns unit-length vectors (cosine-ready)", async () => {
    const [vec] = await svc.embed([
      "The word grace appears in many translations",
    ]);
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 4);
  });

  it("returns different vectors for different texts", async () => {
    const [a, b] = await svc.embed(["apple", "orange"]);
    expect(a).not.toEqual(b);
  });

  it("returns identical vectors for identical texts (deterministic)", async () => {
    const [a] = await svc.embed(["For God so loved the world"]);
    const [b] = await svc.embed(["For God so loved the world"]);
    expect(a).toEqual(b);
  });

  it("batches multiple texts", async () => {
    const texts = ["hello", "world", "foo", "bar"];
    const vecs = await svc.embed(texts);
    expect(vecs).toHaveLength(4);
    vecs.forEach((v) => expect(v).toHaveLength(768));
  });

  it("returns empty array for empty input", async () => {
    const vecs = await svc.embed([]);
    expect(vecs).toHaveLength(0);
  });

  it("modelId returns the expected identifier", () => {
    expect(svc.modelId()).toBe("fake/deterministic-768");
  });
});

describe("FakeLLMProvider", () => {
  const llm = new FakeLLMProvider();

  it("returns a string response", async () => {
    const res = await llm.generate([
      { role: "user", content: "What is grace?" },
    ]);
    expect(typeof res).toBe("string");
  });

  it("echoes the last user message with prefix", async () => {
    const res = await llm.generate([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Explain John 3:16" },
    ]);
    expect(res).toContain("[FAKE LLM]:");
    expect(res).toContain("Explain John 3:16");
  });

  it("handles empty messages gracefully", async () => {
    const res = await llm.generate([]);
    expect(typeof res).toBe("string");
    expect(res.length).toBeGreaterThan(0);
  });

  it("modelId returns the expected identifier", () => {
    expect(llm.modelId()).toBe("fake/echo");
  });
});
