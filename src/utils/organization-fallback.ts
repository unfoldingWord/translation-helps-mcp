/**
 * Helpers for “pinned organization” vs catalog-wide search.
 * Used when a caller specifies `owner` but that org has no matching resources.
 */

export interface OrganizationFallbackInfo {
  /** Door43 owner that was requested */
  requestedOrganization: string;
  /** Human-readable explanation for LLMs and UIs */
  note: string;
}

const FALLBACK_NOTE =
  "No resources matched the requested organization in the Door43 catalog for this language and topic. These results were fetched without an organization filter (all matching owners). Prefer citing the per-resource `citation.organization` values.";

/**
 * True when the caller pinned a single Door43 owner (not “all orgs”).
 * Multi-org arrays are excluded — fallback semantics are caller-specific.
 */
export function isPinnedSingleOrganization(
  organization: string | string[] | undefined,
): boolean {
  if (organization === undefined || organization === null) return false;
  if (typeof organization === "string") {
    return organization !== "" && organization !== "all";
  }
  if (Array.isArray(organization)) {
    if (organization.length !== 1) return false;
    const o = organization[0];
    return typeof o === "string" && o !== "" && o !== "all";
  }
  return false;
}

/**
 * Returns the single pinned org string, or undefined.
 */
export function getPinnedOrganizationValue(
  organization: string | string[] | undefined,
): string | undefined {
  if (
    typeof organization === "string" &&
    organization !== "" &&
    organization !== "all"
  ) {
    return organization;
  }
  if (
    Array.isArray(organization) &&
    organization.length === 1 &&
    typeof organization[0] === "string" &&
    organization[0] !== "" &&
    organization[0] !== "all"
  ) {
    return organization[0];
  }
  return undefined;
}

export function makeOrganizationFallbackInfo(
  requestedOrganization: string,
): OrganizationFallbackInfo {
  return {
    requestedOrganization,
    note: FALLBACK_NOTE,
  };
}
