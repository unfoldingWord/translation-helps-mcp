/**
 * PromptFormatter — converts translation bundles and RAG results into
 * structured LLM-ready prompts.
 *
 * Ported from src/services/PromptFormatter.ts and updated to work with
 * the new Bundle type from BundleCache.ts and QueryResult from RagService.ts.
 *
 * Templates:
 *   - "translation" — full bundle → system + user message pair
 *   - "notes"       — notes only
 *   - "analysis"    — structured analysis prompt
 *   - "default"     — plain text dump
 */

import type { Bundle } from "./BundleCache.js";
import type { QueryResult } from "./RagService.js";

export type PromptTemplate =
  | "default"
  | "translation"
  | "notes"
  | "analysis"
  | "chat";

export interface FormatOptions {
  template?: PromptTemplate;
  maxDocuments?: number;
  maxNotes?: number;
  maxArticles?: number;
  includeSources?: boolean;
  userPrompt?: string;
}

export interface FormattedPrompt {
  systemPrompt: string;
  userPrompt: string;
}

const SYSTEM_BASE = `You are a Bible translation assistant. You help translators \
understand passages, translate accurately, and apply linguistic and cultural insights. \
Respond concisely in English unless the user writes in another language. \
Cite sources from the provided context using [Source: path] markers.`;

export class PromptFormatter {
  formatBundle(bundle: Bundle, opts: FormatOptions = {}): FormattedPrompt {
    const maxNotes = opts.maxNotes ?? 10;
    const maxArticles = opts.maxArticles ?? 5;

    let context = "";

    if (bundle.scripture.text) {
      context += `## Scripture Text (${bundle.metadata.reference})\n\`\`\`\n${bundle.scripture.text}\n\`\`\`\n\n`;
    }

    if (bundle.notes.length > 0) {
      context += `## Translation Notes (${bundle.notes.length})\n`;
      bundle.notes.slice(0, maxNotes).forEach((note) => {
        context += `- [${note.id}] ${note.text}\n`;
      });
      context += "\n";
    }

    if (bundle.tw.length > 0) {
      context += `## Key Translation Words (${bundle.tw.length})\n`;
      bundle.tw.slice(0, maxArticles).forEach((tw) => {
        context += `- **${tw.title}** [Source: ${tw.path}]\n`;
      });
      context += "\n";
    }

    if (bundle.ta.length > 0) {
      context += `## Translation Academy Articles (${bundle.ta.length})\n`;
      bundle.ta.slice(0, maxArticles).forEach((ta) => {
        context += `- **${ta.title}** [Source: ${ta.path}]\n`;
      });
      context += "\n";
    }

    const systemPrompt = `${SYSTEM_BASE}\n\n${context}`;
    const userPrompt =
      opts.userPrompt ??
      `Please provide translation help for ${bundle.metadata.reference} in ${bundle.metadata.language}.`;

    return { systemPrompt, userPrompt };
  }

  formatQueryResult(
    result: QueryResult,
    opts: FormatOptions = {},
  ): FormattedPrompt {
    const maxDocs = opts.maxDocuments ?? 10;
    let context = `## RAG Results for "${result.query}"\n\n`;

    result.documents.slice(0, maxDocs).forEach((doc, i) => {
      const meta = doc.document.metadata;
      context += `${i + 1}. [${String(meta["resourceType"] ?? "?").toUpperCase()}] `;
      context += `${doc.document.text.slice(0, 200)}`;
      if (opts.includeSources) {
        context += ` [Source: ${String(meta["path"] ?? "")}]`;
      }
      context += "\n\n";
    });

    const systemPrompt = `${SYSTEM_BASE}\n\n${context}`;
    const userPrompt = opts.userPrompt ?? result.query;

    return { systemPrompt, userPrompt };
  }

  /**
   * Build a generation prompt for composeTranslationReport.
   */
  formatReport(
    bundle: Bundle,
    userPrompt: string,
    _opts: FormatOptions = {},
  ): FormattedPrompt {
    const { systemPrompt } = this.formatBundle(bundle, {
      userPrompt,
      template: "translation",
    });
    return { systemPrompt, userPrompt };
  }
}

export function createPromptFormatter(): PromptFormatter {
  return new PromptFormatter();
}
