/**
 * Word Links Service
 * Shared core implementation for fetching translation word links
 * Used by both Netlify functions and MCP tools for consistency
 */

import { EdgeXRayTracer } from "../functions/edge-xray";
import { parseReference } from "../parsers/referenceParser";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { logger } from "../utils/logger.js";
import { cache } from "./cache";

export interface TranslationWordLink {
  word: string;
  occurrences: number;
  twlid: string;
  reference?: string;
  id?: string;
  tags?: string;
  origWords?: string;
  occurrence?: number;
}

export interface WordLinksOptions {
  reference: string;
  language?: string;
  organization?: string;
}

export interface WordLinksResult {
  translationWordLinks: TranslationWordLink[];
  citation: {
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  };
  metadata: {
    responseTime: number;
    cached: boolean;
    timestamp: string;
    linksFound: number;
    subject?: string; // From DCS catalog (e.g., "TSV Translation Words Links")
  };
}

/**
 * Core word links fetching logic
 */
export async function fetchWordLinks(
  options: WordLinksOptions,
): Promise<WordLinksResult> {
  const startTime = Date.now();
  const {
    reference: referenceParam,
    language = "en",
    organization = "unfoldingWord",
  } = options;

  logger.info(`Core word links service called`, {
    reference: referenceParam,
    language,
    organization,
  });

  // Parse the reference
  const reference = parseReference(referenceParam);
  if (!reference) {
    throw new Error(`Invalid reference format: ${referenceParam}`);
  }

  // NEVER cache responses - only cache data sources
  // Removed response caching per CRITICAL_NEVER_CACHE_RESPONSES.md
  const responseKey = `wordlinks:${referenceParam}:${language}:${organization}`;

  logger.info(`Processing fresh word links request`, { key: responseKey });

  // Use ZIP + ingredients path via ZipFetcherFactory (pluggable system)
  const tracer = new EdgeXRayTracer(`twl-${Date.now()}`, "word-links-service");
  const zipFetcherProvider = ZipFetcherFactory.create(
    (options.zipFetcherProvider as "r2" | "fs" | "auto") ||
      (process.env.ZIP_FETCHER_PROVIDER as "r2" | "fs" | "auto") ||
      "auto",
    process.env.CACHE_PATH,
    tracer,
  );
  
  let tsvResult;
  try {
    tsvResult = await zipFetcherProvider.getTSVData(
      {
        book: reference.book,
        chapter: reference.chapter!,
        verse: reference.verse,
        endVerse: reference.endVerse,  // Include endVerse for verse ranges
      },
      language,
      organization,
      "twl",
    );
  } catch (error: any) {
    // Try to find language variants to help the user
    const { findLanguageVariants } = await import('./resource-detector.js');
    const baseLanguage = language.split('-')[0];
    // For translation word links, search the correct subject
    const languageVariants = await findLanguageVariants(baseLanguage, organization === 'unfoldingWord' ? undefined : organization, 'tc-ready', ['Translation Word Links']);
    
    // Create structured error with recovery data
    const enhancedError: any = new Error(
      languageVariants.length > 0
        ? `No translation word links found for language '${language}'.\n\nAvailable language variants: ${languageVariants.join(', ')}\n\nPlease try one of these language codes instead.`
        : `No translation word links available for language '${language}'.`
    );
    
    // Attach structured data for automatic retry
    if (languageVariants.length > 0) {
      enhancedError.languageVariants = languageVariants;
      enhancedError.requestedLanguage = language;
      logger.info('Throwing language variant error for translation word links', {
        language,
        variants: languageVariants
      });
    } else {
      enhancedError.requestedLanguage = language;
      logger.info('Throwing language not supported error for translation word links', {
        language
      });
    }
    
    throw enhancedError;
  }
  
  const rows = tsvResult.data as any[];
  const resourceSubject = tsvResult.subject; // ✅ FROM DCS CATALOG
  const resourceVersion = tsvResult.version; // ✅ FROM DCS CATALOG

  // Map rows into expected pass-through structure (preserve fields)
  const wordLinks = (rows || []).map((row) => ({ ...row }));
  logger.info(`Parsed word links from ZIP`, { count: wordLinks.length, subject: resourceSubject, version: resourceVersion });

  // Return the raw TSV structure without transformation
  const result = {
    links: wordLinks, // Direct TSV structure, no renaming
    citation: {
      resource: `${language}_twl`,
      organization,
      language,
      url: `https://git.door43.org/${organization}/${language}_twl`,
      version: resourceVersion || "master", // ✅ FROM DCS CATALOG
    },
    metadata: {
      responseTime: Date.now() - startTime,
      cached: false,
      timestamp: new Date().toISOString(),
      linksFound: wordLinks.length,
      subject: resourceSubject, // ✅ FROM DCS CATALOG
    },
  };

  // NEVER cache responses - only cache data sources
  // Removed response caching per CRITICAL_NEVER_CACHE_RESPONSES.md

  return result;
}

/**
 * Parse word links from TSV data for a specific reference - using automatic parsing
 */
// Note: TSV parsing now handled in ZipResourceFetcher2.getTSVData
