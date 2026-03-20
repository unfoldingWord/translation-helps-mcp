# Unified Architecture - Single Source of Truth

## Overview

This document describes the unified architecture that provides a **single source of truth** for all parameters, business logic, and data processing across the Translation Helps MCP server and REST API.

## Problem Statement

**Before:** The project had duplication and inconsistency:
- ❌ MCP tools defined parameters using Zod schemas
- ❌ REST endpoints defined parameters using TypeScript configs
- ❌ Parameter changes required updating both systems
- ❌ Business logic was duplicated between MCP and REST handlers
- ❌ Response formatting was inconsistent

**After:** Unified architecture with single source of truth:
- ✅ Parameters defined once, used everywhere
- ✅ Business logic in unified service layer
- ✅ Consistent response formatting
- ✅ Easier to maintain and extend
- ✅ Guaranteed consistency between MCP and REST

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│           Unified Parameter Definitions                     │
│         (src/config/parameters/)                            │
│  - Single source of truth for all parameters                │
│  - Auto-generates Zod schemas for MCP                       │
│  - Auto-generates TypeScript configs for REST               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│           Unified Service Layer                             │
│         (src/unified-services/)                             │
│  - Parameter validation                                     │
│  - DCS API fetching                                         │
│  - File processing                                          │
│  - Caching strategy                                         │
│  - Response formatting                                      │
│  - Error handling                                           │
└──────────────┬────────────────────┬─────────────────────────┘
               ↓                    ↓
        ┌──────────┐         ┌──────────┐
        │   MCP    │         │   REST   │
        │  Tools   │         │   API    │
        └──────────┘         └──────────┘
     (thin wrappers)      (thin wrappers)
```

## Directory Structure

```
src/
├── config/
│   └── parameters/              # ⭐ Unified Parameter Definitions
│       ├── types.ts             # Base parameter definition types
│       ├── common.ts            # All common parameters
│       ├── groups.ts            # Parameter groups per tool
│       └── index.ts             # Main export
│
├── unified-services/            # ⭐ Unified Service Layer
│   ├── types.ts                 # Service interfaces
│   ├── BaseService.ts           # Base service class
│   ├── ScriptureService.ts      # Scripture fetching service
│   ├── TranslationNotesService.ts
│   ├── TranslationQuestionsService.ts
│   └── index.ts                 # Main export
│
├── tools/                       # MCP Tools (thin wrappers)
│   ├── fetchScripture.ts        # ~50 lines (was ~200)
│   ├── fetchTranslationNotes.ts
│   └── fetchTranslationQuestions.ts
│
└── utils/
    └── response-formatter.ts    # ⭐ Centralized response formatting
```

## 1. Unified Parameter System

### Location
`src/config/parameters/`

### Files

#### `types.ts` - Core Types
```typescript
export interface UnifiedParameterDef<T = any> {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description: string;
  default?: T;
  example?: T;
  options?: readonly T[];
  transform?: (value: any) => T;
  validate?: (value: T) => boolean | string;
  zodSchema?: () => z.ZodType<T>;
}

// Converts parameter definition to Zod schema
export function toZodSchema(param: UnifiedParameterDef): z.ZodType

// Converts parameter definition to REST API config
export function toEndpointConfig(param: UnifiedParameterDef): EndpointConfig
```

#### `common.ts` - Common Parameters
All parameters defined once:
- `REFERENCE_PARAM` - Bible reference (e.g., "John 3:16")
- `LANGUAGE_PARAM` - Language code (default: "en")
- `ORGANIZATION_PARAM` - Organization filter (optional, multi-org)
- `TOPIC_PARAM` - Topic filter (default: "tc-ready")
- `FORMAT_PARAM` - Output format (json, text, markdown, usfm)
- `RESOURCE_PARAM` - Scripture resource types
- And more...

#### `groups.ts` - Parameter Groups
Organized collections for each tool:
- `SCRIPTURE_PARAMS` - fetchScripture parameters
- `TRANSLATION_NOTES_PARAMS` - fetchTranslationNotes parameters
- `TRANSLATION_QUESTIONS_PARAMS` - fetchTranslationQuestions parameters
- And more...

### Usage

**In MCP Tools:**
```typescript
import { toZodObject, PARAMETER_GROUPS } from '../config/parameters/index.js';

// Auto-generate Zod schema from parameter definitions
export const FetchScriptureArgs = toZodObject(
  PARAMETER_GROUPS.scripture.parameters
);
```

**In REST Endpoints:**
```typescript
import { toEndpointParams, PARAMETER_GROUPS } from '../config/parameters/index.js';

// Auto-generate endpoint config from parameter definitions
export const FETCH_SCRIPTURE_CONFIG = {
  name: 'fetch-scripture',
  params: toEndpointParams(PARAMETER_GROUPS.scripture.parameters),
};
```

**Result:** Change a parameter definition once, both MCP and REST update automatically!

## 2. Unified Service Layer

### Location
`src/unified-services/`

### Base Service Class

All services extend `BaseService<TParams, TResult>`:

```typescript
export abstract class BaseService<TParams, TResult> {
  abstract name: string;
  abstract description: string;
  abstract parameters: UnifiedParameterDef[];
  
  abstract execute(
    params: TParams,
    context?: ServiceContext
  ): Promise<ServiceResponse<TResult>>;
  
  // Provided utilities:
  protected success(data, metadata?, format?): ServiceResponse
  protected error(code, message, details?, status?): ServiceError
  protected handleError(error, context?): ServiceError
  protected withTiming(fn, label?): Promise<{result, elapsed}>
  protected validateParams(params): {valid, errors}
}
```

### Service Examples

#### ScriptureService
```typescript
export class ScriptureService extends BaseService<ScriptureParams, ScriptureResult> {
  name = 'fetchScripture';
  description = 'Fetch Bible scripture text';
  parameters = PARAMETER_GROUPS.scripture.parameters;
  
  async execute(params, context?) {
    // 1. Validate parameters
    const validation = this.validateParams(params);
    if (!validation.valid) throw this.error(...);
    
    // 2. Call core service
    const result = await fetchScripture(transformedParams);
    
    // 3. Format response
    const formatted = this.formatScriptureResponse(result, params.format);
    
    // 4. Return standardized response
    return this.success(formatted, metadata, params.format);
  }
}
```

### Service Context

Services accept an optional `ServiceContext`:
```typescript
interface ServiceContext {
  requestId?: string;
  platform?: string;      // 'mcp', 'rest', 'cli', etc.
  userAgent?: string;
  environment?: string;
  useCache?: boolean;
  cacheTTL?: number;
}
```

### Service Response

All services return `ServiceResponse<T>`:
```typescript
interface ServiceResponse<T> {
  data: T;
  metadata?: {
    count?: number;
    resources?: string[];
    organizations?: string[];
    cached?: boolean;
    elapsed?: number;
    warnings?: string[];
  };
  format?: 'json' | 'text' | 'markdown' | 'md' | 'usfm';
}
```

## 3. Response Formatting

### Location
`src/utils/response-formatter.ts`

### Purpose
Centralized formatting for all output formats to ensure consistency.

### Formats Supported
- **JSON** - Structured data (default)
- **Text** - Plain text with citations
- **Markdown** - Formatted markdown
- **USFM** - USFM scripture format

### Usage
```typescript
import { formatResponse } from '../utils/response-formatter.js';

const formatted = formatResponse(data, 'markdown');
```

## 4. MCP Tools (Thin Wrappers)

### Before
```typescript
// fetchScripture.ts - ~200 lines
export const FetchScriptureArgs = z.object({
  reference: z.string().describe("Bible reference..."),
  language: z.string().optional().default("en").describe("Language code..."),
  organization: z.union([z.string(), z.array(z.string()), z.undefined()]).optional()...
  // ... many more lines of schema definition
});

export async function handleFetchScripture(args) {
  // ... 100+ lines of business logic
  // - Parameter transformation
  // - Service calls
  // - Error handling
  // - Response formatting
  // - Metadata building
}
```

### After
```typescript
// fetchScripture.ts - ~50 lines
import { toZodObject, PARAMETER_GROUPS } from '../config/parameters/index.js';
import { createScriptureService } from '../unified-services/index.js';

// Auto-generate schema from unified definitions
export const FetchScriptureArgs = toZodObject(
  PARAMETER_GROUPS.scripture.parameters
);

export async function handleFetchScripture(args) {
  const service = createScriptureService();
  const response = await service.execute(args, { platform: 'mcp' });
  
  return {
    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    metadata: response.metadata,
  };
}
```

**Reduction:** ~75% less code, all business logic in unified service!

## 5. REST Endpoints (Thin Wrappers)

REST endpoints similarly become thin wrappers:

```typescript
// ui/src/routes/api/fetch-scripture/+server.ts
import { createScriptureService } from '$lib/../../../src/unified-services/index.js';

export const GET = async ({ url }) => {
  const params = extractParams(url); // Parse query params
  
  const service = createScriptureService();
  const response = await service.execute(params, { platform: 'rest' });
  
  return json(response.data, {
    headers: { /* ... */ },
  });
};
```

## Benefits

### 1. Single Source of Truth
- ✅ Parameters defined once in `src/config/parameters/`
- ✅ Changes automatically propagate to MCP and REST
- ✅ No duplication or drift

### 2. Consistent Business Logic
- ✅ All fetching, processing, caching logic in `src/unified-services/`
- ✅ Same behavior for MCP and REST
- ✅ Easier to test (test the service once)

### 3. Maintainability
- ✅ Add new parameter: update `common.ts` → both MCP and REST get it
- ✅ Change validation: update service → both MCP and REST get it
- ✅ Fix bug: fix in service → both MCP and REST fixed

### 4. Extensibility
- ✅ Add new output format: update response formatter → all tools get it
- ✅ Add new client (CLI, mobile): reuse unified services
- ✅ Add new tool: extend BaseService, use parameter groups

### 5. Developer Experience
- ✅ Clear separation of concerns
- ✅ Predictable structure
- ✅ Less code to write and maintain
- ✅ Type-safe throughout

## Migration Path

### Phase 1: ✅ Completed
- [x] Create unified parameter definitions
- [x] Create unified service layer (BaseService, ScriptureService, etc.)
- [x] Update fetchScripture MCP tool
- [x] Update fetchTranslationNotes MCP tool
- [x] Update fetchTranslationQuestions MCP tool

### Phase 2: In Progress
- [ ] Update remaining MCP tools (word-links, words, academy)
- [ ] Update REST endpoint configs
- [ ] Test MCP tools
- [ ] Test REST endpoints
- [ ] Verify UI pages auto-update

### Phase 3: Future
- [ ] Update SDK clients to use unified parameter definitions
- [ ] Create CLI tool using unified services
- [ ] Add comprehensive integration tests

## Testing

### Unit Tests
Test unified services directly:
```typescript
describe('ScriptureService', () => {
  it('fetches scripture for John 3:16', async () => {
    const service = new ScriptureService();
    const response = await service.execute({
      reference: 'John 3:16',
      language: 'en',
    });
    
    expect(response.data).toBeDefined();
    expect(response.metadata.count).toBeGreaterThan(0);
  });
});
```

### Integration Tests
Test MCP and REST endpoints (both use the same service):
```typescript
// They should return identical data
const mcpResult = await handleFetchScripture(params);
const restResult = await GET(createRequest(params));

expect(mcpResult.data).toEqual(restResult.data);
```

## Best Practices

### Adding a New Parameter
1. Add to `src/config/parameters/common.ts`
2. Add to appropriate group in `groups.ts`
3. Done! MCP and REST automatically get it

### Adding a New Tool
1. Create parameter group in `groups.ts`
2. Create service in `src/unified-services/[Tool]Service.ts`
3. Create MCP tool wrapper in `src/tools/[tool].ts`
4. Create REST endpoint in `ui/src/routes/api/[tool]/+server.ts`

### Modifying Business Logic
1. Update the unified service in `src/unified-services/`
2. Test the service
3. Done! Both MCP and REST get the change

## Conclusion

The unified architecture eliminates duplication, ensures consistency, and makes the codebase significantly easier to maintain and extend. By defining parameters and business logic once, we guarantee that MCP tools, REST endpoints, and any future clients all behave identically.

**Key Principle:** Define once, use everywhere. 🎯
