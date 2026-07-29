/**
 * MCP Prompts — pre-built workflows for common translation tasks.
 *
 * Each prompt describes a multi-step tool chain that an LLM should follow.
 * Arguments use canonical parameter definitions (path, not term; canonical reference).
 */

import { z } from "zod";

export interface PromptModule {
  name: string;
  description: string;
  argsSchema: Record<string, z.ZodTypeAny>;
  handler(args: Record<string, string>): {
    messages: Array<{
      role: "user" | "assistant";
      content: { type: "text"; text: string };
    }>;
  };
}

const REFERENCE_ARG = z
  .string()
  .describe('Bible reference, e.g. "JHN 3:16", "MAT 5:3-12".');
const LANGUAGE_ARG = z
  .string()
  .default("en")
  .describe('BCP-47 language code, e.g. "en", "es", "es-419".');

export const PROMPTS: PromptModule[] = [
  {
    name: "translate_passage",
    description:
      "Get comprehensive translation help for a Bible passage: scripture text, notes, and key words.",
    argsSchema: {
      reference: REFERENCE_ARG,
      language: LANGUAGE_ARG,
    },
    handler({ reference, language = "en" }) {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Please help me translate ${reference} into ${language}.\n\n` +
                `Follow these steps:\n` +
                `1. Call get_passage with reference="${reference}", language="${language}" to retrieve scripture text.\n` +
                `2. Call get_passage_context for background notes and availability.\n` +
                `3. Call get_passage_index to survey translation notes and key terms.\n` +
                `4. Call get_note for full note bodies on difficult phrases.\n` +
                `5. Look up key terms with get_word_article using paths from the index.\n` +
                `6. Provide a translation strategy summary.`,
            },
          },
        ],
      };
    },
  },

  {
    name: "explain_translation_word",
    description:
      "Explain a Translation Word concept from a specific Bible passage.",
    argsSchema: {
      reference: REFERENCE_ARG,
      language: LANGUAGE_ARG,
    },
    handler({ reference, language = "en" }) {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Explain the key translation words at ${reference} (language: ${language}).\n\n` +
                `Steps:\n` +
                `1. Call get_passage_index with reference="${reference}", language="${language}".\n` +
                `2. For each key term path, call get_word_article with path=<wordPath>.\n` +
                `3. Summarize each word's definition and translation implications.`,
            },
          },
        ],
      };
    },
  },

  {
    name: "find_translation_principle",
    description:
      "Find a Translation Academy article about a translation principle or technique.",
    argsSchema: {
      topic: z
        .string()
        .describe(
          'Translation topic or concept, e.g. "figures of speech", "metaphor".',
        ),
      language: LANGUAGE_ARG,
    },
    handler({ topic, language = "en" }) {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Find Translation Academy articles about "${topic}" (language: ${language}).\n\n` +
                `Steps:\n` +
                `1. Call search_articles with query="${topic}", language="${language}", types="ta".\n` +
                `2. For the top result, call get_academy_article with the article path.\n` +
                `3. Summarize the key translation principles.`,
            },
          },
        ],
      };
    },
  },

  {
    name: "check_translation",
    description: "Use comprehension questions to verify a translation draft.",
    argsSchema: {
      reference: REFERENCE_ARG,
      language: LANGUAGE_ARG,
    },
    handler({ reference, language = "en" }) {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `Help check the translation of ${reference} (language: ${language}).\n\n` +
                `Steps:\n` +
                `1. Call get_questions with reference="${reference}", language="${language}".\n` +
                `2. Present each question and its expected answer.\n` +
                `3. Explain how to use these questions to validate a translation draft.`,
            },
          },
        ],
      };
    },
  },
];
