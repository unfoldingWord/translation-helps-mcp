# Translation Helps MCP — Chat-First Rewrite Plan

## Why chat bots matter

Yes — the fact that this system is mostly used by chat bots changes the design significantly.

Chat bots need:

- deterministic, tool-driven data access rather than raw, unstructured text
- explicit tool semantics and schemas for model reasoning
- stable, structured output so the assistant can cite sources reliably
- minimal prompt engineering in the core service layer
- a single, high-level skill interface for the most common translator workflows
- a response model that preserves citation/metadata and avoids hallucination

This rewrite must treat the MCP server as the data/tool layer and the Skill as the actual chat-facing interface.

---

## Rewrite goals

1. Build a chat-first architecture that makes the assistant’s job easy.
2. Separate low-level resource plumbing from high-level translation workflows.
3. Standardize all tool and skill contracts with explicit JSON shapes.
4. Keep the prompt layer lean and focused on orchestration, not business logic.
5. Expose the same logic through MCP, REST, and SDKs while preserving chat-first semantics.

---

## High-level architecture

### 1. Domain layer (core business logic)

This is the single source of truth for translation resources.

Components:

- Resource discovery service
- Scripture fetch service
- Translation notes service
- Translation questions service
- Translation word links service
- Translation word article service
- Translation Academy service
- Language variant discovery / fallback service
- Resource metadata normalization

Responsibilities:

- talk to Door43/DCS or content sources
- normalize resources into stable domain objects
- manage language fallback and organization discovery
- validate reference and parameter semantics

### 2. Tool layer (low-level MCP/REST tools)

This layer exposes the raw resource-access tools.

Tools:

- `fetch_scripture`
- `fetch_translation_notes`
- `fetch_translation_questions`
- `fetch_translation_word_links`
- `fetch_translation_word`
- `fetch_translation_academy`
- `list_languages`
- `list_subjects`
- `list_resources_for_language`
- `list_tools`
- `list_prompts`

Responsibilities:

- translate tool arguments to domain service calls
- return structured responses with `content` + `metadata`
- preserve citations and response shape consistently
- implement protocol-agnostic validation using a shared parameter contract

### 3. Skill/orchestration layer (chat-facing domain actions)

This is the most important new layer.

Skill actions:

- `translationHelpsOverview(reference, language)`
- `translationHelpsFullPassage(reference, language)`
- `translationWordsForPassage(reference, language)`
- `translationAcademyForPassage(reference, language)`
- `discoverResourcesForLanguage(language)`
- `discoverLanguagesForSubject(subject)`

Responsibilities:

- orchestrate the tool operations for the main translator workflows
- build consolidated response objects for chat agents
- hide resource discovery and variant resolution complexity from chat
- enforce citation and content rules for bots
- support both summary and full-content semantics

### 4. Prompt/skill contract layer

This layer defines exactly how the chat bot should invoke the skill and tools.

Components:

- prompt definitions and templates
- prompt metadata and argument contracts
- skill invocation metadata (tool names, required params)
- chat-specific instructions for citation, no-hallucination, and reuse of fetched data

### 5. Protocol adapters

Expose the same core via multiple transports.

Adapters:

- MCP server (source of truth for chat-enabled tool discovery)
- HTTP REST bridge (for scripts, UI, or non-MCP clients)
- SDK client wrapper (`@translation-helps/mcp-client` / `@translation-helps/skill-client`)
- chat runtime helper (client-side bot orchestration)

### 6. Client/UI/chat integration

Components:

- chat API endpoint(s) that call skill actions or prompt-extended workflows
- tool selection and prompt orchestration helpers
- context/state tracker for language / passage / previously fetched content
- error normalization for chat-friendly diagnostics

---

## Contracts

### 1. Tool request contract

Example: `fetch_scripture`

```ts
interface FetchScriptureArgs {
  reference: string; // full passage: book + chapter/verse/range
  language?: string;
  format?: "json" | "md" | "text";
  organization?: string;
}
```

For every tool, define a strict schema in one shared contract package.

### 2. Tool response contract

Use structured, chat-friendly output.

```ts
interface Citation {
  resource: string;
  title?: string;
  version?: string;
  language?: string;
}

interface ToolContentBlock {
  type: "text" | "json" | "markdown";
  text: string;
}

interface MCPToolResponse<T = any> {
  content: ToolContentBlock[];
  data?: T;
  citation?: Citation;
  metadata?: {
    cacheStatus?: string;
    responseTimeMs?: number;
    traceId?: string;
    source?: string;
  };
}
```

Each tool should return both raw structured `data` and a `content` wrapper for MCP compatibility.

### 3. Domain response shapes

Define explicit data contracts for every resource type.

```ts
interface ScriptureResponse {
  reference: string;
  language: string;
  passage: string;
  citation: Citation;
}

interface TranslationNote {
  verse: string;
  quote: string; // source language quote (Greek/Hebrew)
  explanation: string;
  externalReferences: Array<{ path: string; description?: string }>;
  citation: Citation;
}

interface TranslationNotesResponse {
  reference: string;
  language: string;
  verseNotes: TranslationNote[];
  contextNotes: TranslationNote[];
  citation: Citation;
}

interface TranslationQuestion {
  id: string;
  question: string;
}

interface TranslationQuestionsResponse {
  reference: string;
  language: string;
  questions: TranslationQuestion[];
  citation: Citation;
}

interface TranslationWordLink {
  term: string;
  externalReference: { path: string; title?: string };
}

interface TranslationWordLinksResponse {
  reference: string;
  language: string;
  terms: TranslationWordLink[];
  citation: Citation;
}

interface TranslationWordArticleResponse {
  path: string;
  title: string;
  markdown: string;
  citation: Citation;
}

interface TranslationAcademyArticleResponse {
  path: string;
  title: string;
  markdown: string;
  citation: Citation;
}
```

### 4. High-level skill contract

For chat bots, the Skill contract must be the canonical interface.

```ts
interface TranslationHelpsOverviewRequest {
  reference: string;
  language?: string;
  mode?: "condensed" | "full";
}

interface TranslationHelpsOverviewResponse {
  scripture: ScriptureResponse;
  questions: TranslationQuestionsResponse;
  notesSummary: {
    verseNotes: Array<{
      scriptureExcerpt: string;
      note: string;
      externalReferences: string[];
    }>;
  };
  termsSummary: {
    titles: string[];
    paths: string[];
  };
  academySummary: {
    titles: string[];
    paths: string[];
  };
  citations: Citation[];
}
```

And for full-mode:

```ts
interface TranslationHelpsFullResponse {
  scripture: ScriptureResponse;
  questions: TranslationQuestionsResponse;
  notes: TranslationNotesResponse;
  words: TranslationWordArticleResponse[];
  academy: TranslationAcademyArticleResponse[];
  citations: Citation[];
}
```

### 5. Prompt contract

Use a small number of well-defined prompt templates, each with explicit arguments:

- `translation-helps-report`
- `translation-helps-for-passage`
- `get-translation-words-for-passage`
- `get-translation-academy-for-passage`
- `discover-resources-for-language`
- `discover-languages-for-subject`

Each prompt must declare:

- required args
- optional args
- which skill/tool it uses
- whether the output is summary or full
- citation rules
- no-hallucination rule

---

## Chat-first design principles

1. Tool-first, not prompt-first
   - chat bots should use explicit tools whenever they need data
   - prompts should orchestrate tools, not fetch raw facts directly

2. Skill is the primary user-facing contract
   - chat should ask the skill for translation help, not manually call 4 tools

3. Keep outputs structured and citeable
   - responses should have `citation` objects and stable fields
   - bots should not need to invent resource names

4. Preserve conversation state
   - reuse previously fetched passage or article content
   - avoid duplicate tool calls for repeated follow-up questions

5. Force explicit passage references
   - full passage required in the contract, not a bare book code
   - this reduces ambiguity in chat usage

6. Provide condensed and full modes
   - summary mode for most chat interactions
   - full mode only when the user explicitly requests complete content

7. Hide source complexity from the bot
   - skill handles language variant fallback and organization discovery
   - bot only needs to know `reference` + `language`

8. Make errors chat-friendly
   - return model-friendly validation issues like `invalid book code` or `language not available`
   - include suggestions and alternate language variants

---

## Technical architecture

### Layered architecture

1. `domain/`
   - services
   - models
   - parameter validation
   - language discovery

2. `tool-adapters/`
   - MCP tool handlers
   - REST endpoint wrappers
   - SDK adapter helpers

3. `skill/`
   - skill orchestrator
   - high-level workflows
   - result aggregation

4. `prompt/`
   - prompt metadata
   - templates
   - prompt-to-skill mapping

5. `transport/`
   - MCP server
   - HTTP REST server
   - HTTP bridge for SDK and UI

6. `client/`
   - chat runtime helpers
   - context manager
   - SDK client

### Suggested component boundaries

- `domain/resource-discovery.ts`
- `domain/scripture-service.ts`
- `domain/translation-notes-service.ts`
- `domain/translation-questions-service.ts`
- `domain/translation-word-links-service.ts`
- `domain/translation-word-service.ts`
- `domain/translation-academy-service.ts`
- `domain/language-variant-service.ts`
- `tool/fetchScripture.ts`
- `tool/fetchTranslationNotes.ts`
- `tool/fetchTranslationQuestions.ts`
- `tool/fetchTranslationWordLinks.ts`
- `tool/fetchTranslationWord.ts`
- `tool/fetchTranslationAcademy.ts`
- `tool/listLanguages.ts`
- `tool/listSubjects.ts`
- `tool/listResourcesForLanguage.ts`
- `skill/translationHelpsSkill.ts`
- `prompt/registry.ts`
- `transport/mcp-server.ts`
- `transport/rest-server.ts`
- `client/mcp-client.ts`
- `client/skill-client.ts`
- `client/chat-context.ts`

---

## Implementation plan

### Phase 1 — Define contracts and domain model

- define tool request and response schemas in a shared package
- define domain response shapes for Scripture, Notes, Questions, Words, Academy, Language discovery
- define skill request/response contracts and prompt metadata
- codify chat-specific rules in prompt templates

### Phase 2 — Build domain layer

- implement unified resource fetch services
- add language/variant discovery and fallback
- add citations and normalized metadata
- build robust parameter validation

### Phase 3 — Build low-level tools

- implement each MCP/REST tool against the domain layer
- ensure all tools return stable `MCPToolResponse`
- add error handling and metadata capture
- add schema-driven discovery endpoints

### Phase 4 — Build the high-level skill

- implement the `TranslationHelpsSkill`
- build overview and full workflows
- add condensed vs full output modes
- connect skill with underlying tools
- add logic for citation construction and content grouping

### Phase 5 — Build protocol adapters

- create MCP server integration
- create REST endpoints for tools and skill actions
- add SDK wrapper for skill and tool usage

### Phase 6 — Build chat integration

- implement chat endpoint(s) that use the skill and prompts
- include a conversation context manager for fetched tools and references
- implement follow-up reuse logic so bots don’t refetch unnecessarily
- add diagnostics and trace metadata for X-Ray / cache

### Phase 7 — Testing and validation

- unit tests for domain services and contract validation
- integration tests for tool outputs
- end-to-end tests for skill workflows
- chat behavior tests for prompt/tool coordination
- schema validation for MCP and REST shapes

---

## Chat-specific architecture considerations

### 1. Tool discovery for the model

Chat bots need explicit tool metadata. The MCP server must provide:

- tool names
- descriptions
- input schemas
- expected output shape
- when to use each tool vs the high-level skill

### 2. Skill as the primary bot contract

For chat bots, the skill should be the default answer path.

If the model does not know which low-level tool to use or how to chain them, it should call:

- `translation_helps_overview(reference, language)`

This hides the multi-step orchestration from the model.

### 3. Prompt templates as workflow guides

Prompts should be used when the chat flow needs a multi-tool orchestration, but not to implement domain logic.

Example:

- `translation-helps-report` should instruct the model to call the skill or tools in the correct order
- the prompt should explicitly say when to use condensed vs full mode
- the prompt should require citations from `citation` objects

### 4. Context reuse

A chat-oriented design must preserve previously fetched data.

- if scripture for JHN 3:16 is already in the conversation, do not call `fetch_scripture` again
- if a previously fetched Translation Academy article is referenced, reuse it verbatim
- allow the bot to ask follow-up questions without re-fetching unchanged passage data

### 5. Bot-friendly errors

Tool failures should be descriptive and actionable.

Examples:

- `Invalid reference: the passage must include chapter and verse, not just a book name.`
- `Language 'es-419' has no Translation Academy articles for this passage.`
- `Resource not found: translation word path 'bible/kt/love' does not exist in current language.`

### 6. Minimal chat-side business logic

Keep the bot code simple:

- let the skill decide when to fetch academy links from note references
- let the skill decide when to call `fetch_translation_word` for each term in the passage
- let the skill decide whether to return title-only summaries or full articles

---

## Summary

A complete rewrite should move from "MCP tool server with prompt helpers" to a chat-first architecture with:

- a shared domain model
- low-level stable tool contracts
- a high-level translation-help skill
- chat-specific prompt contracts
- protocol adapters for MCP/REST/SDK
- explicit citation and context handling

This makes the system much stronger for chat bots by enabling deterministic behavior, reducing hallucination risk, and giving translators a clean, bot-friendly interface to all Door43 translation resources.
