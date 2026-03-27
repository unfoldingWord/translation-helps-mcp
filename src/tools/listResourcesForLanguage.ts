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
import { cache } from "../functions/cache.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import { DEFAULT_DISCOVERY_SUBJECTS } from "../constants/subjects.js";
import { findLanguageVariants } from "../functions/resource-detector.js";

// Input schema
export const ListResourcesForLanguageArgs = z.object({
  language: z
    .string()
    .min(2)
    .describe('Language code (e.g., "en", "es", "fr", "es-419"). Required.'),
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

    const { language, stage, subject, topic } = parsedArgs;
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

    const orgKey = "all";
    const buildCacheKey = (lang: string) =>
      `resources-for-lang:${lang}:${orgKey}:${stage}:${subjectKey}:${limit}:${topic || "tc-ready"}`;

    const languageMappingKey = `lang-variant-map:${language}`;

    let resources: ResourceItem[] = [];
    let usedLanguage = language; // Track which language was actually used (for variant fallback)

    // STEP 1: Check if we have a cached language mapping (base language -> variant)
    const cacheStart = Date.now();
    const cachedVariant = await cache.get(languageMappingKey, "metadata");
    if (cachedVariant) {
      logger.info(
        `Found cached language variant mapping: ${language} -> ${cachedVariant}`,
      );
      usedLanguage = cachedVariant as string;
    }

    // STEP 2: Check cache for resources using the actual language (could be variant)
    const actualCacheKey = buildCacheKey(usedLanguage);
    const cached = await cache.getWithCacheInfo(actualCacheKey, "metadata");
    const cacheDuration = Date.now() - cacheStart;

    // Try to use cached data
    let wasCacheHit = false;
    if (cached.value) {
      resources = cached.value as ResourceItem[];
      logger.info(`✅ Cache HIT for ${actualCacheKey} in ${cacheDuration}ms`);
      tracer.addCacheHit("resources-for-language", actualCacheKey);
      wasCacheHit = true;
    } else {
      logger.info(`❌ Cache MISS for ${actualCacheKey} in ${cacheDuration}ms`);
    }

    // Fetch fresh data if no cache hit
    if (!cached.value) {
      // subjectsToSearch is already parsed above

      const organizations: (string | undefined)[] = [undefined];

      // Helper function to search for resources with a specific language code
      async function searchForLanguage(langCode: string): Promise<number> {
        let foundCount = 0;

        // Search for each subject
        for (const subjectToSearch of subjectsToSearch) {
          for (const org of organizations) {
            // Build search URL for this subject
            const searchUrl = new URL(
              "https://git.door43.org/api/v1/catalog/search",
            );
            searchUrl.searchParams.set("lang", langCode);
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
              foundCount += items.length;

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

              logger.info(`Found ${items.length} resources for ${langCode}`, {
                organization: org || "all",
                subject: subjectToSearch,
              });
            } catch (error) {
              logger.error("Error searching catalog", {
                error: error instanceof Error ? error.message : String(error),
                language: langCode,
                organization: org || "all",
                subject: subjectToSearch,
              });
              // Continue with other subjects/organizations if multiple
            }
          }
        }

        return foundCount;
      }

      // Try requested language first
      usedLanguage = language; // Update the outer scope variable
      let resourceCount = await searchForLanguage(language);

      // If no resources found, try language variants
      if (resourceCount === 0) {
        logger.info(
          `No resources found for ${language}, checking for variants...`,
        );

        // Find language variants (e.g., "es" -> ["es-419"])
        const variants = await findLanguageVariants(
          language,
          undefined,
          topic || "tc-ready",
          subjectsToSearch,
        );

        if (variants.length > 0) {
          logger.info(`Found ${variants.length} language variants`, {
            baseLanguage: language,
            variants,
          });

          // Try each variant until we find resources
          for (const variant of variants) {
            logger.info(`Trying language variant: ${variant}`);
            resourceCount = await searchForLanguage(variant);

            if (resourceCount > 0) {
              usedLanguage = variant;
              logger.info(
                `Successfully found ${resourceCount} resources using variant ${variant}`,
              );
              break;
            }
          }
        }
      }

      // Cache the results (including empty results - negative caching is valuable!)
      const cacheKeyForResults = buildCacheKey(usedLanguage);
      await cache.set(cacheKeyForResults, resources, "metadata");

      logger.info("Resources cached", {
        key: cacheKeyForResults,
        count: resources.length,
        language: usedLanguage,
        isEmpty: resources.length === 0,
      });

      // If we used a variant (different from requested language), cache the mapping
      if (usedLanguage !== language) {
        await cache.set(languageMappingKey, usedLanguage, "metadata");
        logger.info("Cached language variant mapping", {
          from: language,
          to: usedLanguage,
          key: languageMappingKey,
        });
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

    // Build metadata first
    const metadata = buildMetadata({
      startTime,
      data: resources,
      serviceMetadata: {
        cached: wasCacheHit,
      },
      additionalFields: {
        endpoint: "list-resources-for-language",
        requestedLanguage: language,
        actualLanguage: usedLanguage || language,
        languageFallbackUsed: usedLanguage !== language,
        resourceCount: resources.length,
        subjectCount: subjects.length,
      },
    });

    // Build response
    const responseData = {
      language,
      ...(usedLanguage &&
        usedLanguage !== language && {
          actualLanguageUsed: usedLanguage,
          note: `No resources found for '${language}'. Showing results for language variant '${usedLanguage}' instead.`,
        }),
      organization: "all",
      stage,
      totalResources: resources.length,
      subjects: subjects,
      subjectCount: subjects.length,
      resourcesBySubject: bySubject,
      metadata,
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
    return handleMCPError({
      toolName: "list_resources_for_language",
      args: {
        language: args.language,
        stage: args.stage,
      },
      startTime,
      originalError: error,
    });
  }
}
