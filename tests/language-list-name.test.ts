import { describe, expect, it } from "vitest";
import { languageListName } from "../src/utils/language-mapping.js";

describe("languageListName", () => {
  it("uses the English catalog name for Bengali and Hindi", () => {
    expect(languageListName("বাংলা", "Bengali, Bangla", "bn")).toBe(
      "Bengali, Bangla",
    );
    expect(languageListName("हिन्दी, हिंदी", "Hindi", "hi")).toBe("Hindi");
  });

  it("keeps an English name that is already the local name", () => {
    expect(languageListName("English", "English", "en")).toBe("English");
  });

  it("falls back to the native name, then the code, when ang is missing", () => {
    expect(languageListName("Français", undefined, "fr")).toBe("Français");
    expect(languageListName(undefined, "  ", "und")).toBe("und");
    expect(languageListName(undefined, undefined, "und")).toBe("und");
  });
});
