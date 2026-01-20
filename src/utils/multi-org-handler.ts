/**
 * Multi-Organization Handler Utility
 * Handles API calls with single organization, multiple organizations, or all organizations
 */

import { logger } from "./logger.js";

/**
 * Handle multiple organizations by making parallel API calls and merging results
 *
 * @param organizations - Single org (string), multiple orgs (array), or undefined (all orgs)
 * @param apiCall - Function that makes API call with organization parameter
 * @param mergeResults - Function to merge results from multiple calls
 * @returns Merged results
 */
export async function handleMultipleOrganizations<T>(
  organizations: string | string[] | undefined,
  apiCall: (org: string | undefined) => Promise<T>,
  mergeResults: (results: T[]) => T,
): Promise<T> {
  // If undefined, search all organizations (single call without owner param)
  if (organizations === undefined) {
    return apiCall(undefined);
  }

  // If single string, make single call
  if (typeof organizations === "string") {
    return apiCall(organizations);
  }

  // If array, make parallel calls and merge
  logger.info(
    `Making parallel API calls for ${organizations.length} organizations`,
    {
      organizations,
    },
  );

  const results = await Promise.all(organizations.map((org) => apiCall(org)));

  return mergeResults(results);
}

/**
 * Build catalog search URL with organization handling
 * Supports single org, multiple orgs (parallel calls needed), or all orgs (no owner param)
 */
export function buildCatalogSearchUrl(
  baseUrl: string,
  params: {
    lang?: string;
    organization?: string | string[] | undefined;
    subject?: string | string[];
    stage?: string;
    metadataType?: string;
    includeMetadata?: boolean;
    type?: string;
    [key: string]: any;
  },
): string | string[] {
  const url = new URL(baseUrl);

  // Add standard params
  if (params.lang) url.searchParams.append("lang", params.lang);
  if (params.stage) url.searchParams.append("stage", params.stage);
  if (params.metadataType)
    url.searchParams.append("metadataType", params.metadataType);
  if (params.includeMetadata)
    url.searchParams.append("includeMetadata", String(params.includeMetadata));
  if (params.type) url.searchParams.append("type", params.type);

  // Handle subject (can be string or array - join with comma)
  if (params.subject) {
    const subjects = Array.isArray(params.subject)
      ? params.subject.join(",")
      : params.subject;
    url.searchParams.append("subject", subjects);
  }

  // Handle organization
  if (params.organization === undefined) {
    // No owner param - searches all organizations
    return url.toString();
  } else if (typeof params.organization === "string") {
    // Single organization
    url.searchParams.append("owner", params.organization);
    return url.toString();
  } else {
    // Multiple organizations - return array of URLs (one per org)
    return params.organization.map((org) => {
      const orgUrl = new URL(url);
      orgUrl.searchParams.append("owner", org);
      return orgUrl.toString();
    });
  }
}

/**
 * Merge catalog search results from multiple organizations
 * Removes duplicates based on resource name/identifier
 */
export function mergeCatalogResults<
  T extends { name?: string; identifier?: string; owner?: string },
>(results: Array<{ data?: T[] }>): { data: T[] } {
  const allResources = new Map<string, T>();

  for (const result of results) {
    if (result.data && Array.isArray(result.data)) {
      for (const resource of result.data) {
        // Use name or identifier as unique key
        const key =
          resource.name || resource.identifier || JSON.stringify(resource);
        if (!allResources.has(key)) {
          allResources.set(key, resource);
        } else {
          // If duplicate, prefer the one with more complete data
          const existing = allResources.get(key)!;
          if (resource.owner && !existing.owner) {
            allResources.set(key, resource);
          }
        }
      }
    }
  }

  return {
    data: Array.from(allResources.values()),
  };
}

/**
 * Parse organization parameter from query string
 * Supports both single value and multiple values (array)
 * Examples:
 *   ?organization=unfoldingWord
 *   ?organization=unfoldingWord&organization=es-419_gl
 */
export function parseOrganizationParam(
  searchParams: URLSearchParams,
): string | string[] | undefined {
  const orgValues = searchParams.getAll("organization");

  if (orgValues.length === 0) {
    return undefined; // No organization specified - search all
  } else if (orgValues.length === 1) {
    return orgValues[0]; // Single organization
  } else {
    return orgValues; // Multiple organizations
  }
}
