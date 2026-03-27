import { describe, expect, it } from "vitest";
import {
  getPinnedOrganizationValue,
  isPinnedSingleOrganization,
  makeOrganizationFallbackInfo,
} from "../src/utils/organization-fallback.js";

describe("organization fallback helpers", () => {
  it("isPinnedSingleOrganization is false for all-org / unset", () => {
    expect(isPinnedSingleOrganization(undefined)).toBe(false);
    expect(isPinnedSingleOrganization("")).toBe(false);
    expect(isPinnedSingleOrganization("all")).toBe(false);
  });

  it("isPinnedSingleOrganization is true for a concrete owner", () => {
    expect(isPinnedSingleOrganization("unfoldingWord")).toBe(true);
    expect(isPinnedSingleOrganization("es-419_gl")).toBe(true);
  });

  it("single-element array counts as pinned", () => {
    expect(isPinnedSingleOrganization(["unfoldingWord"])).toBe(true);
    expect(getPinnedOrganizationValue(["unfoldingWord"])).toBe("unfoldingWord");
  });

  it("multi-org array is not auto-pinned", () => {
    expect(isPinnedSingleOrganization(["a", "b"])).toBe(false);
  });

  it("makeOrganizationFallbackInfo includes requested name and note", () => {
    const info = makeOrganizationFallbackInfo("foo-org");
    expect(info.requestedOrganization).toBe("foo-org");
    expect(info.note.length).toBeGreaterThan(20);
  });
});
