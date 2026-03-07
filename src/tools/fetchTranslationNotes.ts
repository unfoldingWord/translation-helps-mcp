/**
 * Fetch Translation Notes Tool
 * Tool for fetching translation notes for a specific Bible reference
 * Uses shared core service for consistency with Netlify functions
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { fetchTranslationNotes } from "../functions/translation-notes-service.js";
import { buildMetadata } from "../utils/metadata-builder.js";
import { handleMCPError } from "../utils/mcp-error-handler.js";
import {
  ReferenceParam,
  LanguageParam,
  OrganizationParam,
  IncludeIntroParam,
  IncludeContextParam,
  FormatParam,
  TopicParam,
} from "../schemas/common-params.js";

// Input schema - using shared common parameters
export const FetchTranslationNotesArgs = z.object({
  reference: ReferenceParam,
  language: LanguageParam,
  organization: OrganizationParam,
  includeIntro: IncludeIntroParam,
  includeContext: IncludeContextParam,
  format: FormatParam,
  topic: TopicParam,
});

export type FetchTranslationNotesArgs = z.infer<
  typeof FetchTranslationNotesArgs
>;

/**
 * Handle the fetch translation notes tool call
 */
export async function handleFetchTranslationNotes(
  args: FetchTranslationNotesArgs,
) {
  const startTime = Date.now();

  try {
    logger.info("Fetching translation notes", {
      reference: args.reference,
      language: args.language,
      organization: args.organization,
      includeIntro: args.includeIntro,
      includeContext: args.includeContext,
    });

    // Use the shared translation notes service (same as Netlify functions)
    const result = await fetchTranslationNotes({
      reference: args.reference,
      language: args.language,
      organization: args.organization,
      includeIntro: args.includeIntro,
      includeContext: args.includeContext,
      topic: args.topic,
    });

    // Build metadata using shared utility
    const metadata = buildMetadata({
      startTime,
      data: result,
      serviceMetadata: result.metadata,
      additionalFields: {
        verseNotesCount: result.metadata.verseNotesCount,
        contextNotesCount: result.metadata.contextNotesCount,
        totalNotesCount: result.metadata.sourceNotesCount,
      },
    });

    // Build enhanced response format for MCP
    const response = {
      verseNotes: result.verseNotes,
      contextNotes: result.contextNotes,
      translationNotes: result.translationNotes, // Keep original for backward compatibility
      ...(result.citations && { citations: result.citations }), // Include citations array if present
      ...(result.citation && !result.citations && { citation: result.citation }), // Single citation if no array
      language: args.language,
      ...(args.organization && { organization: args.organization }), // Only include if specified
      ...(result.metadata.organizations && {
        organizations: result.metadata.organizations,
      }), // Include organizations array
      metadata,
    };

    logger.info("Translation notes fetched successfully", {
      reference: args.reference,
      ...metadata,
    });

    return response;
  } catch (error) {
    return handleMCPError({
      toolName: "fetch_translation_notes",
      args: {
        reference: args.reference,
        language: args.language,
        organization: args.organization,
      },
      startTime,
      originalError: error,
    });
  }
}
