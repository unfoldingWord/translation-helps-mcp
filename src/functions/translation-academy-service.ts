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
import path from "path";
import { logger } from "../utils/logger.js";

export interface TranslationAcademyOptions {
  moduleId?: string;
  path?: string;
  rcLink?: string;
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
    moduleId,
    path: pathParam,
    rcLink,
    language = DEFAULT_STRATEGIC_LANGUAGE,
    organization = Organization.UNFOLDING_WORD,
    zipFetcherProvider = process.env.ZIP_FETCHER_PROVIDER || "auto",
  } = options;

  logger.info("Fetching translation academy content", {
    moduleId,
    path: pathParam,
    rcLink,
    language,
    organization,
  });

  const tracer = new EdgeXRayTracer(`ta-service-${Date.now()}`, "service-ta");

  const cacheDir =
    typeof process !== "undefined" && process.env.CACHE_PATH
      ? process.env.CACHE_PATH
      : path.join(os.homedir(), ".translation-helps-mcp", "cache");

  const zipFetcher = ZipFetcherFactory.create(
    zipFetcherProvider,
    cacheDir,
    tracer,
  );
  logger.info(`📦 Using ZIP fetcher provider: ${zipFetcher.name}`);

  // Priority: rcLink > path > moduleId
  let finalPath: string | undefined;

  if (rcLink || (moduleId && isTranslationAcademyRCLink(moduleId))) {
    const linkToParse = rcLink || moduleId;
    const parsed = parseTranslationAcademyRCLink(linkToParse!, language);
    if (!parsed.isValid) {
      throw new Error(`Invalid RC link: ${linkToParse}`);
    }
    finalPath = parsed.dirPath;
  } else if (pathParam) {
    finalPath = pathParam;
  }

  // Use ZipResourceFetcher2.getMarkdownContent directly
  const result = await zipFetcher.getMarkdownContent(
    language,
    typeof organization === "string" ? organization : organization[0],
    "ta",
    finalPath || moduleId,
  );

  logger.info("Successfully fetched translation academy content", {
    language,
    organization,
    moduleId,
    elapsed: Date.now() - startTime,
  });

  return {
    content: result.content,
    metadata: {
      language,
      organization:
        typeof organization === "string" ? organization : organization[0],
      moduleId,
      path: finalPath,
    },
  };
}
