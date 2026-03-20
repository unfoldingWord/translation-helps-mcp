/**
 * Translation Word Service
 * Core service for fetching individual translation word articles
 * Supports link (canonical), term, path, and rcLink parameters with smart fallback
 */

import { logger } from "../utils/logger.js";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { parseRCLink, extractTerm, isRCLink } from "../../ui/src/lib/rcLinkParser.js";
import type { EdgeXRayTracer } from "./edge-xray.js";

export interface TranslationWordArticleOptions {
  path: string;  // THE ONLY identifier - resource path (e.g., "bible/kt/love")
  language: string;
  organization: string | string[];
  category?: string;
  topic?: string;
}

export interface TranslationWordArticleResult {
  term: string;
  title: string;
  category: string;
  categoryName: string;
  definition: string;
  content: string;
  path: string;
  rcLink: string;
  language: string;
  organization: string;
  metadata: {
    source: string;
    resourceType: string;
    license: string;
  };
}

/**
 * Core function to fetch a single translation word article
 * Accepts entryLink which can be: RC link, path, or simple term
 */
export async function fetchTranslationWordArticle(
  options: TranslationWordArticleOptions,
  tracer?: EdgeXRayTracer,
): Promise<TranslationWordArticleResult> {
  const {
    entryLink,
    language,
    organization,
    category,
    topic,
  } = options;

  logger.info("Fetching translation word article", {
    entryLink,
    language,
    organization,
    topic,
  });

  // Determine ZIP fetcher provider
  const zipFetcherProvider = "auto";
  const cacheDir = undefined;

  const zipFetcher = ZipFetcherFactory.create(
    zipFetcherProvider,
    cacheDir,
    tracer,
  );
  logger.info(`📦 Using ZIP fetcher provider: ${zipFetcher.name}`);

  // Parse path to extract term and category
  // Path format: "bible/kt/love" or "bible/names/abraham"
  const pathParts = path.split('/');
  const finalTerm = pathParts[pathParts.length - 1]; // Last segment is the term
  const finalCategory = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : (category || 'kt');
  const finalPath = path + '.md'; // Add .md extension for file fetching

  if (!finalTerm) {
    throw new Error("Could not determine term from path");
  }

  logger.info("Resolved translation word parameters", {
    finalTerm,
    finalPath,
    finalCategory,
  });

  // Use ZipResourceFetcher2.getMarkdownContent directly
  const identifier = finalPath || finalTerm;
  let result;
  try {
    result = await zipFetcher.getMarkdownContent(
      language,
      typeof organization === "string" ? organization : organization[0],
      "tw",
      identifier,
      false, // forceRefresh
      topic, // Pass topic filter (reduces resource count)
    );
  } catch (error: any) {
    // Try to find language variants to help the user
    const { findLanguageVariants } = await import('./resource-detector.js');
    const baseLanguage = language.split('-')[0];
    const org = typeof organization === "string" ? organization : organization[0];
    // For translation words, search the correct subject
    const languageVariants = await findLanguageVariants(baseLanguage, org === 'unfoldingWord' ? undefined : org, topic, ['Translation Words']);
    
    // Create structured error with recovery data
    const enhancedError: any = new Error(
      languageVariants.length > 0
        ? `No translation word found for '${finalTerm}' in language '${language}'.\n\nAvailable language variants: ${languageVariants.join(', ')}\n\nPlease try one of these language codes instead.`
        : `Translation word '${finalTerm}' not available in language '${language}'.`
    );
    
    // Attach structured data for automatic retry
    if (languageVariants.length > 0) {
      enhancedError.languageVariants = languageVariants;
      enhancedError.requestedLanguage = language;
      enhancedError.requestedTerm = finalTerm;
      logger.info('Throwing language variant error for translation word', {
        term: finalTerm,
        language,
        variants: languageVariants
      });
    } else {
      enhancedError.requestedLanguage = language;
      enhancedError.requestedTerm = finalTerm;
      logger.info('Throwing language not supported error for translation word', {
        term: finalTerm,
        language
      });
    }
    
    throw enhancedError;
  }

  if (!result || typeof result !== "object") {
    throw new Error(`Translation word not found: ${finalTerm}`);
  }

  // getMarkdownContent returns { articles: [{ term, markdown, path }] }
  const twResult = result as {
    articles: Array<{ term: string; markdown: string; path: string }>;
    debug?: any;
  };

  if (!twResult.articles || twResult.articles.length === 0) {
    throw new Error(`Translation word not found: ${finalTerm}`);
  }

  // Get the first article
  const article = twResult.articles[0];
  const mdContent = article.markdown;

  // Parse markdown content for structured response
  const titleMatch = mdContent.match(/^#\s+(.+)$/m);
  const termTitle = titleMatch ? titleMatch[1].trim() : finalTerm;

  // Extract definition from markdown
  let definition = "";
  const defMatch = mdContent.match(
    /##\s*Definition:?\s*\n\n([\s\S]+?)(?=\n##|$)/i,
  );
  if (defMatch) {
    definition = defMatch[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ");
  } else {
    // Fallback: extract first paragraph after title
    const lines = mdContent.split("\n");
    let foundTitle = false;
    for (const line of lines) {
      if (line.startsWith("#") && !foundTitle) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && line.trim() && !line.startsWith("#")) {
        definition = line.trim();
        break;
      }
    }
  }

  // Extract category from path or use resolved category
  const categoryMatch = article.path?.match(/bible\/(kt|names|other)\//);
  const categoryKey = categoryMatch ? categoryMatch[1] : finalCategory || "other";
  const categoryNames: Record<string, string> = {
    kt: "Key Terms",
    names: "Names",
    other: "Other",
  };

  logger.info("Successfully fetched translation word article", {
    term: finalTerm,
    title: termTitle,
    category: categoryKey,
    contentLength: mdContent.length,
  });

  return {
    term: finalTerm,
    title: termTitle,
    category: categoryKey,
    categoryName: categoryNames[categoryKey] || "Other",
    definition,
    content: mdContent,
    path: article.path,
    rcLink: `rc://${language}/tw/dict/bible/${categoryKey}/${finalTerm}`,
    language,
    organization: typeof organization === "string" ? organization : organization[0],
    metadata: {
      source: "TW",
      resourceType: "tw",
      license: "CC BY-SA 4.0",
    },
  };
}
