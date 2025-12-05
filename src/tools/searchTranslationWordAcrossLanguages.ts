/**
 * Search Translation Word Across Languages Tool
 * Searches for a translation word term across multiple languages to discover
 * which languages have that term available.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import { discoverLanguageOrgs } from "../functions/discover-language-orgs.js";
import { mapLanguageToCatalogCode } from "../utils/language-mapping.js";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { EdgeXRayTracer } from "../functions/edge-xray.js";
import * as os from "os";
import * as path from "path";

// Input schema
export const SearchTranslationWordAcrossLanguagesArgs = z.object({
  term: z
    .string()
    .describe(
      'Translation word term to search for (e.g., "amor", "love", "grace")',
    ),
  languages: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of language codes to search. If not provided, searches all available languages.",
    ),
  organization: z
    .string()
    .optional()
    .default("unfoldingWord")
    .describe("Organization to search within"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum number of languages to search (for performance)"),
});

export type SearchTranslationWordAcrossLanguagesArgs = z.infer<
  typeof SearchTranslationWordAcrossLanguagesArgs
>;

interface LanguageResult {
  language: string;
  organization: string;
  found: boolean;
  title?: string;
  category?: string;
  rcLink?: string;
  error?: string;
}

/**
 * Handle the search translation word across languages tool call
 */
export async function handleSearchTranslationWordAcrossLanguages(
  args: SearchTranslationWordAcrossLanguagesArgs,
) {
  const startTime = Date.now();

  try {
    logger.info("Searching translation word across languages", {
      term: args.term,
      organization: args.organization,
    });

    // Normalize the term
    const normalizedTerm = args.term.toLowerCase().replace(/\s+/g, "");

    // Get list of available languages
    let languagesToSearch: string[] = [];

    if (args.languages && args.languages.length > 0) {
      // Use provided languages
      languagesToSearch = args.languages.map((lang) =>
        mapLanguageToCatalogCode(lang),
      );
    } else {
      // Discover available languages
      const discoveryResult = await discoverLanguageOrgs();
      languagesToSearch = Array.from(discoveryResult.languages.keys())
        .slice(0, args.limit || 20) // Limit for performance
        .map((lang) => mapLanguageToCatalogCode(lang));
    }

    logger.info(`Searching ${languagesToSearch.length} languages`, {
      languages: languagesToSearch,
    });

    // Initialize ZIP fetcher
    const tracer = new EdgeXRayTracer(
      "mcp-tool",
      "search_translation_word_across_languages",
    );
    const providerName = process.env.ZIP_FETCHER_PROVIDER || "auto";
    const cacheDir =
      typeof process !== "undefined" && process.env.CACHE_PATH
        ? process.env.CACHE_PATH
        : path.join(os.homedir(), ".translation-helps-mcp", "cache");

    const zipFetcher = ZipFetcherFactory.create(providerName, cacheDir, tracer);

    // Search for the term in each language
    const results: LanguageResult[] = [];
    const searchPromises = languagesToSearch.map(async (language) => {
      try {
        // Try to fetch the translation word for this language
        const result = await zipFetcher.getMarkdownContent(
          language,
          args.organization || "unfoldingWord",
          "tw",
          normalizedTerm,
        );

        // Check if we got a valid result
        const articles = Array.isArray((result as any).articles)
          ? (result as any).articles
          : [];

        if (articles.length > 0) {
          const article = articles[0];
          return {
            language,
            organization: args.organization || "unfoldingWord",
            found: true,
            title: article.title,
            category: article.category,
            rcLink: article.rcLink,
          } as LanguageResult;
        } else {
          return {
            language,
            organization: args.organization || "unfoldingWord",
            found: false,
          } as LanguageResult;
        }
      } catch (error) {
        // Term not found in this language (this is expected for most languages)
        return {
          language,
          organization: args.organization || "unfoldingWord",
          found: false,
          error: error instanceof Error ? error.message : String(error),
        } as LanguageResult;
      }
    });

    // Wait for all searches to complete
    const searchResults = await Promise.all(searchPromises);

    // Filter to only languages where the term was found
    const foundLanguages = searchResults.filter((result) => result.found);

    logger.info(`Found term in ${foundLanguages.length} languages`, {
      term: args.term,
      foundCount: foundLanguages.length,
    });

    // Build metadata
    const metadata = buildMetadata({
      startTime,
      data: { results: searchResults },
      serviceMetadata: {
        term: args.term,
        languagesSearched: languagesToSearch.length,
        languagesFound: foundLanguages.length,
      },
    });

    const response = {
      term: args.term,
      results: foundLanguages,
      summary: {
        totalLanguagesSearched: languagesToSearch.length,
        languagesFound: foundLanguages.length,
        languages: foundLanguages.map((r) => r.language),
      },
      metadata,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return handleMCPError({
      toolName: "search_translation_word_across_languages",
      args: {
        term: args.term,
        languages: args.languages,
        organization: args.organization,
      },
      startTime,
      originalError: error,
    });
  }
}
