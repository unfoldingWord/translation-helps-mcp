/**
 * List Languages Tool
 * Tool for listing available languages from Door43 catalog using the efficient /catalog/list/languages endpoint
 * Returns structured data that can be directly reused as language parameters in other tools
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { proxyFetch } from "../utils/httpClient.js";
import { mapLanguageToCatalogCode } from "../utils/language-mapping.js";
import { getKVCache } from "../functions/kv-cache.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import { OrganizationParam } from "../schemas/common-params.js";

// Input schema - using common parameters where applicable
export const ListLanguagesArgs = z.object({
  organization: OrganizationParam.describe(
    'Filter languages by organization(s). Can be a single organization (string), multiple organizations (array), or omitted to return all languages from all organizations.',
  ),
  stage: z
    .string()
    .optional()
    .default("prod")
    .describe('Resource stage (default: "prod")'),
});

export type ListLanguagesArgs = z.infer<typeof ListLanguagesArgs>;

interface LanguageItem {
  code: string; // e.g., "en", "es-419"
  name: string; // e.g., "English", "Spanish"
  displayName?: string; // Full display name
  romanizedName?: string; // Anglicized/romanized name
  direction?: string; // "ltr" or "rtl"
  region?: string;
  homeCountry?: string;
  countryCodes?: string[];
  alternativeNames?: string[];
  isStrategicLanguage?: boolean;
}

/**
 * Handle the list languages tool call
 */
export async function handleListLanguages(
  args: ListLanguagesArgs,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const startTime = Date.now();
  const tracer = new EdgeXRayTracer("mcp-tool", "list_languages");

  try {
    logger.info("Listing available languages", {
      organization: args.organization,
      stage: args.stage,
    });

    // Build catalog URL - handle multiple organizations
    const baseUrl = "https://git.door43.org/api/v1/catalog/list/languages";
    const url = new URL(baseUrl);
    url.searchParams.append("stage", args.stage || "prod");
    
    // Handle organization: undefined = all orgs, string = single org, array = multiple orgs
    if (args.organization) {
      if (typeof args.organization === 'string') {
        url.searchParams.append("owner", args.organization);
      } else if (Array.isArray(args.organization)) {
        // For multiple orgs, we'll need to make parallel calls and merge
        // For now, use the first org (will be enhanced later)
        url.searchParams.append("owner", args.organization[0]);
      }
    }

    logger.debug("Fetching languages from catalog", { url: url.toString() });

    // Cache the external API call (not the response)
    const catalogUrl = url.toString();
    const catalogCacheKey = catalogUrl; // Use exact URL as cache key
    const kvCache = getKVCache();
    const cacheTtl = 3600; // 1 hour for languages (matches unified cache TTL)

    // Check cache first
    let cachedData: string | ArrayBuffer | null = null;
    const cacheStart = Date.now();
    try {
      cachedData = (await kvCache.get(catalogCacheKey)) as
        | string
        | ArrayBuffer
        | null;
    } catch (error) {
      logger.debug("Cache get error (continuing with fresh fetch)", {
        error: String(error),
      });
    }
    
    const cacheDuration = Date.now() - cacheStart;

    let data: {
      data?: Array<{
        lc?: string;
        ln?: string;
        ang?: string;
        ld?: string;
        lr?: string;
        hc?: string;
        cc?: string[];
        alt?: string[];
        gw?: boolean;
      }>;
    };

    if (cachedData) {
      try {
        const json =
          typeof cachedData === "string"
            ? cachedData
            : new TextDecoder().decode(cachedData as ArrayBuffer);
        data = JSON.parse(json);
        logger.info("Languages cache HIT", { key: catalogCacheKey });
        
        // Track cache hit in X-Ray
        const cacheSource = cacheDuration < 5 ? "memory" : "kv";
        tracer.addApiCall({
          url: `internal://${cacheSource}/catalog/list/languages`,
          duration: cacheDuration,
          status: 200,
          size: json.length,
          cached: true,
        });
      } catch (error) {
        logger.warn("Failed to parse cached data, fetching fresh", {
          error: String(error),
        });
        cachedData = null; // Treat as cache miss
      }
    }

    // Fetch fresh if cache miss
    if (!cachedData) {
      const response = await proxyFetch(catalogUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch languages from catalog: ${response.status} ${response.statusText}`,
        );
      }

      const responseText = await response.text();
      data = JSON.parse(responseText) as {
        data?: Array<{
          lc?: string; // language code
          ln?: string; // local name
          ang?: string; // anglicized name
          ld?: string; // language direction
          lr?: string; // language region
          hc?: string; // home country
          cc?: string[]; // country codes
          alt?: string[]; // alternative names
          gw?: boolean; // is strategic language
        }>;
      };

      // Cache the raw API response (not the processed response)
      if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
        try {
          await kvCache.set(catalogCacheKey, responseText, cacheTtl);
          logger.info("Languages cached", {
            key: catalogCacheKey,
            ttl: cacheTtl,
          });
        } catch (error) {
          logger.warn("Failed to cache languages data", {
            error: String(error),
          });
        }
      }
    }

    // Parse the response structure
    const languageData = data?.data || [];
    const languages: LanguageItem[] = [];

    for (const lang of languageData) {
      if (lang.lc) {
        // Map language code to catalog code (e.g., es -> es-419)
        const catalogCode = mapLanguageToCatalogCode(lang.lc);

        languages.push({
          code: catalogCode,
          name: lang.ln || lang.ang || lang.lc,
          displayName: lang.ln || lang.ang || lang.lc,
          romanizedName: lang.ang,
          direction: lang.ld || "ltr",
          region: lang.lr,
          homeCountry: lang.hc,
          countryCodes: lang.cc,
          alternativeNames: lang.alt,
          isStrategicLanguage: lang.gw || false,
        });
      }
    }

    // Sort languages by name for consistent ordering
    languages.sort((a, b) => a.name.localeCompare(b.name));

    // Build metadata with X-Ray trace
    const xrayTrace = tracer.getTrace();
    const metadata = buildMetadata({
      startTime,
      data: languages,
      serviceMetadata: {
        xrayTrace, // Include X-Ray trace in metadata
      },
      additionalFields: {
        count: languages.length,
        organization: args.organization || "all",
      },
    });

    const result = {
      languages,
      organization: args.organization || "all",
      metadata,
    };

    logger.info("Languages listed successfully", {
      count: languages.length,
      organization: args.organization || "all",
      responseTime: metadata.responseTime,
    });

    // Return in MCP format
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return handleMCPError({
      toolName: "list_languages",
      args: {
        organization: args.organization,
        stage: args.stage,
      },
      startTime,
      originalError: error,
    });
  }
}

