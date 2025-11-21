/**
 * Language-Organization Discovery Service (UI)
 * Client-side service to discover available language-organization combinations
 */

import { mapLanguageToCatalogCode } from './languageMapping.js';

export interface LanguageOrgOption {
  language: string; // e.g., "en", "es-419"
  displayName?: string; // e.g., "English", "Spanish (Latin America)"
  organizations: string[]; // e.g., ["unfoldingWord", "Door43-Catalog"]
}

export interface LanguageOrgDiscoveryResult {
  options: LanguageOrgOption[];
  metadata: {
    responseTime: number;
    timestamp: string;
    totalLanguages: number;
    totalOrganizations: number;
  };
}

// Cache for discovery results
let cachedResult: LanguageOrgDiscoveryResult | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Discover all available language-organization combinations
 * Uses server endpoint if available, otherwise queries catalog directly
 */
export async function discoverLanguageOrgs(
  useCache: boolean = true,
): Promise<LanguageOrgDiscoveryResult> {
  // Check cache first
  if (useCache && cachedResult && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedResult;
  }

  try {
    // Try server endpoint first (if it exists)
    try {
      const response = await fetch("/api/discover-language-orgs");
      if (response.ok) {
        const data = await response.json();
        cachedResult = data;
        cacheTimestamp = Date.now();
        return data;
      }
    } catch (error) {
      // Endpoint doesn't exist yet, fall through to direct catalog query
      console.debug("Discovery endpoint not available, using direct query");
    }

    // Fallback: Query catalog directly
    const catalogUrl =
      "https://git.door43.org/api/v1/catalog/search?stage=prod&metadataType=rc&limit=1000";

    const catalogResponse = await fetch(catalogUrl);
    if (!catalogResponse.ok) {
      throw new Error(
        `Failed to query catalog: ${catalogResponse.status}`,
      );
    }

    const catalogData = (await catalogResponse.json()) as {
      data?: Array<{
        name: string;
        title?: string;
        language?: string;
        owner?: string;
        lang?: string;
      }>;
    };

    if (!catalogData.data || catalogData.data.length === 0) {
      throw new Error("No resources found in catalog");
    }

    // Map to track language -> organizations
    const languageMap = new Map<
      string,
      { organizations: Set<string>; displayName?: string }
    >();

    // Extract unique language-organization combinations
    for (const resource of catalogData.data) {
      // Get language code - try multiple fields
      const langCode =
        resource.language ||
        resource.lang ||
        (resource.name.match(/^([a-z]{2,3}(?:-[A-Z][a-z]{3})?)/i)?.[1]?.toLowerCase());

      if (!langCode) continue;

      // Map to catalog code (e.g., es -> es-419)
      const catalogLangCode = mapLanguageToCatalogCode(langCode);

      // Get organization/owner
      const org = resource.owner;
      if (!org) continue;

      // Initialize language entry if not exists (use catalog code)
      if (!languageMap.has(catalogLangCode)) {
        // Try to extract display name from resource title
        let displayName: string | undefined;
        if (resource.title) {
          // Common patterns: "English ULT", "Spanish (Latin America) GLT"
          const titleMatch = resource.title.match(/^([^®(]+)/);
          if (titleMatch) {
            displayName = titleMatch[1].trim();
            // Remove resource type suffixes (ULT, UST, etc.)
            displayName = displayName.replace(
              /\s+(ULT|UST|GLT|GST|TN|TW|TQ|TA|TWL)$/i,
              "",
            );
          }
        }

        languageMap.set(catalogLangCode, {
          organizations: new Set(),
          displayName,
        });
      }

      // Add organization to language's set (use catalog code)
      languageMap.get(catalogLangCode)!.organizations.add(org);
    }

    // Convert to result format
    const options: LanguageOrgOption[] = Array.from(
      languageMap.entries(),
    ).map(([language, data]) => ({
      language,
      displayName: data.displayName,
      organizations: Array.from(data.organizations).sort(),
    }));

    // Sort by language code
    options.sort((a, b) => a.language.localeCompare(b.language));

    // Calculate totals
    const allOrgs = new Set<string>();
    options.forEach((opt) => {
      opt.organizations.forEach((org) => allOrgs.add(org));
    });

    const result: LanguageOrgDiscoveryResult = {
      options,
      metadata: {
        responseTime: 0, // Client-side doesn't track this
        timestamp: new Date().toISOString(),
        totalLanguages: options.length,
        totalOrganizations: allOrgs.size,
      },
    };

    // Cache result
    cachedResult = result;
    cacheTimestamp = Date.now();

    return result;
  } catch (error) {
    console.error("Failed to discover language-org combinations", error);
    throw error;
  }
}

/**
 * Get organizations for a specific language
 */
export function getOrganizationsForLanguage(
  discoveryResult: LanguageOrgDiscoveryResult,
  language: string,
): string[] {
  const option = discoveryResult.options.find(
    (opt) => opt.language === language,
  );
  return option?.organizations || [];
}

/**
 * Get display name for a language
 */
export function getLanguageDisplayName(
  discoveryResult: LanguageOrgDiscoveryResult,
  language: string,
): string {
  const option = discoveryResult.options.find(
    (opt) => opt.language === language,
  );
  return option?.displayName || language.toUpperCase();
}

