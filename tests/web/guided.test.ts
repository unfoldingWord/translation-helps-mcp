import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY } from "../../src/mcp/toolRegistry.js";
import {
  EXAMPLES,
  GUIDED_STEPS,
  deeperCall,
  latestOnly,
  mapRows,
  nextStep,
  stepCall,
} from "../../web/src/lib/try/guided.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const john = fixture("passage-index-john-3-16.json");
const empty = fixture("passage-index-empty.json");

describe("guided walk steps", () => {
  it("follow the server's workflow", () => {
    expect(GUIDED_STEPS.map((s) => s.id)).toEqual([
      "pick",
      "text",
      "context",
      "map",
      "deeper",
      "check",
    ]);
    for (const s of GUIDED_STEPS) {
      if (s.tool) expect(TOOL_REGISTRY[s.tool], s.id).toBeDefined();
    }
  });

  it("offer the three examples", () => {
    expect(EXAMPLES).toEqual(["John 3:16", "Ruth 1:1-5", "Titus 1:1"]);
  });

  it("call the passage tools with the reference and language", () => {
    expect(stepCall("text", "en", "John 3:16")).toEqual({
      tool: "get_passage",
      args: { reference: "John 3:16", language: "en" },
    });
    expect(stepCall("context", "en", "John 3:16")).toEqual({
      tool: "get_passage_context",
      args: { reference: "John 3:16", language: "en" },
    });
    expect(stepCall("map", "en", "John 3:16")).toEqual({
      tool: "get_passage_index",
      args: { reference: "John 3:16", language: "en" },
    });
    expect(stepCall("check", "en", "John 3:16")).toEqual({
      tool: "get_questions",
      args: { reference: "John 3:16", language: "en" },
    });
    expect(stepCall("pick", "en", "John 3:16")).toBeNull();
    expect(stepCall("deeper", "en", "John 3:16")).toBeNull();
  });

  it("make calls every tool's schema accepts", () => {
    for (const s of GUIDED_STEPS) {
      const call = stepCall(s.id, "en", "John 3:16");
      if (!call) continue;
      const parsed = TOOL_REGISTRY[call.tool].inputSchema.safeParse(call.args);
      expect(parsed.success, s.id).toBe(true);
    }
  });
});

describe("map of helps", () => {
  const rows = mapRows(john);

  it("has notes, Academy topics and key terms", () => {
    for (const kind of ["note", "academy", "word"] as const) {
      expect(
        rows.some((r) => r.kind === kind),
        kind,
      ).toBe(true);
    }
  });

  it("gives every note its original and aligned words", () => {
    for (const r of rows.filter((x) => x.kind === "note")) {
      expect(r.quote?.original, r.key).toBeTruthy();
      expect(r.quote?.aligned, r.key).toBeTruthy();
    }
  });

  it("labels rows from the index", () => {
    expect(rows).toContainEqual({
      kind: "note",
      key: "uxc2",
      label: "Metonymy",
      quote: { original: "τὸν κόσμον", aligned: "the world" },
    });
    // A note with no Academy article still gets a label.
    expect(rows.find((r) => r.key === "h4ht")?.label).toBe("Note");
    expect(rows).toContainEqual({
      kind: "academy",
      key: "translate/guidelines-sonofgodprinciples",
      label: "Translating Son and Father (2)",
    });
    expect(rows).toContainEqual({
      kind: "word",
      key: "bible/kt/god",
      label: "God (1)",
    });
  });

  it("opens each row with a call its tool accepts", () => {
    for (const r of rows) {
      const call = deeperCall(r, "en", "John 3:16");
      const tool = TOOL_REGISTRY[call.tool];
      expect(tool, call.tool).toBeDefined();
      const parsed = tool.inputSchema.safeParse(call.args);
      expect(parsed.success, `${r.kind} ${r.key}`).toBe(true);
    }
  });

  it("names the right tool and argument for each kind", () => {
    expect(
      deeperCall({ kind: "note", key: "uxc2" }, "en", "John 3:16"),
    ).toEqual({
      tool: "get_note",
      args: { reference: "John 3:16", language: "en", id: "uxc2" },
    });
    expect(
      deeperCall(
        { kind: "academy", key: "translate/figs-metonymy" },
        "en",
        "John 3:16",
      ),
    ).toEqual({
      tool: "get_academy_article",
      args: { path: "translate/figs-metonymy", language: "en" },
    });
    expect(
      deeperCall({ kind: "word", key: "bible/kt/god" }, "en", "John 3:16"),
    ).toEqual({
      tool: "get_word_article",
      args: { path: "bible/kt/god", language: "en" },
    });
  });

  it("is empty for a passage with no notes or key terms", () => {
    expect(mapRows(empty)).toEqual([]);
  });

  it("is empty for odd input", () => {
    expect(mapRows(null)).toEqual([]);
    expect(mapRows({})).toEqual([]);
    expect(mapRows("text")).toEqual([]);
    expect(mapRows({ notes: [null, 3, { id: 7 }], issues: "x" })).toEqual([]);
  });
});

describe("moving through the walk", () => {
  it("goes one step at a time", () => {
    expect(nextStep("pick", 1, true)).toBe("text");
    expect(nextStep("map", 1, true)).toBe("deeper");
    expect(nextStep("check", 1, true)).toBe("check");
    expect(nextStep("pick", -1, true)).toBe("pick");
  });

  it("skips Go deeper when the map has nothing to open", () => {
    expect(nextStep("map", 1, false)).toBe("check");
    expect(nextStep("check", -1, false)).toBe("map");
  });
});

describe("latest answer only", () => {
  it("drops an answer once a newer call has started", () => {
    const seq = latestOnly();
    const first = seq.next();
    const second = seq.next();
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(seq.isLatest(1)).toBe(false);
    expect(seq.isLatest(2)).toBe(true);
  });

  it("keeps each sequence apart", () => {
    const a = latestOnly();
    const b = latestOnly();
    a.next();
    a.next();
    expect(b.next()).toBe(1);
    expect(b.isLatest(1)).toBe(true);
    expect(a.isLatest(1)).toBe(false);
  });
});
