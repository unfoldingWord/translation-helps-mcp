#!/usr/bin/env node

/**
 * Translation Helps MCP Server
 * Model Context Protocol server for Bible translation resources
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Import tool handlers (still needed for tool execution)
import { handleFetchScripture } from "./tools/fetchScripture.js";
import { handleFetchTranslationNotes } from "./tools/fetchTranslationNotes.js";
import { handleFetchTranslationQuestions } from "./tools/fetchTranslationQuestions.js";
import { handleFetchTranslationWordLinks } from "./tools/fetchTranslationWordLinks.js";
import { handleFetchTranslationAcademy } from "./tools/fetchTranslationAcademy.js";
import { handleGetTranslationWord } from "./tools/getTranslationWord.js";
import { handleListLanguages } from "./tools/listLanguages.js";
import { handleListSubjects } from "./tools/listSubjects.js";
import { handleListResourcesForLanguage } from "./tools/listResourcesForLanguage.js";
import { logger } from "./utils/logger.js";
import { getVersion } from "./version.js";

// Import tool definitions from shared registry (single source of truth)
import { getMCPToolDefinitions } from "./mcp/tools-registry.js";

// Import prompt definitions from shared registry (single source of truth)
import { MCP_PROMPTS, getPromptTemplate } from "./mcp/prompts-registry.js";

// Get tools from shared registry
const tools = getMCPToolDefinitions();

// Get prompts from shared registry
const prompts = MCP_PROMPTS;

// Create server
const server = new Server(
  {
    name: "translation-helps-mcp",
    version: getVersion(),
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema, { $refStrategy: "none" }),
    })),
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "fetch_scripture":
        return await handleFetchScripture(
          args as z.infer<typeof FetchScriptureArgs>,
        );

      case "fetch_translation_notes":
        return await handleFetchTranslationNotes(
          args as z.infer<typeof FetchTranslationNotesArgs>,
        );

      case "fetch_translation_questions":
        return await handleFetchTranslationQuestions(
          args as z.infer<typeof FetchTranslationQuestionsArgs>,
        );

      case "fetch_translation_word_links":
        return await handleFetchTranslationWordLinks(
          args as z.infer<typeof FetchTranslationWordLinksArgs>,
        );

      case "fetch_translation_word":
        return await handleGetTranslationWord(
          args as z.infer<typeof GetTranslationWordArgs>,
        );

      case "fetch_translation_academy":
        return await handleFetchTranslationAcademy(
          args as z.infer<typeof FetchTranslationAcademyArgs>,
        );

      case "list_languages":
        return await handleListLanguages(
          args as z.infer<typeof ListLanguagesArgs>,
        );

      case "list_subjects":
        return await handleListSubjects(
          args as z.infer<typeof ListSubjectsArgs>,
        );

      case "list_resources_for_language":
        return await handleListResourcesForLanguage(
          args as z.infer<typeof ListResourcesForLanguageArgs>,
        );

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    throw new McpError(
      ErrorCode.InternalError,
      `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
});

// List prompts handler
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
});

// Import tool definitions from shared registry (single source of truth)
import { getMCPToolDefinitions } from "./mcp/tools-registry.js";

// Import prompt definitions from shared registry (single source of truth)
import { MCP_PROMPTS, getPromptTemplate } from "./mcp/prompts-registry.js";

// Get tools from shared registry
const tools = getMCPToolDefinitions();

// Get prompts from shared registry
const prompts = MCP_PROMPTS;

// Get prompt handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const prompt = prompts.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
  }

  // Get prompt template from registry
  const templateText = getPromptTemplate(name, args || {});

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: templateText,
        },
      },
    ],
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Translation Helps MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Fatal error in main()", { error: String(error) });
  process.exit(1);
});
