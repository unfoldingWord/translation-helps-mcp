/**
 * Translation Academy Service
 * Core service function for fetching translation academy modules
 */

import {
  DEFAULT_STRATEGIC_LANGUAGE,
  Organization,
} from "../constants/terminology.js";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { EdgeXRayTracer } from "./edge-xray.js";
import {
  parseTranslationAcademyRCLink,
  isTranslationAcademyRCLink,
} from "../../ui/src/lib/rcLinkParser.js";
import os from "os";
import nodePath from "path";
import { logger } from "../utils/logger.js";

export interface TranslationAcademyOptions {
  path: string;  // THE ONLY identifier - resource path (e.g., "translate/figs-metaphor")
  language?: string;
  organization?: string | string[];
  topic?: string;
  zipFetcherProvider?: string;
}

export interface TranslationAcademyResult {
  content: string;
  metadata?: {
    language: string;
    organization: string;
    moduleId?: string;
    path?: string;
  };
}

/**
 * Core translation academy fetching logic
 */
export async function fetchTranslationAcademy(
  options: TranslationAcademyOptions,
): Promise<TranslationAcademyResult> {
  const startTime = Date.now();
  const {
    path: resourcePath,
    language = DEFAULT_STRATEGIC_LANGUAGE,
    organization = Organization.UNFOLDING_WORD,
    zipFetcherProvider = process.env.ZIP_FETCHER_PROVIDER || "auto",
    topic,
  } = options;

  logger.info("Fetching translation academy content", {
    path: resourcePath,
    language,
    organization,
    topic,
  });

  const tracer = new EdgeXRayTracer(`ta-service-${Date.now()}`, "service-ta");

  const cacheDir =
    typeof process !== "undefined" && process.env.CACHE_PATH
      ? process.env.CACHE_PATH
      : nodePath.join(os.homedir(), ".translation-helps-mcp", "cache");

  const zipFetcher = ZipFetcherFactory.create(
    zipFetcherProvider,
    cacheDir,
    tracer,
  );
  logger.info(`📦 Using ZIP fetcher provider: ${zipFetcher.name}`);

  // Path is now clean and direct (e.g., "translate/figs-metaphor")
  // No format detection needed!
  if (!resourcePath) {
    throw new Error("Path parameter is required");
  }

  // Use ZipResourceFetcher2.getMarkdownContent directly
  let result;
  try {
    result = await zipFetcher.getMarkdownContent(
      language,
      typeof organization === "string" ? organization : organization[0],
      "ta",
      resourcePath,
      false, // forceRefresh
      topic, // Pass topic filter (reduces resource count)
    );
  } catch (error: any) {
    // Try to find language variants to help the user
    const { findLanguageVariants } = await import('./resource-detector.js');
    const baseLanguage = language.split('-')[0];
    const org = typeof organization === "string" ? organization : organization[0];
    // For translation academy, search the correct subject
    const languageVariants = await findLanguageVariants(baseLanguage, org === 'unfoldingWord' ? undefined : org, topic, ['Translation Academy']);
    
    // Create structured error with recovery data
    const enhancedError: any = new Error(
      languageVariants.length > 0
        ? `Translation Academy article '${resourcePath}' not found in language '${language}'.\n\nAvailable language variants: ${languageVariants.join(', ')}\n\nPlease try one of these language codes instead.`
        : `Translation Academy article '${resourcePath}' not available in language '${language}'.`
    );
    
    // Attach structured data for automatic retry
    if (languageVariants.length > 0) {
      enhancedError.languageVariants = languageVariants;
      enhancedError.requestedLanguage = language;
      enhancedError.requestedPath = resourcePath;
      logger.info('Throwing language variant error for translation academy', {
        path: resourcePath,
        language,
        variants: languageVariants
      });
    } else {
      enhancedError.requestedLanguage = language;
      enhancedError.requestedPath = resourcePath;
      logger.info('Throwing language not supported error for translation academy', {
        path: resourcePath,
        language
      });
    }
    
    throw enhancedError;
  }

  logger.info("Successfully fetched translation academy content", {
    language,
    organization,
    path: resourcePath,
    elapsed: Date.now() - startTime,
  });

  return {
    content: result.content,
    metadata: {
      language,
      organization:
        typeof organization === "string" ? organization : organization[0],
      entryLink,
      path: finalPath,
    },
  };
}
