/**
 * Language-Organization Discovery Service
 * Discovers available language-organization combinations from Door43 catalog
 */

import { logger } from "../utils/logger.js";
import { proxyFetch } from "../utils/httpClient.js";
import { mapLanguageToCatalogCode } from "../utils/language-mapping.js";

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

/**
 * Discover all available language-organization combinations from Door43 catalog
 */
export async function discoverLanguageOrgs(): Promise<LanguageOrgDiscoveryResult> {
  const startTime = Date.now();

  logger.info("Discovering language-organization combinations");

  try {
    // Query catalog for all production resources
    // Use a broad search to get all resources, then extract unique combinations
    const catalogUrl =
      "https://git.door43.org/api/v1/catalog/search?stage=prod&metadataType=rc&limit=1000";
    logger.debug("Querying catalog", { catalogUrl });

    const catalogResponse = await proxyFetch(catalogUrl);
    if (!catalogResponse.ok) {
      logger.error("Catalog search failed", {
        status: catalogResponse.status,
      });
      throw new Error(`Failed to search catalog: ${catalogResponse.status}`);
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

    logger.debug("Catalog resources found", {
      count: catalogData.data?.length || 0,
    });

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
        resource.name
          .match(/^([a-z]{2,3}(?:-[A-Z][a-z]{3})?)/i)?.[1]
          ?.toLowerCase();

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
    const options: LanguageOrgOption[] = Array.from(languageMap.entries()).map(
      ([language, data]) => ({
        language,
        displayName: data.displayName,
        organizations: Array.from(data.organizations).sort(),
      }),
    );

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
        responseTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        totalLanguages: options.length,
        totalOrganizations: allOrgs.size,
      },
    };

    logger.info("Language-organization discovery complete", {
      languages: result.metadata.totalLanguages,
      organizations: result.metadata.totalOrganizations,
    });

    return result;
  } catch (error) {
    logger.error("Failed to discover language-org combinations", {
      error: String(error),
    });
    throw error;
  }
}
