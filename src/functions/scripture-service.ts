/**
 * Scripture Service
 * Shared core implementation for fetching scripture text
 * Used by both Netlify functions and MCP tools for consistency
 */

import {
  parseUSFMAlignment,
  type WordAlignment,
} from "../experimental/usfm-alignment-parser.js";
import { logger } from "../utils/logger.js";
import { parseReference } from "./reference-parser.js";
import { discoverAvailableResources } from "./resource-detector.js";
import { CacheBypassOptions } from "./unified-cache.js";
import { EdgeXRayTracer } from "./edge-xray.js";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { getBookCodesForError } from "../utils/book-codes.js";
import {
  getPinnedOrganizationValue,
  isPinnedSingleOrganization,
  makeOrganizationFallbackInfo,
  type OrganizationFallbackInfo,
} from "../utils/organization-fallback.js";
import * as os from "os";
import * as path from "path";
import {
  extractChapterRange,
  extractChapterRangeWithNumbers,
  extractChapterText,
  extractChapterTextWithNumbers,
  extractVerseRange,
  extractVerseRangeWithNumbers,
  extractVerseText,
  extractVerseTextWithNumbers,
} from "./usfm-extractor.js";

export { type WordAlignment };

export interface ScriptureOptions {
  reference: string;
  language?: string;
  organization?: string; // Optional - undefined means all organizations
  includeVerseNumbers?: boolean;
  format?: "text" | "usfm";
  specificTranslations?: string[];
  bypassCache?: CacheBypassOptions;
  includeAlignment?: boolean; // New option for alignment data
  topic?: string; // Topic filter (default: "tc-ready")
}

export interface ScriptureResult {
  scripture?: {
    text: string;
    translation: string;
    citation: {
      resource: string;
      organization: string;
      language: string;
      url: string;
      version: string;
    };
    alignment?: {
      words: WordAlignment[];
      metadata: {
        totalAlignments: number;
        averageConfidence: number;
        hasCompleteAlignment: boolean;
      };
    };
  };
  scriptures?: Array<{
    text: string;
    translation: string;
    citation: {
      resource: string;
      organization: string;
      language: string;
      url: string;
      version: string;
    };
    alignment?: {
      words: WordAlignment[];
      metadata: {
        totalAlignments: number;
        averageConfidence: number;
        hasCompleteAlignment: boolean;
      };
    };
  }>;
  metadata: {
    responseTime: number;
    cached: boolean;
    timestamp: string;
    includeVerseNumbers: boolean;
    format: string;
    translationsFound: number;
    cacheKey?: string;
    cacheType?: string;
    hasAlignmentData?: boolean;
    /** Present when a pinned org had no catalog matches and results came from all-org search */
    organizationFallback?: OrganizationFallbackInfo;
  };
}

/**
 * Core scripture fetching logic - now properly handles all parameters
 */
export async function fetchScripture(
  options: ScriptureOptions,
): Promise<ScriptureResult> {
  const startTime = Date.now();
  const {
    reference: referenceParam,
    language = "en",
    organization, // Optional - undefined means all organizations
    includeVerseNumbers = true,
    format = "text",
    specificTranslations,
    bypassCache,
    includeAlignment = false, // Default to false for backward compatibility
    topic = "tc-ready", // Default to tc-ready for translationCore-ready resources
  } = options;

  logger.info(`Core scripture service called`, {
    reference: referenceParam,
    language,
    organization: organization || "all",
    includeVerseNumbers,
    format,
    includeAlignment,
    topic,
    bypassCache: Boolean(bypassCache),
  });

  const reference = parseReference(referenceParam, { language });
  if (!reference) {
    throw new Error(`Invalid reference format: ${referenceParam}`);
  }

  // Response caching disabled by policy. Always fetch fresh scripture.

  async function fetchFreshScripture(): Promise<ScriptureResult> {
    const executionId = Math.random().toString(36).substr(2, 9);
    logger.debug(`fetchFreshScripture execution`, { id: executionId });

    // 🚀 OPTIMIZATION: Use unified resource discovery instead of separate catalog searches
    logger.debug(`Using unified resource discovery for scripture...`);
    let availability = await discoverAvailableResources(
      referenceParam,
      language,
      organization,
      topic,
    );
    let allResources = availability.scripture;

    let organizationFallback: OrganizationFallbackInfo | undefined;

    if (allResources.length === 0 && isPinnedSingleOrganization(organization)) {
      const pinned = getPinnedOrganizationValue(organization)!;
      logger.warn(
        `No scripture resources for pinned organization=${pinned}, retrying catalog discovery without owner filter`,
      );
      const retryAvailability = await discoverAvailableResources(
        referenceParam,
        language,
        undefined,
        topic,
      );
      if (retryAvailability.scripture.length > 0) {
        availability = retryAvailability;
        allResources = retryAvailability.scripture;
        organizationFallback = makeOrganizationFallbackInfo(pinned);
        logger.info(`Organization fallback succeeded`, {
          requestedOrganization: pinned,
          discoveredCount: allResources.length,
        });
      }
    }

    if (allResources.length === 0) {
      logger.error(`No scripture resources found`, {
        language,
        organization: organization || "all",
        topic,
      });
      throw new Error(
        `No scripture resources found for ${language}${organization ? `/${organization}` : ""} with topic=${topic}`,
      );
    }

    logger.info(`Found scripture resources from unified discovery`, {
      count: allResources.length,
    });

    // Filter by specific translations if requested
    let filteredResources = allResources;
    if (specificTranslations && specificTranslations.length > 0) {
      filteredResources = allResources.filter((resource) =>
        specificTranslations!.includes(resource.name),
      );
      logger.info(`Filtered to specific translations`, {
        count: filteredResources.length,
        specificTranslations,
      });

      if (filteredResources.length === 0) {
        logger.warn(`No resources found for specified translations`, {
          specificTranslations,
        });
        // Fall back to all available resources if none of the specified ones exist
        filteredResources = allResources;
      }
    }

    // Handle translations: if none specified, return all; if specified, return only those
    const resourcesToProcess = specificTranslations
      ? filteredResources
      : allResources;

    logger.debug(`Processing resources`, {
      count: resourcesToProcess.length,
      specific: specificTranslations?.join(", "),
    });

    // 🚀 Use ZIP-based downloads and caching with configurable provider
    logger.info(`🚀 Starting fresh scripture fetch...`);
    const tracer = new EdgeXRayTracer("scripture-service", "fetchScripture");

    // Use configurable ZIP fetcher provider (from config or environment)
    const providerName =
      (options as any).zipFetcherProvider ||
      process.env.ZIP_FETCHER_PROVIDER ||
      "auto";

    const cacheDir =
      typeof process !== "undefined" && process.env.CACHE_PATH
        ? process.env.CACHE_PATH
        : path.join(os.homedir(), ".translation-helps-mcp", "cache");

    const zipFetcher = ZipFetcherFactory.create(providerName, cacheDir, tracer);
    logger.info(`📦 Using ZIP fetcher provider: ${zipFetcher.name}`);

    // ⚡ PARALLEL FETCH: Process all resources simultaneously
    logger.info(
      `[PARALLEL FETCH] Starting parallel fetch for ${resourcesToProcess.length} resources`,
    );

    const resourcePromises = resourcesToProcess.map(async (resource) => {
      logger.debug(`Processing resource`, {
        name: resource.name,
        title: resource.title,
      });

      // Find the correct file from ingredients
      const ingredient = resource.ingredients?.find(
        (ing: { identifier: string }) =>
          ing.identifier?.toLowerCase() === reference?.book.toLowerCase(),
      );

      if (!ingredient || !reference) {
        logger.warn(`Book not found in resource`, {
          book: reference?.book,
          resource: resource.name,
        });
        return null;
      }

      try {
        // Use ZipResourceFetcher2 to get raw USFM from ZIP (cached)
        // This downloads ZIP once, caches it, and extracts the USFM file
        const ingredientPath = ingredient.path.replace(/^\.\//, "");

        // Get catalog data to find ref tag and zipball URL
        // ZipResourceFetcher2 will fetch catalog internally, but we need it for refTag/zipballUrl
        // For now, use "master" as default ref - ZipResourceFetcher2 will handle catalog fetching
        const refTag = "master"; // Default, ZipResourceFetcher2 will resolve actual ref from catalog
        const zipballUrl = null; // ZipResourceFetcher2 will get from catalog

        // Extract organization from the resource metadata (from DCS catalog response)
        // The resource comes from catalog search which includes owner information
        const resourceOrg =
          (resource as any).owner || organization || "unfoldingWord";

        logger.info(
          `📦 Using ZIP-based download for ${resourceOrg}/${resource.name} (ref: ${refTag})`,
        );

        // Download ZIP (cached in R2) and extract USFM file (cached extraction)
        // ZipResourceFetcher2.getRawUSFMContent will fetch catalog if needed to get refTag/zipballUrl
        const usfmData = await zipFetcher.getRawUSFMContent(
          resourceOrg,
          resource.name,
          ingredientPath,
          refTag,
          zipballUrl,
        );

        if (!usfmData) {
          logger.warn(`Failed to get USFM from ZIP for ${resource.name}`);
          return null;
        }

        logger.info(`✅ Got USFM data from ZIP: ${usfmData.length} characters`);

        logger.info(`🔧 Extracting verses from USFM...`);

        // Choose extraction method based on format and includeVerseNumbers
        const extractionStart = Date.now();
        logger.debug(`Starting USFM extraction`, {
          reference: `${reference.book} ${reference.chapter}:${reference.verse}`,
        });
        let text = "";

        if (format === "usfm") {
          // Return raw USFM for the requested passage
          text = extractUSFMPassage(usfmData, reference);
        } else {
          // Extract clean text with or without verse numbers
          if (includeVerseNumbers) {
            if (reference.verse && reference.endVerse) {
              text = extractVerseRangeWithNumbers(
                usfmData,
                reference.chapter,
                reference.verse,
                reference.endVerse,
              );
            } else if (reference.verse) {
              text = extractVerseTextWithNumbers(
                usfmData,
                reference.chapter,
                reference.verse,
              );
            } else if (reference.endVerse) {
              text = extractChapterRangeWithNumbers(
                usfmData,
                reference.chapter,
                reference.endVerse,
              );
            } else {
              text = extractChapterTextWithNumbers(usfmData, reference.chapter);
            }
          } else {
            if (reference.verse && reference.endVerse) {
              text = extractVerseRange(
                usfmData,
                reference.chapter,
                reference.verse,
                reference.endVerse,
              );
            } else if (reference.verse) {
              text = extractVerseText(
                usfmData,
                reference.chapter,
                reference.verse,
              );
            } else if (reference.endVerse) {
              text = extractChapterRange(
                usfmData,
                reference.chapter,
                reference.endVerse,
              );
            } else {
              text = extractChapterText(usfmData, reference.chapter);
            }
          }
        }

        logger.info(`✅ Extracted text: ${text.length} characters`);

        if (text.trim()) {
          logger.info(`📝 Text extraction successful for ${resource.name}`);

          // Process alignment data if requested
          let alignmentData:
            | {
                words: WordAlignment[];
                metadata: {
                  totalAlignments: number;
                  averageConfidence: number;
                  hasCompleteAlignment: boolean;
                };
              }
            | undefined;

          if (includeAlignment && format !== "usfm") {
            logger.info(`🔗 Processing alignment data...`);
            try {
              logger.debug(`Processing alignment data`, {
                resource: resource.name,
              });
              const alignmentStart = Date.now();

              // Parse alignment from the full USFM data for the passage
              const passageUSFM = extractUSFMPassage(usfmData, reference);
              const parsedAlignment = parseUSFMAlignment(passageUSFM);

              alignmentData = {
                words: parsedAlignment.alignments,
                metadata: {
                  totalAlignments: parsedAlignment.metadata.totalAlignments,
                  averageConfidence: parsedAlignment.metadata.averageConfidence,
                  hasCompleteAlignment:
                    parsedAlignment.metadata.hasCompleteAlignment,
                },
              };

              const alignmentTime = Date.now() - alignmentStart;
              logger.debug(`Alignment processing completed`, {
                ms: alignmentTime,
                count: parsedAlignment.alignments.length,
              });
            } catch (alignmentError) {
              logger.warn(`Alignment processing failed`, {
                resource: resource.name,
                error: String(alignmentError),
              });
              // Continue without alignment data
            }
          }

          logger.info(`➕ Returning scripture result for ${resource.name}`);

          const extractionTime = Date.now() - extractionStart;
          logger.info(
            `✅ Successfully processed ${resource.name} in ${extractionTime}ms - ${text.length} chars`,
          );

          return {
            text: text.trim(),
            translation: resource.title,
            citation: {
              resource: resource.name,
              organization: resourceOrg,
              language,
              url: `https://git.door43.org/${resourceOrg}/${resource.name}`,
              version: "master",
            },
            alignment: alignmentData,
          };
        }
      } catch (error) {
        logger.error(`❌ Exception processing ${resource.name}:`, {
          error: String(error),
          stack:
            error instanceof Error ? error.stack?.substring(0, 200) : undefined,
        });
        return null;
      }

      return null;
    });

    const scriptureResults = await Promise.all(resourcePromises);
    logger.info(
      `[PARALLEL FETCH] Completed ${scriptureResults.length} fetches in parallel`,
    );

    // Filter out null results
    const scriptures = scriptureResults.filter(
      (s): s is NonNullable<typeof s> => s !== null,
    );

    logger.info(
      `🏁 Parallel fetch complete. Processed ${scriptures.length} scriptures out of ${resourcesToProcess.length} resources`,
    );

    if (scriptures.length === 0) {
      // Check if this was due to invalid book code
      const bookCode = reference?.book?.toUpperCase();
      const validCodes = getBookCodesForError();

      const error: any = new Error(
        `No scripture found for reference '${referenceParam}'. ` +
          `The book code '${bookCode}' was not found in any available resources. ` +
          `Please use 3-letter book codes (e.g., GEN for Genesis, JHN for John, MAT for Matthew, 3JN for 3 John).`,
      );

      // Attach valid book codes for AI agents
      error.validBookCodes = validCodes;
      error.invalidCode = bookCode;

      throw error;
    }

    const baseMetadata = {
      responseTime: Date.now() - startTime,
      cached: false,
      timestamp: new Date().toISOString(),
      includeVerseNumbers,
      format,
      translationsFound: scriptures.length,
      ...(organizationFallback && { organizationFallback }),
    };

    const result: ScriptureResult =
      specificTranslations && specificTranslations.length === 1
        ? {
            scripture: scriptures[0]!,
            metadata: {
              ...baseMetadata,
              hasAlignmentData:
                includeAlignment && scriptures[0]?.alignment !== undefined,
            },
          }
        : {
            scriptures,
            metadata: {
              ...baseMetadata,
              hasAlignmentData:
                includeAlignment &&
                scriptures.some((s) => s.alignment !== undefined),
            },
          };

    logger.info(
      `📤 Returning scripture result with ${scriptures.length} translations`,
    );
    return result;
  }

  logger.info(`🚀 Starting fresh scripture fetch...`);
  const result = await fetchFreshScripture();
  logger.info(`✅ fetchScripture completed successfully`);
  return result;
}

/**
 * Extract raw USFM passage for format=usfm requests
 */
function extractUSFMPassage(
  usfm: string,
  reference: {
    book: string;
    chapter?: number;
    verse?: number;
    verseEnd?: number;
  },
): string {
  const chapterPattern = new RegExp(`\\\\c\\s+${reference.chapter}\\b`);
  const chapterSplit = usfm.split(chapterPattern);

  if (chapterSplit.length < 2) {
    return "";
  }

  let chapterContent = chapterSplit[1];

  // Find next chapter to limit scope
  const nextChapterMatch = chapterContent.match(/\\c\s+\d+/);
  if (nextChapterMatch) {
    chapterContent = chapterContent.substring(0, nextChapterMatch.index);
  }

  if (reference.verse) {
    // Extract specific verse(s) with USFM markup
    const versePattern = new RegExp(`\\\\v\\s+${reference.verse}\\b`);
    const verseSplit = chapterContent.split(versePattern);

    if (verseSplit.length < 2) {
      return "";
    }

    let verseContent = verseSplit[1];

    if (reference.verseEnd) {
      // Find end verse
      const endVersePattern = new RegExp(
        `\\\\v\\s+${reference.verseEnd + 1}\\b`,
      );
      const endMatch = verseContent.match(endVersePattern);
      if (endMatch) {
        verseContent = verseContent.substring(0, endMatch.index);
      }
    } else {
      // Single verse - find next verse marker
      const nextVerseMatch = verseContent.match(/\\v\s+\d+/);
      if (nextVerseMatch) {
        verseContent = verseContent.substring(0, nextVerseMatch.index);
      }
    }

    return `\\c ${reference.chapter}\n\\v ${reference.verse}${verseContent}`.trim();
  } else {
    // Return full chapter with USFM markup
    return `\\c ${reference.chapter}${chapterContent}`.trim();
  }
}
