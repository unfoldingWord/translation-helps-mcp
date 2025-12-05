/**
 * List Resources by Language Tool
 * Lists available resources organized by language. For each language, shows which resource types (subjects) are available.
 * Automatically fetches all subjects if not provided, then searches the catalog to discover which languages have each resource type.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { proxyFetch } from "../utils/httpClient.js";
import { getKVCache } from "../functions/kv-cache.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import { OrganizationParam } from "../schemas/common-params.js";
import {
  CATALOG_SUBJECTS,
  DEFAULT_DISCOVERY_SUBJECTS,
} from "../constants/subjects.js";

// Input schema
export const ListResourcesByLanguageArgs = z.object({
  subjects: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Comma-separated list or array of subjects to search for (e.g., "Translation Words,Translation Academy"). If not provided, searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.',
    ),
  organization: OrganizationParam.describe(
    "Organization(s) to filter by. Can be a single organization (string), multiple organizations (array), or omitted to search all organizations.",
  ),
  stage: z
    .string()
    .optional()
    .default("prod")
    .describe('Resource stage (default: "prod")'),
  limit: z
    .number()
    .min(1)
    .max(1000)
    .default(100)
    .describe(
      "Maximum number of resources to return per subject (default: 100, max: 1000)",
    ),
  topic: z
    .string()
    .optional()
    .describe(
      'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Topics are metadata tags that indicate resource status or readiness.',
    ),
});

export type ListResourcesByLanguageArgs = z.infer<
  typeof ListResourcesByLanguageArgs
>;

interface ResourceItem {
  name: string;
  subject: string;
  language: string;
  organization: string;
  version?: string;
}

interface LanguageResources {
  language: string;
  languageName?: string;
  subjects: string[];
  resources: ResourceItem[];
  resourceCount: number;
}

/**
 * Parse subjects parameter - handle both string (comma-separated) and array
 */
function parseSubjects(subjects?: string | string[]): string[] {
  if (!subjects) {
    // DEFAULT_DISCOVERY_SUBJECTS is a readonly array, convert to regular array
    return [...DEFAULT_DISCOVERY_SUBJECTS];
  }
  if (typeof subjects === "string") {
    return subjects
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return subjects;
}

/**
 * Search catalog for resources by subject
 */
async function searchResourcesBySubject(
  subject: string,
  organization: string | string[] | undefined,
  stage: string,
  limit: number,
  topic: string | undefined,
  tracer: EdgeXRayTracer,
): Promise<ResourceItem[]> {
  const cache = getKVCache();
  const cacheKey = `resources-by-subject:${subject}:${JSON.stringify(organization)}:${stage}:${limit}:${topic || "all"}`;

  // Try cache first
  if (cache) {
    const cached = (await cache.get(cacheKey)) as string | ArrayBuffer | null;
    if (cached) {
      logger.info(`✅ Cache HIT for ${cacheKey}`);
      try {
        // Handle both string and ArrayBuffer responses
        const dataStr =
          typeof cached === "string"
            ? cached
            : new TextDecoder().decode(cached as ArrayBuffer);
        const parsed = JSON.parse(dataStr);
        // Ensure we return an array, not a string or other type
        if (Array.isArray(parsed)) {
          return parsed;
        }
        logger.warn("Cached data is not an array, fetching fresh", {
          type: typeof parsed,
        });
      } catch (error) {
        logger.warn("Failed to parse cached data, fetching fresh", {
          error: String(error),
        });
      }
    }
    logger.info(`❌ Cache MISS for ${cacheKey}`);
  }

  const resources: ResourceItem[] = [];

  // Handle multiple organizations
  const organizations =
    organization === undefined
      ? [undefined] // Search all orgs
      : typeof organization === "string"
        ? [organization]
        : organization;

  // Search for each organization
  for (const org of organizations) {
    try {
      const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
      searchUrl.searchParams.set("subject", subject);
      searchUrl.searchParams.set("stage", stage);
      searchUrl.searchParams.set("limit", limit.toString());

      if (org) {
        searchUrl.searchParams.set("owner", org);
      }

      if (topic) {
        searchUrl.searchParams.set("topic", topic);
      }

      const searchStart = Date.now();
      const searchResponse = await proxyFetch(searchUrl.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      tracer.addApiCall({
        url: searchUrl.toString(),
        method: "GET",
        duration: Date.now() - searchStart,
        status: searchResponse.status,
        cached: false,
      });

      if (!searchResponse.ok) {
        logger.warn(`Catalog search failed for subject ${subject}`, {
          status: searchResponse.status,
          organization: org || "all",
        });
        continue;
      }

      const searchData = await searchResponse.json();

      // Catalog API returns { ok: true, data: [...], last_updated: "..." } or { data: [...] }
      const items = searchData.data || searchData;
      const itemsArray = Array.isArray(items) ? items : [];

      for (const item of itemsArray) {
        // Extract language from repo name (format: {language}_{resource})
        const repoName = item.name || "";
        const langMatch = repoName.match(/^([^_]+)_/);
        const language = langMatch ? langMatch[1] : "";

        if (language) {
          // Check for duplicates (same name + organization)
          const isDuplicate = resources.some(
            (r) =>
              r.name === item.name &&
              r.organization === (item.owner || org || "unknown"),
          );

          if (!isDuplicate) {
            resources.push({
              name: item.name || "",
              subject: subject,
              language: language,
              organization: item.owner || org || "unknown",
              version:
                item.release?.tag_name || item.default_branch || "master",
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error searching for subject ${subject}`, {
        error: error instanceof Error ? error.message : String(error),
        organization: org || "all",
      });
      // Continue with other organizations
    }
  }

  // Cache results
  if (cache && resources.length > 0) {
    try {
      await cache.set(cacheKey, JSON.stringify(resources), 3600); // 1 hour cache
      logger.info("Resources cached", {
        key: cacheKey,
        count: resources.length,
      });
    } catch (error) {
      logger.warn("Failed to cache resources", {
        error: String(error),
      });
    }
  }

  return resources;
}

/**
 * Get language name from language code (optional enhancement)
 */
async function getLanguageName(
  code: string,
  organization: string | string[] | undefined,
  stage: string,
): Promise<string | undefined> {
  try {
    const languagesUrl = new URL(
      "https://git.door43.org/api/v1/catalog/list/languages",
    );
    languagesUrl.searchParams.set("stage", stage);

    if (organization && typeof organization === "string") {
      languagesUrl.searchParams.set("owner", organization);
    }

    const response = await proxyFetch(languagesUrl.toString());
    if (response.ok) {
      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        const lang = data.data.find(
          (l: any) => l.lc === code || l.code === code,
        );
        return lang?.ln || lang?.name;
      }
    }
  } catch (error) {
    // Silently fail - language name is optional
  }
  return undefined;
}

/**
 * Handle the list resources by language tool call
 */
export async function handleListResourcesByLanguage(
  args: ListResourcesByLanguageArgs,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const startTime = Date.now();
  const tracer = new EdgeXRayTracer("mcp-tool", "list_resources_by_language");

  try {
    // Validate and parse input using Zod schema (ListResourcesByLanguageArgs is the schema)
    const parsedArgs = ListResourcesByLanguageArgs.parse(args);

    const subjects = parseSubjects(parsedArgs.subjects);
    const organization = parsedArgs.organization;
    const stage = parsedArgs.stage || "prod";
    const limit = parsedArgs.limit || 100;
    const topic = parsedArgs.topic;

    logger.info("Listing resources by language", {
      subjectsCount: subjects.length,
      organization: organization || "all",
      stage,
      limit,
      topic: topic || "none",
    });

    // Check aggregated cache first for the complete result
    const cache = getKVCache();
    const aggregatedCacheKey = `resources-by-lang-aggregated:${subjects.join(",")}:${JSON.stringify(organization)}:${stage}:${limit}:${topic || "all"}`;
    const cacheTtl = 3600; // 1 hour

    if (cache) {
      const cached = (await cache.get(aggregatedCacheKey)) as
        | string
        | ArrayBuffer
        | null;
      if (cached) {
        logger.info(`✅ AGGREGATED Cache HIT for ${aggregatedCacheKey}`);
        try {
          const dataStr =
            typeof cached === "string"
              ? cached
              : new TextDecoder().decode(cached as ArrayBuffer);
          const cachedResult = JSON.parse(dataStr);

          // Return cached complete response
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(cachedResult),
              },
            ],
            isError: false,
          };
        } catch (error) {
          logger.warn("Failed to parse aggregated cache, fetching fresh", {
            error: String(error),
          });
        }
      }
      logger.info(`❌ AGGREGATED Cache MISS for ${aggregatedCacheKey}`);
    }

    // Step 1: Search for resources for each subject IN PARALLEL (cache miss - fetch fresh)
    logger.info("Fetching subjects in parallel for faster response");

    const resourcePromises = subjects.map((subject) =>
      searchResourcesBySubject(
        subject,
        organization,
        stage,
        limit,
        topic,
        tracer,
      ).catch((error) => {
        logger.error(`Failed to fetch subject ${subject}`, {
          error: String(error),
        });
        return []; // Return empty array on error to continue with other subjects
      }),
    );

    const resourceArrays = await Promise.all(resourcePromises);

    // Flatten and validate all results
    const allResources: ResourceItem[] = [];
    resourceArrays.forEach((resources, index) => {
      // Validate that resources is an array before spreading
      if (Array.isArray(resources)) {
        allResources.push(...resources);
      } else {
        logger.warn("searchResourcesBySubject did not return an array", {
          subject: subjects[index],
          type: typeof resources,
          isString: typeof resources === "string",
        });
      }
    });

    // Step 2: Organize resources by language
    const resourcesByLanguage = new Map<string, LanguageResources>();

    for (const resource of allResources) {
      if (!resourcesByLanguage.has(resource.language)) {
        resourcesByLanguage.set(resource.language, {
          language: resource.language,
          subjects: [],
          resources: [],
          resourceCount: 0,
        });
      }

      const langData = resourcesByLanguage.get(resource.language)!;

      // Add subject if not already present
      if (!langData.subjects.includes(resource.subject)) {
        langData.subjects.push(resource.subject);
      }

      // Add resource
      langData.resources.push(resource);
      langData.resourceCount = langData.resources.length;
    }

    // Step 3: Optionally enrich with language names (in parallel, but don't block)
    const languageEntries = Array.from(resourcesByLanguage.values());
    const languageNamePromises = languageEntries.map(async (entry) => {
      const name = await getLanguageName(entry.language, organization, stage);
      if (name) {
        entry.languageName = name;
      }
    });
    await Promise.all(languageNamePromises);

    // Step 4: Sort languages alphabetically
    const sortedLanguages = Array.from(resourcesByLanguage.values()).sort(
      (a, b) => a.language.localeCompare(b.language),
    );

    // Step 5: Build summary
    const summary = {
      totalLanguages: sortedLanguages.length,
      totalResources: allResources.length,
      subjectsSearched: subjects,
      organization: organization || "all",
      stage,
    };

    // Build metadata with X-Ray trace
    const xrayTrace = tracer.getTrace();
    const metadata = buildMetadata({
      startTime,
      data: { resourcesByLanguage: sortedLanguages, summary },
      serviceMetadata: {
        xrayTrace,
      },
      additionalFields: {
        languagesFound: sortedLanguages.length,
        resourcesFound: allResources.length,
        subjectsSearched: subjects.length,
      },
    });

    const result = {
      resourcesByLanguage: sortedLanguages,
      summary,
      metadata,
    };

    logger.info("Resources by language listed successfully", {
      languagesFound: sortedLanguages.length,
      resourcesFound: allResources.length,
      subjectsSearched: subjects.length,
      responseTime: metadata.responseTime,
    });

    // Cache the complete aggregated result for fast subsequent requests
    if (cache) {
      try {
        await cache.set(aggregatedCacheKey, JSON.stringify(result), cacheTtl);
        logger.info("✅ Aggregated result cached", {
          key: aggregatedCacheKey,
          languages: sortedLanguages.length,
          resources: allResources.length,
        });
      } catch (error) {
        logger.warn("Failed to cache aggregated result", {
          error: String(error),
        });
      }
    }

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
      toolName: "list_resources_by_language",
      args: {
        subjects: args.subjects,
        organization: args.organization,
        stage: args.stage,
        limit: args.limit,
      },
      startTime,
      originalError: error,
    });
  }
}
