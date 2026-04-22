/**
 * Resource Detector Service
 * Unified DCS catalog discovery to minimize API calls
 * Caches resource availability and provides metadata to other services
 */

import { ResourceType } from "../constants/terminology";
import { logger } from "../utils/logger.js";
import { proxyFetch } from "../utils/httpClient.js";
import { cache } from "./cache";
import { parseReference } from "./reference-parser";

export interface ResourceContext {
  identifier: string;
  subject: string;
  organization?: string;
  language?: string;
  name?: string;
  title?: string;
  description?: string;
}

export interface ResourceDetectionResult {
  type: ResourceType | null;
  confidence: number;
  reasoning: string[];
  alternatives: Array<{
    type: ResourceType;
    confidence: number;
    reason: string;
  }>;
  context?: ResourceContext;
}

export interface CatalogDetectionResult {
  detection: ResourceDetectionResult;
  resource: Record<string, unknown>;
}

/**
 * Detect resource type from identifier and subject patterns
 * Implements the algorithm from Task 7 implementation plan
 */
export function detectResourceType(
  context: ResourceContext,
): ResourceDetectionResult {
  const reasoning: string[] = [];
  const alternatives: Array<{
    type: ResourceType;
    confidence: number;
    reason: string;
  }> = [];
  let bestMatch: { type: ResourceType; confidence: number } | null = null;

  if (!context.identifier || !context.subject) {
    return {
      type: null,
      confidence: 0,
      reasoning: ["Missing identifier or subject"],
      alternatives: [],
      context,
    };
  }

  const identifier = context.identifier.toLowerCase();
  const subject = context.subject.toLowerCase();

  // High confidence patterns - exact identifier matches
  // Check longer patterns first to avoid partial matches (twl before tw)
  const exactPatterns: Array<{ pattern: string; type: ResourceType }> = [
    { pattern: "twl", type: ResourceType.TWL },
    { pattern: "ult", type: ResourceType.ULT },
    { pattern: "glt", type: ResourceType.GLT },
    { pattern: "ust", type: ResourceType.UST },
    { pattern: "gst", type: ResourceType.GST },
    { pattern: "tn", type: ResourceType.TN },
    { pattern: "tw", type: ResourceType.TW },
    { pattern: "tq", type: ResourceType.TQ },
    { pattern: "ta", type: ResourceType.TA },
    { pattern: "uhb", type: ResourceType.UHB },
    { pattern: "ugnt", type: ResourceType.UGNT },
  ];

  // Check for exact resource type in identifier
  for (const { pattern, type } of exactPatterns) {
    if (
      identifier.includes(`_${pattern}`) ||
      (identifier.endsWith(pattern) &&
        (identifier.length === pattern.length ||
          identifier[identifier.length - pattern.length - 1] === "_"))
    ) {
      bestMatch = { type, confidence: 0.95 };
      reasoning.push(
        `Exact identifier match: found '${pattern}' in '${identifier}'`,
      );
      break;
    }
  }

  // Medium confidence patterns - subject-based detection
  // NOTE: Check TWL before TW to avoid mismatching
  if (!bestMatch) {
    if (subject.includes("bible") || subject.includes("aligned bible")) {
      if (identifier.includes("ult") || identifier.includes("glt")) {
        bestMatch = { type: ResourceType.ULT, confidence: 0.8 };
        reasoning.push(
          `Bible subject with literal identifier: '${identifier}'`,
        );
      } else if (identifier.includes("ust") || identifier.includes("gst")) {
        bestMatch = { type: ResourceType.UST, confidence: 0.8 };
        reasoning.push(
          `Bible subject with simplified identifier: '${identifier}'`,
        );
      } else {
        // Default to ULT for generic Bible subjects
        bestMatch = { type: ResourceType.ULT, confidence: 0.6 };
        reasoning.push(`Generic Bible subject, defaulting to ULT`);
      }
    } else if (subject.includes("translation notes")) {
      bestMatch = { type: ResourceType.TN, confidence: 0.85 };
      reasoning.push(`Translation Notes subject detected`);
    } else if (
      subject.includes("translation word links") ||
      subject.includes("translation words links")
    ) {
      bestMatch = { type: ResourceType.TWL, confidence: 0.85 };
      reasoning.push(`Translation Words Links subject detected`);
    } else if (subject.includes("translation words")) {
      bestMatch = { type: ResourceType.TW, confidence: 0.85 };
      reasoning.push(`Translation Words subject detected`);
    } else if (subject.includes("translation questions")) {
      bestMatch = { type: ResourceType.TQ, confidence: 0.85 };
      reasoning.push(`Translation Questions subject detected`);
    } else if (subject.includes("translation academy")) {
      bestMatch = { type: ResourceType.TA, confidence: 0.85 };
      reasoning.push(`Translation Academy subject detected`);
    } else if (subject.includes("hebrew bible")) {
      bestMatch = { type: ResourceType.UHB, confidence: 0.9 };
      reasoning.push(`Hebrew Bible subject detected`);
    } else if (
      subject.includes("greek new testament") ||
      subject.includes("greek nt")
    ) {
      bestMatch = { type: ResourceType.UGNT, confidence: 0.9 };
      reasoning.push(`Greek New Testament subject detected`);
    }
  }

  // Low confidence fallback patterns
  if (!bestMatch) {
    reasoning.push(
      `No clear pattern match for identifier '${identifier}' and subject '${subject}'`,
    );
    return {
      type: null,
      confidence: 0,
      reasoning,
      alternatives,
      context,
    };
  }

  // Confidence adjustments based on context
  let finalConfidence = bestMatch.confidence;

  // Reduce confidence for obviously wrong combinations
  if (
    subject.includes("quantum physics") ||
    subject.includes("cooking") ||
    subject.includes("sports")
  ) {
    finalConfidence = Math.max(0.1, finalConfidence - 0.8);
    reasoning.push(`Subject appears non-biblical, reducing confidence`);
  }

  // Boost confidence for organization match
  if (
    context.organization === "unfoldingWord" ||
    context.organization === "Door43-Catalog"
  ) {
    finalConfidence = Math.min(1.0, finalConfidence + 0.05);
    reasoning.push(`Trusted organization: ${context.organization}`);
  }

  return {
    type: bestMatch.type,
    confidence: finalConfidence,
    reasoning,
    alternatives,
    context,
  };
}

/**
 * Detect resource types from catalog response data
 * Processes multiple resources at once for efficiency
 */
export function detectResourcesFromCatalog(
  catalogData: Record<string, unknown>[],
): CatalogDetectionResult[] {
  return catalogData.map((resource) => {
    const context: ResourceContext = {
      identifier: typeof resource.name === "string" ? resource.name : "",
      subject: typeof resource.subject === "string" ? resource.subject : "",
      organization:
        typeof resource.organization === "string"
          ? resource.organization
          : typeof resource.owner === "object" &&
              resource.owner &&
              typeof (resource.owner as Record<string, unknown>).login ===
                "string"
            ? ((resource.owner as Record<string, unknown>).login as string)
            : "",
      language: typeof resource.language === "string" ? resource.language : "",
      name: typeof resource.name === "string" ? resource.name : "",
      title: typeof resource.title === "string" ? resource.title : "",
      description:
        typeof resource.description === "string" ? resource.description : "",
    };

    const detection = detectResourceType(context);

    return {
      detection,
      resource: resource,
    };
  });
}

export interface ResourceCatalogInfo {
  name: string;
  title: string;
  subject: string;
  owner?: string; // Organization that owns this resource (e.g., "unfoldingWord")
  ingredients?: Array<{
    identifier: string;
    path: string;
  }>;
  url?: string;
}

export interface ResourceAvailability {
  scripture: ResourceCatalogInfo[];
  notes: ResourceCatalogInfo[];
  questions: ResourceCatalogInfo[];
  words: ResourceCatalogInfo[];
  wordLinks: ResourceCatalogInfo[];
  lastUpdated: string;
  book: string;
  organization?: string; // Optional - undefined means all organizations
  language: string;
}

/**
 * Discover all available resources for a book/language/organization in one shot
 * Caches results to minimize DCS catalog API calls
 *
 * @param reference - Bible reference (e.g., "John 3:16")
 * @param language - Language code (default: "en")
 * @param organization - Organization filter (undefined = all organizations)
 * @param topic - Topic filter (default: "tc-ready" for translationCore-ready resources)
 */
export async function discoverAvailableResources(
  reference: string,
  language: string = "en",
  organization?: string,
  topic: string = "tc-ready",
): Promise<ResourceAvailability> {
  const parsedRef = parseReference(reference, { language });
  if (!parsedRef) {
    throw new Error(`Invalid reference format: ${reference}`);
  }
  const book = parsedRef.book;

  // Cache key for this book/language/org/topic combination
  // When organization is undefined, use "all" in cache key
  const orgKey = organization || "all";
  const cacheKey = `resource-discovery:${book}:${language}:${orgKey}:${topic}`;

  // Try cache first
  const cached = await cache.getWithCacheInfo(cacheKey, "metadata");
  if (cached.value) {
    logger.info(`Resource discovery cache HIT`, {
      book,
      language,
      organization: orgKey,
      topic,
    });
    return cached.value;
  }

  logger.info(`Discovering resources`, {
    book,
    language,
    organization: orgKey,
    topic,
  });

  const availability: ResourceAvailability = {
    scripture: [],
    notes: [],
    questions: [],
    words: [],
    wordLinks: [],
    lastUpdated: new Date().toISOString(),
    book,
    organization: organization || undefined,
    language,
  };

  // Parallel catalog searches for all resource types
  const searches = [
    {
      type: "scripture" as keyof ResourceAvailability,
      subjects: ["Bible", "Aligned Bible"],
    },
    {
      type: "notes" as keyof ResourceAvailability,
      subjects: ["TSV Translation Notes"],
    },
    {
      type: "questions" as keyof ResourceAvailability,
      subjects: ["TSV Translation Questions"],
    },
    {
      type: "words" as keyof ResourceAvailability,
      subjects: ["Translation Words"],
    },
    {
      type: "wordLinks" as keyof ResourceAvailability,
      subjects: ["Translation Word Links"],
    },
  ];

  const searchPromises = searches.flatMap((search) =>
    search.subjects.map(async (subject) => {
      try {
        // Build catalog URL with topic filter and optional organization filter
        let catalogUrl = `https://git.door43.org/api/v1/catalog/search?subject=${encodeURIComponent(subject)}&lang=${language}&topic=${topic}&metadataType=rc&includeMetadata=true`;

        // Only add owner parameter if organization is specified AND not "all"
        // The catalog API doesn't recognize owner=all and returns 0 results
        if (organization && organization !== "all") {
          catalogUrl += `&owner=${organization}`;
        }

        logger.debug(`Catalog search`, {
          subject,
          language,
          organization: organization || "all",
          topic,
        });

        const response = await proxyFetch(catalogUrl);
        if (!response.ok) {
          logger.warn(`Catalog search failed`, {
            subject,
            status: response.status,
            catalogUrl,
          });
          return { type: search.type, resources: [] };
        }

        const data = (await response.json()) as {
          data?: ResourceCatalogInfo[];
        };

        logger.debug(`[CATALOG RESPONSE]`, {
          subject,
          resourceType: search.type,
          dataLength: data.data?.length || 0,
          firstResource: data.data?.[0]?.name,
        });

        const resources = (data.data || []).map((resource) => ({
          name: resource.name,
          owner: resource.owner, // Include owner from catalog response
          title:
            resource.title ||
            resource.door43_metadata?.title ||
            resource.description,
          subject,
          url: `https://git.door43.org/${resource.owner || organization || "unknown"}/${resource.name}`,
          ingredients:
            resource.ingredients ||
            resource.door43_metadata?.ingredients ||
            resource.metadata?.ingredients ||
            [],
        }));

        logger.debug(`Found resources`, { subject, count: resources.length });
        return { type: search.type, resources };
      } catch (error) {
        logger.warn(`Catalog search error`, { subject, error: String(error) });
        return { type: search.type, resources: [] };
      }
    }),
  );

  // Wait for all searches to complete
  const searchResults = await Promise.all(searchPromises);

  // Aggregate results by resource type
  for (const result of searchResults) {
    const existing = availability[result.type] as ResourceCatalogInfo[];
    existing.push(...result.resources);
  }

  // Remove duplicates within each resource type
  availability.scripture = availability.scripture.filter(
    (resource, index, arr) =>
      arr.findIndex((r) => r.name === resource.name) === index,
  );
  availability.notes = availability.notes.filter(
    (resource, index, arr) =>
      arr.findIndex((r) => r.name === resource.name) === index,
  );
  availability.questions = availability.questions.filter(
    (resource, index, arr) =>
      arr.findIndex((r) => r.name === resource.name) === index,
  );
  availability.words = availability.words.filter(
    (resource, index, arr) =>
      arr.findIndex((r) => r.name === resource.name) === index,
  );
  availability.wordLinks = availability.wordLinks.filter(
    (resource, index, arr) =>
      arr.findIndex((r) => r.name === resource.name) === index,
  );

  // Cache the discovery results
  logger.info(`[RESOURCE DISCOVERY COMPLETE]`, {
    book,
    language,
    organization: orgKey,
    topic,
    scripture: availability.scripture.length,
    notes: availability.notes.length,
    questions: availability.questions.length,
    words: availability.words.length,
    wordLinks: availability.wordLinks.length,
  });

  await cache.set(cacheKey, availability, "metadata");

  const totalResources =
    availability.scripture.length +
    availability.notes.length +
    availability.questions.length +
    availability.words.length +
    availability.wordLinks.length;

  logger.info(`Resource discovery complete`, { totalResources, book });

  return availability;
}

// 🚀 OPTIMIZATION: Known language variants for instant resolution
// These are well-established variants that rarely change
const KNOWN_VARIANTS: Record<string, string[]> = {
  // Note: Do not map `es` → `es-419` here. Many resources (e.g. uw `es_tn`) use `lang=es`
  // only; static mapping caused org-specific TN requests to retry the wrong code first.
  pt: ["pt-br"], // Portuguese → Brazilian Portuguese
  zh: ["zh-tw"], // Chinese → Traditional Chinese
  ar: ["ar-x-strong"], // Arabic → Strong's Arabic
  en: ["en-US", "en-GB"], // English variants (if needed)
};

/**
 * Find all available language variants for a given base language code
 * Used when a language fetch fails to suggest alternatives
 *
 * @param baseLanguage - Base language code (e.g., "es", "fr")
 * @param organization - Optional organization filter
 * @param topic - Topic filter (default: "tc-ready")
 * @returns Array of available language codes that match the base
 */
export async function findLanguageVariants(
  baseLanguage: string,
  organization?: string,
  topic: string = "tc-ready",
  subjects?: string[],
): Promise<string[]> {
  // Default to Bible subjects if not specified
  const searchSubjects = subjects || ["Bible", "Aligned Bible"];
  const cacheKey = `language-variants:${baseLanguage}:${organization || "all"}:${topic}:${searchSubjects.join(",")}`;

  // 🚀 OPTIMIZATION 1: Check known variants first (instant!)
  const knownVariants = KNOWN_VARIANTS[baseLanguage];
  if (knownVariants && knownVariants.length > 0) {
    logger.info(`Using known language variants (instant)`, {
      baseLanguage,
      variants: knownVariants,
      source: "static-mapping",
    });

    // Cache the known variants too (for consistency)
    await cache.set(cacheKey, knownVariants, 60 * 60 * 24 * 7, "metadata"); // 7 days
    return knownVariants;
  }

  // Try cache next
  const cached = await cache.getWithCacheInfo(cacheKey, "metadata");
  if (cached.value) {
    logger.info(`Language variants cache HIT`, {
      baseLanguage,
      variants: cached.value,
    });
    return cached.value;
  }

  logger.info(`Finding language variants`, {
    baseLanguage,
    organization: organization || "all",
    topic,
    subjects: searchSubjects,
  });

  // 🚀 OPTIMIZATION: Try faster languages endpoint first with filters
  // This endpoint returns just language codes, not full resource metadata (~96% smaller payload!)
  try {
    // Build filtered languages URL with topic and subjects for targeted results
    const params = new URLSearchParams();
    params.append("stage", "prod");
    if (topic) {
      params.append("topic", topic); // Filter by tc-ready
    }
    // Add all subjects as separate parameters (API supports multiple subject params)
    for (const subject of searchSubjects) {
      params.append("subject", subject);
    }

    const languagesUrl = `https://git.door43.org/api/v1/catalog/list/languages?${params.toString()}`;
    logger.debug(`Fetching filtered languages from dedicated endpoint`, {
      url: languagesUrl,
      baseLanguage,
      topic,
      subjects: searchSubjects,
    });

    const startTime = Date.now();
    const response = await proxyFetch(languagesUrl);
    const fetchDuration = Date.now() - startTime;

    if (response.ok) {
      const languagesData = (await response.json()) as {
        data?: Array<{ lc: string }>;
      };
      // API returns { lc: "language-code" } format
      const allLanguages = (languagesData.data || []).map((l) => l.lc);

      logger.info(
        `Filtered languages endpoint returned ${allLanguages.length} languages in ${fetchDuration}ms`,
        {
          sampleLanguages: allLanguages.slice(0, 10),
          baseLanguage,
          payloadSize: "96% smaller than unfiltered",
        },
      );

      // Filter for variants matching the base language
      const variants = allLanguages
        .filter(
          (code) => code.startsWith(baseLanguage) && code !== baseLanguage,
        )
        .sort();

      if (variants.length > 0) {
        logger.info(
          `Found language variants via filtered languages endpoint (FAST)`,
          {
            baseLanguage,
            count: variants.length,
            variants,
            duration: `${fetchDuration}ms`,
            optimization: "filtered endpoint (96% smaller payload)",
          },
        );

        // Cache for 7 days
        await cache.set(cacheKey, variants, 60 * 60 * 24 * 7, "metadata");
        return variants;
      }

      logger.debug(
        `No variants found via languages endpoint, falling back to resource search`,
      );
    } else {
      logger.warn(
        `Languages endpoint failed, falling back to resource search`,
        {
          status: response.status,
        },
      );
    }
  } catch (error) {
    logger.warn(`Languages endpoint error, falling back to resource search`, {
      error,
    });
  }

  // Fallback: Original approach (search all resources, filter client-side)
  logger.debug(`Using fallback resource search for variant discovery`);

  // Build catalog search URL - search specified subjects
  // NOTE: Catalog API requires EXACT language match (lang=es doesn't return lang=es-419)
  // So we search WITHOUT lang parameter and filter client-side for variants
  const baseUrl = "https://git.door43.org/api/v1/catalog/search";

  // Make parallel requests for all specified subjects
  const searchPromises = searchSubjects.map(async (subject) => {
    const params = new URLSearchParams();

    // Only add owner if it's a specific organization (not "all")
    if (organization && organization !== "all") {
      params.append("owner", organization);
    }
    if (topic) {
      params.append("topic", topic); // Use "topic" not "tag"
    }
    params.append("subject", subject);
    params.append("metadataType", "rc");
    // NOTE: NOT including lang parameter - we'll filter client-side

    const catalogUrl = `${baseUrl}?${params.toString()}`;
    logger.debug(`Searching catalog for language variants`, {
      subject,
      catalogUrl,
    });

    try {
      const response = await proxyFetch(catalogUrl);
      if (!response.ok) {
        logger.warn(`Catalog search failed for subject ${subject}`, {
          status: response.status,
        });
        return [];
      }

      const catalogData = (await response.json()) as {
        data?: Array<{
          name: string;
          language: string;
          stage?: string;
        }>;
      };

      return catalogData.data || [];
    } catch (error) {
      logger.error(`Error searching subject ${subject}`, { error });
      return [];
    }
  });

  try {
    const allResults = await Promise.all(searchPromises);
    const catalogData = allResults.flat();

    if (catalogData.length === 0) {
      logger.info(`No resources found`, { subjects });
      return [];
    }

    logger.debug(
      `Found ${catalogData.length} total resources, filtering for base language`,
      {
        baseLanguage,
        subjects,
        sampleNames: catalogData.slice(0, 5).map((r) => r.name),
      },
    );

    // Filter for resources matching the base language pattern
    const matchingResources = catalogData.filter((r) => {
      const langMatch = r.name.match(/^([a-z]{2,3}(?:-[a-zA-Z0-9]+)?)_/);
      if (langMatch) {
        const langCode = langMatch[1];
        return langCode.startsWith(baseLanguage);
      }
      return false;
    });

    logger.debug(`Filtered to ${matchingResources.length} matching resources`, {
      matchingNames: matchingResources.slice(0, 5).map((r) => r.name),
    });

    if (matchingResources.length === 0) {
      logger.info(`No matching resources for base language`, { baseLanguage });
      return [];
    }

    // Extract unique language codes from resource names
    // Resource names follow pattern: {lang}_{resource} or {lang-variant}_{resource}
    const languageCodes = new Set<string>();

    for (const resource of matchingResources) {
      // Extract language code from resource name (e.g., "es-419_glt" -> "es-419")
      const langMatch = resource.name.match(/^([a-z]{2,3}(?:-[a-zA-Z0-9]+)?)_/);
      if (langMatch) {
        languageCodes.add(langMatch[1]);
      }
    }

    const variants = Array.from(languageCodes).sort();
    logger.info(`Found language variants via fallback resource search`, {
      baseLanguage,
      count: variants.length,
      variants,
    });

    // Cache for 7 days (variants rarely change)
    await cache.set(cacheKey, variants, 60 * 60 * 24 * 7, "metadata");

    logger.debug(`Cached variants for 7 days`, { baseLanguage, variants });

    return variants;
  } catch (error) {
    logger.error(`Failed to find language variants`, { baseLanguage, error });
    return [];
  }
}

/**
 * Get specific resource info for a resource type and book
 * Uses cached discovery data when available
 */
export async function getResourceForBook(
  reference: string,
  resourceType: "scripture" | "notes" | "questions" | "words" | "wordLinks",
  language: string = "en",
  organization?: string,
  topic: string = "tc-ready",
): Promise<ResourceCatalogInfo | null> {
  logger.debug(`getResourceForBook called`, {
    reference,
    resourceType,
    language,
    organization: organization || "all",
    topic,
  });
  const availability = await discoverAvailableResources(
    reference,
    language,
    organization,
    topic,
  );
  const resources = availability[resourceType];

  logger.debug(`Resources found`, {
    resourceType,
    count: resources?.length || 0,
  });

  if (!resources || resources.length === 0) {
    logger.error(`No resources found`, { resourceType });
    return null;
  }

  // Return the first (usually best) resource of this type
  return resources[0];
}

/**
 * Get ALL available resources for a book (not just the first one)
 * Used when organization is undefined to fetch from multiple organizations
 */
export async function getResourcesForBook(
  reference: string,
  resourceType: "scripture" | "notes" | "questions" | "words" | "wordLinks",
  language: string = "en",
  organization?: string,
  topic: string = "tc-ready",
): Promise<ResourceCatalogInfo[]> {
  logger.debug(`getResourcesForBook called (plural)`, {
    reference,
    resourceType,
    language,
    organization: organization || "all",
    topic,
  });
  const availability = await discoverAvailableResources(
    reference,
    language,
    organization,
    topic,
  );
  const resources = availability[resourceType];

  logger.debug(`Resources found (plural)`, {
    resourceType,
    count: resources?.length || 0,
  });

  if (!resources || resources.length === 0) {
    logger.warn(`No resources found for plural fetch`, { resourceType });
    return [];
  }

  // Return ALL resources
  return resources;
}

/**
 * Check if any resources exist for a reference without fetching full details
 * Super fast check using cached discovery data
 */
export async function checkResourceAvailability(
  reference: string,
  language: string = "en",
  organization?: string,
  topic: string = "tc-ready",
): Promise<{
  hasScripture: boolean;
  hasNotes: boolean;
  hasQuestions: boolean;
  hasWords: boolean;
  hasWordLinks: boolean;
  totalResources: number;
}> {
  const availability = await discoverAvailableResources(
    reference,
    language,
    organization,
    topic,
  );

  return {
    hasScripture: availability.scripture.length > 0,
    hasNotes: availability.notes.length > 0,
    hasQuestions: availability.questions.length > 0,
    hasWords: availability.words.length > 0,
    hasWordLinks: availability.wordLinks.length > 0,
    totalResources:
      availability.scripture.length +
      availability.notes.length +
      availability.questions.length +
      availability.words.length +
      availability.wordLinks.length,
  };
}
