/**
 * List Resources for a Specific Language Tool
 * Given a language code, lists all available resources for that language.
 * This is the recommended workflow: first list_languages, then list_resources_for_language, then fetch specific resources.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { proxyFetch } from "../utils/httpClient.js";
import { getKVCache } from "../functions/kv-cache.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import { OrganizationParam } from "../schemas/common-params.js";
import { DEFAULT_DISCOVERY_SUBJECTS } from "../constants/subjects.js";

// Input schema
export const ListResourcesForLanguageArgs = z.object({
  language: z
    .string()
    .min(2)
    .describe('Language code (e.g., "en", "es", "fr", "es-419"). Required.'),
  organization: OrganizationParam.describe(
    "Organization(s) to filter by. Can be a single organization (string), multiple organizations (array), or omitted to search all organizations.",
  ),
  stage: z
    .string()
    .default("prod")
    .describe('Resource stage (default: "prod")'),
  subject: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Comma-separated list or array of subjects to search for (e.g., "Bible", "Translation Words,Translation Academy"). If not provided, searches 7 default subjects: Bible, Aligned Bible, Translation Words, Translation Academy, TSV Translation Notes, TSV Translation Questions, and TSV Translation Words Links.',
    ),
  limit: z
    .number()
    .min(1)
    .max(10000)
    .optional()
    .describe(
      "Maximum number of resources to return per request. If not specified, fetches all available resources (up to 10000).",
    ),
  topic: z
    .string()
    .optional()
    .default("tc-ready")
    .describe(
      'Filter by topic tag (e.g., "tc-ready" for translationCore-ready resources). Defaults to "tc-ready". Topics are metadata tags that indicate resource status or readiness.',
    ),
});

export type ListResourcesForLanguageArgs = z.infer<
  typeof ListResourcesForLanguageArgs
>;

interface ResourceItem {
  name: string;
  subject: string;
  organization: string;
  version?: string;
  url?: string;
}

interface ResourcesBySubject {
  [subject: string]: ResourceItem[];
}

/**
 * Handle the list resources for language tool call
 */
export async function handleListResourcesForLanguage(
  args: ListResourcesForLanguageArgs,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}> {
  const startTime = Date.now();
  const tracer = new EdgeXRayTracer("mcp-tool", "list_resources_for_language");

  try {
    // Validate and parse input
    const parsedArgs = ListResourcesForLanguageArgs.parse(args);

    const { language, organization, stage, subject, topic } = parsedArgs;
    // Use high limit if not specified to get all available resources
    const limit = parsedArgs.limit || 5000;

    // Parse subjects parameter - handle both string (comma-separated) and array
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

    const subjectsToSearch = parseSubjects(subject);

    logger.info("Listing resources for language", {
      language,
      organization: organization || "all",
      stage,
      subject: subject
        ? typeof subject === "string"
          ? subject
          : subject.join(",")
        : `default (${DEFAULT_DISCOVERY_SUBJECTS.length} subjects)`,
      subjectsCount: subjectsToSearch.length,
      limit,
      topic: topic || "tc-ready",
    });

    // Build cache key
    const kvCache = getKVCache();
    // Use "default" in cache key when using default subjects, otherwise use the specific subjects
    // Sort subjects for consistent cache keys
    const subjectKey = subject
      ? typeof subject === "string"
        ? subject
            .split(",")
            .map((s) => s.trim())
            .sort()
            .join(",")
        : [...subject].sort().join(",")
      : `default-${DEFAULT_DISCOVERY_SUBJECTS.join(",")}`;
    const cacheKey = `resources-for-lang:${language}:${JSON.stringify(organization)}:${stage}:${subjectKey}:${limit}:${topic || "tc-ready"}`;
    const cacheTtl = 3600; // 1 hour

    // Check cache
    let cachedData: string | ArrayBuffer | null = null;
    const cacheStart = Date.now();
    try {
      cachedData = (await kvCache.get(cacheKey)) as string | ArrayBuffer | null;
    } catch (error) {
      logger.debug("Cache get error (continuing with fresh fetch)", {
        error: String(error),
      });
    }
    const cacheDuration = Date.now() - cacheStart;

    let resources: ResourceItem[] = [];

    // Try to use cached data
    if (cachedData) {
      try {
        const dataStr =
          typeof cachedData === "string"
            ? cachedData
            : new TextDecoder().decode(cachedData);
        resources = JSON.parse(dataStr);

        logger.info(`✅ KV HIT for ${cacheKey} in ${cacheDuration}ms`);
        tracer.addCacheHit("resources-for-language", cacheKey);
      } catch (parseError) {
        logger.warn("Failed to parse cached data", {
          error: String(parseError),
        });
        cachedData = null;
      }
    } else {
      logger.info(`❌ KV MISS for ${cacheKey} in ${cacheDuration}ms`);
    }

    // Fetch fresh data if no cache hit
    if (!cachedData || resources.length === 0) {
      // subjectsToSearch is already parsed above

      // Handle organizations
      const organizations =
        organization === undefined
          ? [undefined]
          : typeof organization === "string"
            ? [organization]
            : organization;

      // Search for each subject
      for (const subjectToSearch of subjectsToSearch) {
        for (const org of organizations) {
          // Build search URL for this subject
          const searchUrl = new URL(
            "https://git.door43.org/api/v1/catalog/search",
          );
          searchUrl.searchParams.set("lang", language);
          searchUrl.searchParams.set("stage", stage);
          searchUrl.searchParams.set("limit", limit.toString());
          searchUrl.searchParams.set("subject", subjectToSearch);

          if (org) {
            searchUrl.searchParams.set("owner", org);
          }

          // topic defaults to "tc-ready" per schema, so always set it
          searchUrl.searchParams.set("topic", topic || "tc-ready");

          try {
            const fetchStart = Date.now();
            const response = await proxyFetch(searchUrl.toString(), {
              headers: { Accept: "application/json" },
            });
            const fetchDuration = Date.now() - fetchStart;

            tracer.addApiCall({
              url: searchUrl.toString(),
              method: "GET",
              duration: fetchDuration,
              status: response.status,
              cached: false,
            });

            if (!response.ok) {
              throw new Error(
                `Catalog search failed: ${response.status} ${response.statusText}`,
              );
            }

            const data = await response.json();
            const items = data.data || [];

            for (const item of items) {
              // Avoid duplicates
              const isDuplicate = resources.some(
                (r) =>
                  r.name === item.name &&
                  r.organization === (item.owner || org || "unknown"),
              );

              if (!isDuplicate) {
                resources.push({
                  name: item.name || "",
                  subject: item.subject || "Unknown",
                  organization: item.owner || org || "unknown",
                  version:
                    item.release?.tag_name || item.default_branch || "master",
                  url: item.html_url,
                });
              }
            }

            logger.info(`Found ${items.length} resources for ${language}`, {
              organization: org || "all",
              subject: subjectToSearch,
            });
          } catch (error) {
            logger.error("Error searching catalog", {
              error: error instanceof Error ? error.message : String(error),
              language,
              organization: org || "all",
              subject: subjectToSearch,
            });
            // Continue with other subjects/organizations if multiple
          }
        }
      }

      // Cache the results
      if (resources.length > 0) {
        try {
          await kvCache.set(cacheKey, JSON.stringify(resources), cacheTtl);
          logger.info("Resources cached", {
            key: cacheKey,
            count: resources.length,
          });
        } catch (error) {
          logger.warn("Failed to cache resources", { error: String(error) });
        }
      }
    }

    // Organize by subject
    const bySubject: ResourcesBySubject = {};
    for (const resource of resources) {
      if (!bySubject[resource.subject]) {
        bySubject[resource.subject] = [];
      }
      bySubject[resource.subject].push(resource);
    }

    const subjects = Object.keys(bySubject).sort();

    // Build response
    const responseData = {
      language,
      organization: organization || "all",
      stage,
      totalResources: resources.length,
      subjects: subjects,
      subjectCount: subjects.length,
      resourcesBySubject: bySubject,
      metadata: buildMetadata({
        endpoint: "list-resources-for-language",
        startTime,
        tracer,
        extraMetadata: {
          language,
          resourceCount: resources.length,
          subjectCount: subjects.length,
        },
      }),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return handleMCPError(error, {
      tool: "list_resources_for_language",
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
      args: {
        language: args.language,
        organization: args.organization,
        stage: args.stage,
      },
    });
  }
}
