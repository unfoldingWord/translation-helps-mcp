import { describe, expect, it } from "vitest";
import {
  decodeTryState,
  encodeTryState,
  type TryState,
} from "../../web/src/lib/try/hashState";

describe("try state in the URL hash", () => {
  it("round-trips", () => {
    const tools: TryState = {
      tab: "tools",
      tool: "get_passage",
      args: { reference: "John 3:16", note: "é" },
    };
    expect(decodeTryState(encodeTryState(tools), ["get_passage"])).toEqual(
      tools,
    );
    const guided: TryState = {
      tab: "guided",
      lang: "en",
      ref: "John 3:16",
      step: "map",
    };
    expect(decodeTryState(encodeTryState(guided), [])).toEqual(guided);
    const obs: TryState = { tab: "obs", lang: "id", story: 3 };
    expect(decodeTryState(encodeTryState(obs), [])).toEqual(obs);
    const frame: TryState = { tab: "obs", lang: "en", story: 3, frame: 5 };
    expect(decodeTryState(encodeTryState(frame), [])).toEqual(frame);
    const notes: TryState = {
      tab: "obs",
      lang: "en",
      story: 3,
      frame: 5,
      obsStep: "notes",
    };
    expect(decodeTryState(encodeTryState(notes), [])).toEqual(notes);
    const open: TryState = {
      tab: "guided",
      step: "deeper",
      open: { kind: "word", key: "grace" },
    };
    expect(decodeTryState(encodeTryState(open), [])).toEqual(open);
  });

  it("starts with a hash and uses only URL-safe characters", () => {
    const hash = encodeTryState({ tab: "guided", ref: "Génesis 1:1???>>>" });
    expect(hash.startsWith("#")).toBe(true);
    expect(hash.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("falls back to the guided tab on anything odd", () => {
    expect(decodeTryState("#%%%", ["get_passage"])).toEqual({ tab: "guided" });
    expect(decodeTryState("#not-base64", ["get_passage"])).toEqual({
      tab: "guided",
    });
    expect(decodeTryState("#" + btoa('{"tab":"chat"}'), [])).toEqual({
      tab: "guided",
    });
    expect(
      decodeTryState("#" + btoa('{"tab":"tools","tool":"rm"}'), [
        "get_passage",
      ]),
    ).toEqual({
      tab: "tools",
    });
    expect(decodeTryState("", [])).toEqual({ tab: "guided" });
    expect(decodeTryState("#" + btoa("[1,2]"), [])).toEqual({ tab: "guided" });
    expect(
      decodeTryState(
        "#" + btoa('{"tab":"guided","story":"x","evil":1,"step":"nope"}'),
        [],
      ),
    ).toEqual({ tab: "guided" });
    expect(
      decodeTryState("#" + btoa('{"tab":"obs","story":3,"frame":"5"}'), []),
    ).toEqual({ tab: "guided" });
    expect(
      decodeTryState("#" + btoa('{"tab":"obs","obsStep":"nope"}'), []),
    ).toEqual({ tab: "guided" });
    expect(decodeTryState("#" + btoa('{"tab":"obs","obsStep":3}'), [])).toEqual(
      { tab: "guided" },
    );
    expect(
      decodeTryState("#" + btoa('{"tab":"guided","step":"nope"}'), []),
    ).toEqual({
      tab: "guided",
    });
    expect(
      decodeTryState(
        "#" + btoa('{"tab":"guided","open":{"kind":"x","key":"a"}}'),
        [],
      ),
    ).toEqual({ tab: "guided" });
  });
});
