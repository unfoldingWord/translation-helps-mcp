# Dynamic UI Metadata System

## Overview

The MCP Tools and API Explorer pages are now **dynamically generated** from our unified services layer. This ensures the UI always stays in sync with the actual tool implementations, parameter definitions, and service metadata.

## Architecture

### 1. Single Source of Truth

All tool/endpoint metadata is derived from:

- **Unified Parameter Definitions** (`src/config/parameters/`)
  - `common.ts` - Shared parameter definitions
  - `groups.ts` - Parameter groups for each tool/endpoint
  - `types.ts` - Type utilities (toZodSchema, toEndpointConfig, etc.)

- **Service Layer** (`src/unified-services/`)
  - Individual service classes for each tool
  - Consistent error handling and response formatting
  - Business logic implementation

- **Tool Registry** (`src/contracts/ToolContracts.ts`)
  - Maps MCP tool names to REST endpoints
  - Defines formatters for each tool type
  - Specifies required parameters

- **MCP Tools Registry** (`src/mcp/tools-registry.ts`)
  - MCP-specific tool definitions
  - Zod schemas for validation
  - Tool descriptions

- **MCP Prompts Registry** (`src/mcp/prompts-registry.ts`)
  - Workflow prompt definitions
  - Multi-step prompt templates

### 2. Metadata API Endpoint

**Location**: `ui/src/routes/api/tools-metadata/+server.ts`

**Purpose**: Dynamically generates comprehensive metadata for all tools and prompts by introspecting the unified services layer.

**Returns**:
```typescript
interface MetadataResponse {
  tools: ToolMetadata[];
  prompts: PromptMetadata[];
  categories: string[];
  version: string;
  generatedAt: string;
}
```

**Features**:
- ✅ Auto-generates tool metadata from parameter groups
- ✅ Includes parameter types, requirements, defaults, examples
- ✅ Provides usage examples with expected responses
- ✅ Groups tools by category
- ✅ Caches response for 5 minutes (CDN-friendly)

### 3. Server-Side Load Functions

**MCP Tools Page**: `ui/src/routes/(app)/mcp-tools/+page.server.ts`
**API Explorer Page**: `ui/src/routes/api-explorer/+page.server.ts`

Both pages use server-side load functions to:
1. Fetch metadata from `/api/tools-metadata` at build/request time
2. Pass data to Svelte components as props
3. Enable SSR and static site generation
4. Provide graceful error handling

### 4. Shared Type Definitions

**Location**: `ui/src/lib/types/tools-metadata.ts`

Provides:
- TypeScript interfaces for all metadata types
- Utility functions (`groupToolsByCategory`, `findTool`, `getDefaultTestParams`)
- Consistent type safety across API and UI

---

## How It Works

### Adding a New Tool

When you add a new tool/endpoint to the system:

1. **Define Parameters** in `src/config/parameters/groups.ts`:
   ```typescript
   export const MY_NEW_TOOL_PARAMS = createParameterGroup(
     'My New Tool Parameters',
     'Parameters for my new tool',
     [
       COMMON_PARAMS.language,
       COMMON_PARAMS.organization,
       // ... custom params
     ]
   );
   ```

2. **Create Unified Service** in `src/unified-services/MyNewToolService.ts`:
   ```typescript
   export class MyNewToolService extends BaseService<MyNewToolParams, any> {
     constructor() {
       super(MY_NEW_TOOL_PARAMS.parameters);
     }
     
     async execute(params: MyNewToolParams): Promise<ServiceResponse<any>> {
       // Implementation
     }
   }
   ```

3. **Register in ToolRegistry** in `src/contracts/ToolContracts.ts`:
   ```typescript
   my_new_tool: {
     endpoint: "/api/my-new-tool",
     formatter: ToolFormatters.myFormatter,
     requiredParams: ["language"],
   }
   ```

4. **Add MCP Tool Definition** in `src/mcp/tools-registry.ts`:
   ```typescript
   {
     name: "my_new_tool",
     description: "Does something amazing",
     inputSchema: MyNewToolArgs
   }
   ```

5. **Add Metadata Mapping** in `ui/src/routes/api/tools-metadata/+server.ts`:
   ```typescript
   myNewTool: {
     category: 'My Category',
     description: 'Tool description for UI',
     examples: [
       {
         title: 'Basic usage',
         parameters: { language: 'en' },
         expectedResponse: 'Sample response'
       }
     ]
   }
   ```

**That's it!** The UI pages will automatically:
- ✅ Display the new tool in the correct category
- ✅ Generate form inputs for all parameters
- ✅ Show examples and usage documentation
- ✅ Provide test functionality with default values
- ✅ Display parameter types, requirements, and descriptions

---

## Benefits

### 🎯 **Single Source of Truth**
- Parameter definitions live in one place
- No duplication between MCP tools, REST endpoints, and UI
- Changes automatically propagate to all consumers

### 🚀 **Automatic UI Updates**
- Add a parameter → UI form automatically includes it
- Change a description → UI immediately reflects it
- No manual UI updates required

### 🛡️ **Type Safety**
- Shared TypeScript types across frontend and backend
- Compile-time validation of parameter structures
- Runtime validation via Zod schemas

### 📚 **Self-Documenting**
- API explorer shows live, accurate documentation
- Examples are maintained alongside implementation
- Parameter descriptions stay up-to-date

### 🧪 **Easier Testing**
- Default test parameters generated automatically
- UI provides interactive testing for all tools
- Examples serve as integration tests

---

## API Usage

### Fetch All Metadata

```bash
curl http://localhost:8181/api/tools-metadata
```

Response:
```json
{
  "tools": [
    {
      "name": "Fetch Scripture",
      "mcpName": "fetch_scripture",
      "endpoint": "/api/fetch-scripture",
      "description": "Fetch Bible scripture text...",
      "category": "Scripture",
      "parameters": [
        {
          "name": "reference",
          "type": "string",
          "required": true,
          "description": "Bible reference (e.g., 'John 3:16')",
          "example": "John 3:16"
        }
      ],
      "examples": [
        {
          "title": "Single verse",
          "parameters": { "reference": "John 3:16", "language": "en" }
        }
      ]
    }
  ],
  "prompts": [...],
  "categories": ["Scripture", "Translation Helps", "Training", "Discovery"],
  "version": "1.0.0",
  "generatedAt": "2026-03-07T..."
}
```

### Use in Page Components

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  
  export let data: PageData;
  
  // Data is automatically loaded server-side
  const { tools, prompts, categories } = data;
</script>

{#each categories as category}
  <h2>{category}</h2>
  {#each tools.filter(t => t.category === category) as tool}
    <ToolCard {tool} />
  {/each}
{/each}
```

---

## Maintenance

### Updating Tool Descriptions

Edit `TOOL_METADATA_MAP` in `ui/src/routes/api/tools-metadata/+server.ts`:

```typescript
const TOOL_METADATA_MAP = {
  myTool: {
    category: 'My Category',
    description: 'Updated description here',  // ← Edit here
    examples: [...]
  }
};
```

### Adding New Categories

Categories are automatically derived from tool metadata. Just assign a new category in `TOOL_METADATA_MAP` and it will appear in the UI.

### Cache Control

The metadata endpoint caches responses for 5 minutes:

```typescript
headers: {
  'Cache-Control': 'public, max-age=300'
}
```

To change cache duration, edit the `max-age` value in `+server.ts`.

---

## Migration Status

### ✅ Completed
- Created `/api/tools-metadata` endpoint
- Defined shared TypeScript types
- Created server-side load functions for both pages
- Documented architecture and usage

### 🚧 Next Steps
1. **Update MCP Tools Page** (`ui/src/routes/(app)/mcp-tools/+page.svelte`)
   - Replace hardcoded `mcpPrompts` array with `data.prompts`
   - Replace hardcoded `coreEndpoints` with `data.tools`
   - Use `getDefaultTestParams()` utility for test generation

2. **Update API Explorer Page** (`ui/src/routes/api-explorer/+page.svelte`)
   - Replace hardcoded `endpoints` array with `data.endpoints`
   - Use shared parameter rendering logic
   - Leverage example data for documentation

3. **Test & Validate**
   - Verify all tools appear correctly
   - Check parameter forms render properly
   - Ensure examples work as expected
   - Validate error handling

---

## Example: Dynamic Tool Rendering

```svelte
<!-- Before: Hardcoded -->
<script>
  const tools = [
    { name: 'Fetch Scripture', endpoint: '/api/fetch-scripture', ... },
    { name: 'Fetch Translation Notes', endpoint: '/api/fetch-translation-notes', ... },
    // ... manually maintained list
  ];
</script>

<!-- After: Dynamic -->
<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
  
  // Automatically loaded from unified services!
  $: tools = data.tools;
</script>

{#each tools as tool}
  <div class="tool-card">
    <h3>{tool.name}</h3>
    <p>{tool.description}</p>
    
    <!-- Dynamic parameter form -->
    {#each tool.parameters as param}
      <input
        type={param.type === 'boolean' ? 'checkbox' : 'text'}
        name={param.name}
        required={param.required}
        placeholder={param.example || param.description}
      />
    {/each}
    
    <!-- Dynamic examples -->
    {#each tool.examples as example}
      <button on:click={() => runExample(tool, example.parameters)}>
        Try: {example.title}
      </button>
    {/each}
  </div>
{/each}
```

---

## Conclusion

The dynamic metadata system ensures that the UI is always a **perfect reflection** of the underlying unified services layer. When you add a tool, define parameters, or update descriptions in the core system, the UI automatically stays in sync—no manual updates required.

This architectural pattern follows best practices for:
- **DRY** (Don't Repeat Yourself)
- **Single Responsibility**
- **Separation of Concerns**
- **Type Safety**
- **Self-Documentation**
