/**
 * Translation Questions Service
 * Fetches translation questions from DCS (Door43 Content Service)
 * Uses unified resource discovery to minimize DCS API calls
 */

import { proxyFetch } from "../utils/httpClient.js";
import { logger } from "../utils/logger.js";
import { cache } from "./cache";
import { parseReference } from "./reference-parser";
import { getResourceForBook, getResourcesForBook } from "./resource-detector";
import { ZipFetcherFactory } from "../services/zip-fetcher-provider.js";
import { EdgeXRayTracer } from "./edge-xray";

export interface TranslationQuestion {
  id: string;
  reference: string;
  question: string;
  response: string;
  tags?: string[];
  citation?: {
    resource: string;
    title?: string; // Dynamic title from DCS catalog
    organization: string;
    language: string;
    version: string;
    url: string;
  };
}

export interface TranslationQuestionsOptions {
  reference: string;
  language?: string;
  organization?: string;
  topic?: string;
}

export interface TranslationQuestionsResult {
  translationQuestions: TranslationQuestion[];
  citation?: {
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  };
  citations?: Array<{
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  }>;
  metadata: {
    responseTime: number;
    cached: boolean;
    timestamp: string;
    questionsFound: number;
    totalResources?: number;
    organizations?: string[];
    subject?: string; // From DCS catalog (e.g., "TSV Translation Questions")
  };
}

/**
 * Parse TSV data into TranslationQuestion objects
 */
function parseTQFromTSV(
  tsvData: string,
  reference: ParsedReference,
): TranslationQuestion[] {
  const lines = tsvData.split("\n").filter((line) => line.trim());
  const questions: TranslationQuestion[] = [];
  let questionId = 1;

  // Log first few lines for debugging
  if (lines.length > 0) {
    logger.debug(`📋 First TSV line`, { line: lines[0] });
    logger.debug(
      `📋 Parsing questions for ${reference.book} ${reference.chapter}:${reference.verse || "*"}`,
    );
  }

  for (const line of lines) {
    const columns = line.split("\t");
    if (columns.length < 7) continue; // Skip malformed lines

    // TSV format: reference, id, tags, quote, occurrence, question, response
    const [ref, id, tags, , , question, response] = columns;

    // Parse the reference (e.g., "1:1" -> chapter 1, verse 1)
    const refMatch = ref.match(/^(\d+):(\d+)$/);
    if (!refMatch) continue;

    const chapter = parseInt(refMatch[1]);
    const verse = parseInt(refMatch[2]);

    // Only include questions for the requested reference
    if (chapter === reference.chapter) {
      // Handle verse ranges and exact matches
      if (reference.verse === undefined) {
        // Include all verses in the chapter
        questions.push({
          id: id || `tq-${reference.book}-${chapter}-${verse}-${questionId++}`,
          reference: `${reference.bookName} ${chapter}:${verse}`,
          question: question.trim(),
          response: response.trim(),
          tags: tags ? tags.split(",").map((t) => t.trim()) : [],
        });
      } else {
        // Check verse range or exact match
        const endVerse = reference.endVerse || reference.verseEnd;
        if (endVerse) {
          // Check if verse is within range
          if (verse >= reference.verse && verse <= endVerse) {
            questions.push({
              id:
                id ||
                `tq-${reference.book}-${chapter}-${verse}-${questionId++}`,
              reference: `${reference.bookName} ${chapter}:${verse}`,
              question: question.trim(),
              response: response.trim(),
              tags: tags ? tags.split(",").map((t) => t.trim()) : [],
            });
          }
        } else {
          // Exact verse match
          if (verse === reference.verse) {
            questions.push({
              id:
                id ||
                `tq-${reference.book}-${chapter}-${verse}-${questionId++}`,
              reference: `${reference.bookName} ${chapter}:${verse}`,
              question: question.trim(),
              response: response.trim(),
              tags: tags ? tags.split(",").map((t) => t.trim()) : [],
            });
          }
        }
      }
    }
  }

  return questions;
}

interface ParsedReference {
  book: string;
  bookName?: string;
  chapter: number;
  verse?: number;
  endVerse?: number;
  verseEnd?: number;
}

/**
 * Fetch translation questions from multiple resources (all organizations)
 */
async function fetchTranslationQuestionsFromMultipleResources(
  reference: string,
  language: string,
  parsedRef: any,
  topic: string,
  startTime: number,
): Promise<TranslationQuestionsResult> {
  logger.info(`Fetching translation questions from multiple resources`);

  const resources = await getResourcesForBook(
    reference,
    "questions",
    language,
    undefined, // Get ALL organizations
    topic,
  );

  if (!resources || resources.length === 0) {
    // Try to find language variants to help the user
    const { findLanguageVariants } = await import('./resource-detector.js');
    const baseLanguage = language.split('-')[0];
    // For translation questions, search the correct subject
    const languageVariants = await findLanguageVariants(baseLanguage, 'all', topic, ['TSV Translation Questions']);
    
    // Create structured error with recovery data
    const error: any = new Error(
      languageVariants.length > 0
        ? `No translation questions found for language '${language}'.\n\nAvailable language variants: ${languageVariants.join(', ')}\n\nPlease try one of these language codes instead.`
        : `No translation questions available for language '${language}'.`
    );
    
    // Attach structured data for automatic retry
    if (languageVariants.length > 0) {
      error.languageVariants = languageVariants;
      error.requestedLanguage = language;
      logger.info('Throwing language variant error for translation questions', {
        language,
        variants: languageVariants
      });
    } else {
      error.requestedLanguage = language;
      logger.info('Throwing language not supported error for translation questions', {
        language
      });
    }
    
    throw error;
  }

  logger.info(`Found ${resources.length} question resources from multiple organizations`);

  const allQuestions: TranslationQuestion[] = [];
  const citations: Array<{
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  }> = [];
  let resourceSubject: string | undefined; // Capture subject from first resource

  // Fetch questions from each resource
  for (const resourceInfo of resources) {
    try {
      logger.info(`Fetching questions from resource`, {
        name: resourceInfo.name,
        owner: resourceInfo.owner,
      });

      // Find the correct file from ingredients
      const ingredient = resourceInfo.ingredients?.find(
        (ing: { identifier?: string }) =>
          ing.identifier?.toLowerCase() === parsedRef.book.toLowerCase(),
      );

      if (!ingredient) {
        logger.warn(`Book not found in ingredients for resource`, {
          resource: resourceInfo.name,
          book: parsedRef.book,
        });
        continue;
      }

      // Use ZIP-based fetching
      const tracer = new EdgeXRayTracer(
        `tq-multi-${Date.now()}`,
        "translation-questions-service",
      );
      const zipFetcherProvider = ZipFetcherFactory.create(
        (process.env.ZIP_FETCHER_PROVIDER as "r2" | "fs" | "auto") ||
          "auto",
        process.env.CACHE_PATH,
        tracer,
      );

      const tsvResult = await zipFetcherProvider.getTSVData(
        {
          book: parsedRef.book,
          chapter: parsedRef.chapter!,
          verse: parsedRef.verse,
          endVerse: parsedRef.endVerse,  // Include endVerse for verse ranges
        },
        language,
        resourceInfo.owner || "unfoldingWord",
        "tq",
      );
      const rows = tsvResult.data as Array<Record<string, string>>;
      
      // Capture subject from first successful resource
      if (!resourceSubject && tsvResult.subject) {
        resourceSubject = tsvResult.subject;
        logger.info(`[Multi-resource] Captured subject from catalog: ${resourceSubject}`);
      }

      logger.info(`Fetched ${rows.length} TSV rows from ${resourceInfo.name}`);

      // Create citation for this resource
      const resourceCitation = {
        resource: resourceInfo.name,
        title: resourceInfo.title, // ✅ FROM DCS CATALOG
        organization: resourceInfo.owner || "unfoldingWord",
        language,
        url: resourceInfo.url || `https://git.door43.org/${resourceInfo.owner}/${resourceInfo.name}`,
        version: tsvResult.version || "master", // ✅ FROM DCS CATALOG
      };
      citations.push(resourceCitation);

      // Convert rows to TranslationQuestion format with citations
      const questions: TranslationQuestion[] = rows.map((row) => ({
        id: row.ID || row.Id || "",
        reference: row.Reference || row.reference || "",
        question: row.Question || row.question || "",
        response: row.Response || row.response || "",
        tags:
          row.Tags || row.tags
            ? (row.Tags || row.tags).split(",").map((t) => t.trim())
            : undefined,
        citation: {
          resource: resourceInfo.name,
          title: resourceInfo.title, // ✅ FROM DCS CATALOG
          organization: resourceInfo.owner || "unfoldingWord",
          language,
          version: tsvResult.version || "master", // ✅ FROM DCS CATALOG
          url: resourceCitation.url,
        },
      }));

      allQuestions.push(...questions);
    } catch (error) {
      logger.error(`Failed to fetch questions from resource`, {
        resource: resourceInfo.name,
        error: String(error),
      });
      // Continue with other resources
    }
  }

  const organizations = Array.from(
    new Set(citations.map((c) => c.organization)),
  );

  return {
    translationQuestions: allQuestions,
    citations,
    metadata: {
      responseTime: Date.now() - startTime,
      cached: false,
      timestamp: new Date().toISOString(),
      questionsFound: allQuestions.length,
      totalResources: resources.length,
      organizations,
      subject: resourceSubject, // ✅ FROM DCS CATALOG
    },
  };
}

/**
 * Core translation questions fetching logic with unified resource discovery
 */
export async function fetchTranslationQuestions(
  options: TranslationQuestionsOptions,
): Promise<TranslationQuestionsResult> {
  const startTime = Date.now();
  const {
    reference,
    language = "en",
    organization, // No longer defaults to unfoldingWord
    topic = "tc-ready",
  } = options;

  const parsedRef = parseReference(reference);
  if (!parsedRef) {
    throw new Error(`Invalid reference format: ${reference}`);
  }

  logger.info(`Core translation questions service called`, {
    reference,
    language,
    organization: organization || "all",
    topic,
  });

  // If organization is undefined, fetch from ALL organizations
  if (!organization) {
    return fetchTranslationQuestionsFromMultipleResources(
      reference,
      language,
      parsedRef,
      topic,
      startTime,
    );
  }

  // Otherwise, use the existing single-organization logic
  logger.info(`Processing fresh questions request for single organization`);

  // 🚀 OPTIMIZATION: Use unified resource discovery instead of separate catalog search
  logger.debug(`Using unified resource discovery for translation questions...`);
  const resourceInfo = await getResourceForBook(
    reference,
    "questions",
    language,
    organization,
    topic,
  );

  if (!resourceInfo) {
    // Try to find language variants to help the user
    const { findLanguageVariants } = await import('./resource-detector.js');
    const baseLanguage = language.split('-')[0];
    // For translation questions, search the correct subject (search all orgs for variants)
    const languageVariants = await findLanguageVariants(baseLanguage, organization === 'unfoldingWord' ? undefined : organization, topic, ['TSV Translation Questions']);

    // Filter out the current language to prevent infinite retry loops
    const filteredVariants = languageVariants.filter(v => v !== language);

    // Create structured error with recovery data
    const error: any = new Error(
      filteredVariants.length > 0
        ? `No translation questions found for language '${language}'.\n\nAvailable language variants: ${filteredVariants.join(', ')}\n\nPlease try one of these language codes instead.`
        : `No translation questions available for language '${language}'.`
    );

    // Attach structured data for automatic retry
    if (filteredVariants.length > 0) {
      error.languageVariants = filteredVariants;
      error.requestedLanguage = language;
      logger.info('Throwing language variant error for translation questions (single org)', {
        language,
        variants: filteredVariants,
        organization
      });
    } else {
      error.requestedLanguage = language;
      logger.info('Throwing language not supported error for translation questions (single org)', {
        language,
        organization
      });
    }

    throw error;
  }

  logger.info(`Using resource`, {
    name: resourceInfo.name,
    title: resourceInfo.title,
  });
  logger.debug(`Looking for book`, {
    book: parsedRef.book,
    lower: parsedRef.book.toLowerCase(),
  });
  logger.debug(`Ingredients available`, {
    ingredients: resourceInfo.ingredients?.map(
      (i: { identifier?: string }) => i.identifier,
    ),
  });

  // Find the correct file from ingredients
  const ingredient = resourceInfo.ingredients?.find(
    (ing: { identifier?: string }) =>
      ing.identifier?.toLowerCase() === parsedRef.book.toLowerCase(),
  );

  if (!ingredient) {
    logger.error(`Book not found in ingredients`, {
      book: parsedRef.book,
      ingredients: resourceInfo.ingredients,
    });
    throw new Error(
      `Book ${parsedRef.book} not found in resource ${resourceInfo.name}`,
    );
  }

  // Use ZIP-based fetching via ZipFetcherFactory (pluggable system)
  const tracer = new EdgeXRayTracer(
    `tq-${Date.now()}`,
    "translation-questions-service",
  );
  const zipFetcherProvider = ZipFetcherFactory.create(
    (options.zipFetcherProvider as "r2" | "fs" | "auto") ||
      (process.env.ZIP_FETCHER_PROVIDER as "r2" | "fs" | "auto") ||
      "auto",
    process.env.CACHE_PATH,
    tracer,
  );

  // Get TSV rows from ZIP (already parsed and filtered by reference)
  const tsvResult = await zipFetcherProvider.getTSVData(
    {
      book: parsedRef.book,
      chapter: parsedRef.chapter!,
      verse: parsedRef.verse,
      endVerse: parsedRef.endVerse,  // Include endVerse for verse ranges
    },
    language,
    organization,
    "tq",
  );
  const rows = tsvResult.data as Array<Record<string, string>>;
  const resourceSubject = tsvResult.subject; // ✅ FROM DCS CATALOG
  const resourceVersion = tsvResult.version; // ✅ FROM DCS CATALOG

  logger.info(`Fetched TSV rows from ZIP`, { count: rows.length, subject: resourceSubject, version: resourceVersion });

  // Convert rows to TranslationQuestion format
  // The rows are already filtered by reference, so we just need to map them
  const questions: TranslationQuestion[] = rows.map((row) => {
    const question: TranslationQuestion = {
      id: row.ID || row.Id || "",
      reference: row.Reference || row.reference || "",
      question: row.Question || row.question || "",
      response: row.Response || row.response || "",
      tags:
        row.Tags || row.tags
          ? (row.Tags || row.tags).split(",").map((t) => t.trim())
          : undefined,
    };
    return question;
  });

  logger.info(`Parsed translation questions`, { count: questions.length });

  const result: TranslationQuestionsResult = {
    translationQuestions: questions,
    citation: {
      resource: resourceInfo.name,
      organization,
      language,
      url:
        resourceInfo.url ||
        `https://git.door43.org/${organization}/${resourceInfo.name}`,
      version: resourceVersion || "master", // ✅ FROM DCS CATALOG
    },
    metadata: {
      responseTime: Date.now() - startTime,
      cached: false,
      timestamp: new Date().toISOString(),
      questionsFound: questions.length,
      subject: resourceSubject, // ✅ FROM DCS CATALOG
    },
  };

  // Do not cache transformed responses

  logger.info(`Parsed translation questions`, { count: questions.length });

  return result;
}
