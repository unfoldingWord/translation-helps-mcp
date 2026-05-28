# Translation Helps MCP — Code-Based Overview

This document describes the repository purpose, the problems it solves, and the tools it implements based on the source code alone.

## Purpose

This repository implements a Bible translation resource server for the Model Context Protocol (MCP) and companion HTTP/REST access.

It is designed to make translation-focused content available to AI assistants and client apps through a standardized tool discovery interface and consistent request/response handling.

## Problem it solves

Translation workflows need reliable access to Bible translation resources from Door43-style catalogs in a form that can be consumed by:

- AI assistants and tool-enabled agents via MCP
- web/mobile clients via REST endpoints
- translation tools that need scripture text, translation notes, questions, word links, glossary entries, and training content

The repo solves the following challenges:

- Aggregating multiple translation resource types behind a single server interface
- Providing consistent parameter validation and schema definitions for all fetch tools
- Supporting discovery of available languages, subjects, and resources before content requests
- Enabling both MCP tooling and HTTP REST endpoints from a common source of truth
- Keeping business logic centralized in a unified service layer so both protocols behave the same way

## Core implementation

Key implementation points visible from the code:

- `package.json` identifies this project as `translation-helps-mcp` and confirms the repo is built around an MCP server with UI tooling and test support.
- `src/index.ts` is the MCP server entrypoint. It registers tool discovery, tool execution, and prompt discovery handlers using `@modelcontextprotocol/sdk`.
- `src/mcp/tools-registry.ts` is the single source of truth for available MCP tools. It defines each tool name, description, and input schema.
- `src/tools/*.ts` contains handler code for each supported content tool. These handlers use a shared service layer and return MCP-formatted results.
- `src/unified-services/` centralizes business logic for scripture, notes, questions, word links, translation words, and academy content.
- `src/config/parameters/` defines shared parameter schemas used by tools and endpoints.
- `ui/src/routes/api/list-tools/+server.ts` shows that REST discovery routes are implemented using the same MCP tool definitions.

## Tools provided by the repository

The source code exposes the following MCP tools:

- `fetch_scripture`
  - Fetch scripture text for a Bible passage, verse range, or chapter.
- `fetch_translation_notes`
  - Fetch translator notes and explanatory notes for a passage.
- `fetch_translation_questions`
  - Fetch comprehension and review questions for a passage.
- `fetch_translation_word_links`
  - Fetch translation word links for key terms in a passage.
- `fetch_translation_word`
  - Fetch a translation word article by term name, path, or reference.
- `fetch_translation_academy`
  - Fetch Translation Academy training articles and teaching content.
- `list_languages`
  - Discover available translation languages and codes.
- `list_subjects`
  - Discover available resource subjects/types.
- `list_resources_for_language`
  - Discover resources available for a specific language, including variants and fallback behavior.
- `list_tools`
  - List the available MCP tools and their schemas.

## How the solution is structured

- `src/index.ts` handles MCP transport, routing, and error conversion.
- `src/mcp/tools-registry.ts` provides definitions used by MCP and REST discovery.
- Each `src/tools/*.ts` module implements one tool’s execution logic.
- `src/unified-services/` contains shared service implementations for actual data fetching and response composition.
- `src/config/parameters/` defines shared input validation and normalized parameter metadata.
- `ui/src/routes/api/` exposes HTTP endpoints for the same capabilities, confirming the repo supports both MCP and REST access patterns.

## Intended user experience

Clients can use this codebase to:

- discover what translation resources are available
- request scripture passages in context
- retrieve translator notes and questions for teaching and checking meaning
- get glossary/translation word links and term articles
- access translation training content
- integrate the same backend through both tool-enabled AI flows and conventional HTTP APIs
