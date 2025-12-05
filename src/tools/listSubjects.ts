/**
 * List Subjects Tool
 * Tool for listing available resource subjects from Door43 catalog using the efficient /catalog/list/subjects endpoint
 * Returns structured data that can be used to discover what resource types are available
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { proxyFetch } from "../utils/httpClient.js";
import { mapLanguageToCatalogCode } from "../utils/language-mapping.js";
import { getKVCache } from "../functions/kv-cache.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import { LanguageParam, OrganizationParam } from "../schemas/common-params.js";

// Input schema - using common parameters where applicable
export const ListSubjectsArgs = z.object({
  language: LanguageParam.describe(
    'Filter subjects by language code (e.g., "en", "es-419"). If not provided, returns all subjects.',
  ),
  organization: OrganizationParam.describe(
    "Filter subjects by organization(s). Can be a single organization (string), multiple organizations (array), or omitted to return all subjects from all organizations.",
  ),
  stage: z
    .string()
    .optional()
    .default("prod")
    .describe('Resource stage (default: "prod")'),
});

export type ListSubjectsArgs = z.infer<typeof ListSubjectsArgs>;

interface SubjectItem {
  name: string; // e.g., "Translation Words", "TSV Translation Notes"
  description?: string;
  resourceType?: string; // e.g., "tw", "tn", "tq", "ult", "ust"
  count?: number; // Number of resources with this subject (if available)
}

/**
 * Map subject names to resource type abbreviations
 */
function mapSubjectToResourceType(subject: string): string | undefined {
  const subjectLower = subject.toLowerCase();
  if (
    subjectLower.includes("translation words") ||
    subjectLower.includes("tw")
  ) {
    return "tw";
  }
  if (
    subjectLower.includes("translation notes") ||
    subjectLower.includes("tn")
  ) {
    return "tn";
  }
  if (
    subjectLower.includes("translation questions") ||
    subjectLower.includes("tq")
  ) {
    return "tq";
  }
  if (
    subjectLower.includes("translation word links") ||
    subjectLower.includes("twl")
  ) {
    return "twl";
  }
  if (subjectLower.includes("aligned bible") || subjectLower.includes("ult")) {
    return "ult";
  }
  if (subjectLower.includes("simplified") || subjectLower.includes("ust")) {
    return "ust";
  }
  if (subjectLower.includes("bible") && !subjectLower.includes("aligned")) {
    return "scripture";
  }
  if (
    subjectLower.includes("translation academy") ||
    subjectLower.includes("ta")
  ) {
    return "ta";
  }
  return undefined;
}

/**
 * Handle the list subjects tool call
 */
export async function handleListSubjects(args: ListSubjectsArgs): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const startTime = Date.now();
  const tracer = new EdgeXRayTracer("mcp-tool", "list_subjects");

  try {
    logger.info("Listing available subjects", {
      language: args.language,
      organization: args.organization,
      stage: args.stage,
    });

    // Build catalog URL
    const baseUrl = "https://git.door43.org/api/v1/catalog/list/subjects";
    const url = new URL(baseUrl);
    url.searchParams.append("stage", args.stage || "prod");
    if (args.language) {
      // Map language to catalog code
      const catalogLanguage = mapLanguageToCatalogCode(args.language);
      url.searchParams.append("lang", catalogLanguage);
    }
    // Handle organization: undefined = all orgs, string = single org, array = multiple orgs
    if (args.organization) {
      if (typeof args.organization === "string") {
        url.searchParams.append("owner", args.organization);
      } else if (Array.isArray(args.organization)) {
        // For multiple orgs, we'll need to make parallel calls and merge
        // For now, use the first org (will be enhanced later)
        url.searchParams.append("owner", args.organization[0]);
      }
    }

    logger.debug("Fetching subjects from catalog", { url: url.toString() });

    // Cache the external API call (not the response)
    const catalogUrl = url.toString();
    const catalogCacheKey = catalogUrl; // Use exact URL as cache key
    const kvCache = getKVCache();
    const cacheTtl = 900; // 15 minutes for metadata (matches unified cache TTL)

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
        name?: string;
        description?: string;
        count?: number;
      }>;
    } | null = null;

    if (cachedData) {
      try {
        const json =
          typeof cachedData === "string"
            ? cachedData
            : new TextDecoder().decode(cachedData as ArrayBuffer);
        data = JSON.parse(json);
        logger.info("Subjects cache HIT", { key: catalogCacheKey });

        // Track cache hit in X-Ray
        const cacheSource = cacheDuration < 5 ? "memory" : "kv";
        tracer.addApiCall({
          url: `internal://${cacheSource}/catalog/list/subjects`,
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
        data = null;
      }
    }

    // Fetch fresh if cache miss
    if (!cachedData || !data) {
      const fetchStart = Date.now();
      const response = await proxyFetch(catalogUrl);
      const fetchDuration = Date.now() - fetchStart;

      if (!response.ok) {
        // Track failed API call
        tracer.addApiCall({
          url: catalogUrl,
          duration: fetchDuration,
          status: response.status,
          size: 0,
          cached: false,
        });
        throw new Error(
          `Failed to fetch subjects from catalog: ${response.status} ${response.statusText}`,
        );
      }

      const responseText = await response.text();
      data = JSON.parse(responseText) as {
        data?: Array<{
          name?: string;
          description?: string;
          count?: number;
        }>;
      };

      // Track external API call in X-Ray
      tracer.addApiCall({
        url: catalogUrl,
        duration: fetchDuration,
        status: response.status,
        size: responseText.length,
        cached: false,
      });

      // Cache the raw API response (not the processed response)
      if (
        data &&
        data.data &&
        Array.isArray(data.data) &&
        data.data.length > 0
      ) {
        try {
          await kvCache.set(catalogCacheKey, responseText, cacheTtl);
          logger.info("Subjects cached", {
            key: catalogCacheKey,
            ttl: cacheTtl,
          });
        } catch (error) {
          logger.warn("Failed to cache subjects data", {
            error: String(error),
          });
        }
      }
    }

    // Parse the response structure
    const subjectData = data.data || [];
    const subjects: SubjectItem[] = [];

    for (const subject of subjectData) {
      if (subject.name) {
        const resourceType = mapSubjectToResourceType(subject.name);
        subjects.push({
          name: subject.name,
          description: subject.description,
          resourceType,
          count: subject.count,
        });
      }
    }

    // Sort subjects by name for consistent ordering
    subjects.sort((a, b) => a.name.localeCompare(b.name));

    // Build metadata with X-Ray trace
    const xrayTrace = tracer.getTrace();
    const metadata = buildMetadata({
      startTime,
      data: subjects,
      serviceMetadata: {
        xrayTrace, // Include X-Ray trace in metadata
      },
      additionalFields: {
        count: subjects.length,
        filters: {
          language: args.language || "all",
          organization: args.organization || "all",
        },
      },
    });

    const result = {
      subjects,
      filters: {
        language: args.language || "all",
        organization: args.organization || "all",
      },
      metadata,
    };

    logger.info("Subjects listed successfully", {
      count: subjects.length,
      language: args.language || "all",
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
    const errorResult = handleMCPError({
      toolName: "list_subjects",
      args: {
        language: args.language,
        organization: args.organization,
        stage: args.stage,
      },
      startTime,
      originalError: error,
    });
    return {
      content: errorResult.content || [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Unknown error" }),
        },
      ],
      isError: errorResult.isError ?? true,
    };
  }
}
