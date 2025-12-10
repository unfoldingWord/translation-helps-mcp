# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2025-12-09

### Removed

- **Removed `listResourcesByLanguage()` method** - Replaced by faster `listResourcesForLanguage()` method
- **Removed `searchTranslationWordAcrossLanguages()` method** - Tool no longer needed

### Changed

- **Updated `listResourcesForLanguage()`** - `topic` parameter now defaults to `"tc-ready"` if not provided
- Updated documentation to reflect tool removals and new defaults
- Improved JSON-RPC 2.0 response parsing for better compatibility

### Fixed

- Fixed JSON-RPC 2.0 response parsing to correctly extract `result` field from server responses
- Improved error handling for MCP server responses

## [1.2.1] - 2025-12-05

### Changed

- Updated default server URL to new domain: `https://tc-helps.mcp.servant.bible/api/mcp`
- Updated all examples and documentation to use new domain

## [1.2.0] - 2025-12-03

### Added

- **Discovery Tools** - New methods for efficient resource discovery:
  - `listLanguages()` - List all available languages from Door43 catalog (~1s)
  - `listSubjects()` - List all available resource subjects/types
  - `listResourcesByLanguage()` - List resources organized by language with parallel API calls (~4-5s first call, cached afterward)
  - `listResourcesForLanguage()` - Fast single-language resource discovery (~1-2s) ⭐ RECOMMENDED
  - `searchTranslationWordAcrossLanguages()` - Search translation word terms across multiple languages

### Changed

- Updated README with discovery workflow examples and performance notes
- All 11 MCP tools now available in SDK

## [1.1.0] - 2025-11-20

### Added

- **Optimized System Prompts** - New `getSystemPrompt()` and `detectRequestType()` functions
  - 60-70% token reduction compared to legacy prompts
  - Contextual rules based on request type (comprehensive, list, explanation, term, concept, default)
  - Automatic request type detection from endpoint calls and message patterns
  - Full TypeScript support with exported types (`RequestType`, `EndpointCall`)
  - See README for usage examples

### Changed

- Updated README with "Optimized System Prompts" section and usage examples

## [1.0.0] - Initial Release

### Added

- `TranslationHelpsClient` - Main client class for MCP server interactions
- `fetchScripture()` - Fetch Bible scripture text
- `fetchTranslationNotes()` - Fetch translation notes for passages
- `fetchTranslationQuestions()` - Fetch comprehension questions
- `fetchTranslationWord()` - Fetch translation word articles
- `fetchTranslationWordLinks()` - Fetch word links for passages
- `fetchTranslationAcademy()` - Fetch translation academy articles
- `getLanguages()` - Get available languages
- `listTools()` - List available MCP tools
- `listPrompts()` - List available MCP prompts
- `callTool()` - Call any MCP tool directly
- `getPrompt()` - Get prompt templates
- Full TypeScript definitions
- Browser compatibility (no Node.js dependencies)
- Metrics and debugging support
