# UI Pages Implementation Guide

## Current Status

✅ **FULLY COMPLETED:**
1. Created `/api/tools-metadata` endpoint that dynamically generates metadata
2. Created shared TypeScript types (`ui/src/lib/types/tools-metadata.ts`)
3. Created server-side load functions for both pages
4. Verified metadata API returns all 9 tools and 5 prompts correctly
5. ✅ **Updated MCP Tools page** to consume dynamic metadata
6. ✅ **Updated API Explorer page** to consume dynamic metadata
7. ✅ **Added metadata version display** to both pages

🎉 **System is now fully dynamic!** All tool/prompt definitions are generated from unified services.

---

## Implementation Plan

### Phase 1: MCP Tools Page

**File**: `ui/src/routes/(app)/mcp-tools/+page.svelte`

#### Changes Required:

1. **Import server data and types**
   ```svelte
   <script lang="ts">
     import type { PageData } from './$types';
     import type { ToolMetadata, PromptMetadata } from '$lib/types/tools-metadata';
     import { getDefaultTestParams } from '$lib/types/tools-metadata';
     
     export let data: PageData;
   </script>
   ```

2. **Replace hardcoded prompts** (Lines ~79-300)
   
   **BEFORE:**
   ```typescript
   const mcpPrompts = [
     {
       id: 'translation-helps-for-passage',
       title: 'Complete Translation Help',
       // ... hardcoded definition
     },
     // ... more hardcoded prompts
   ];
   ```
   
   **AFTER:**
   ```typescript
   // Use prompts from server data
   $: prompts = data.prompts.map(prompt => ({
     id: prompt.name,
     title: prompt.name.split('-').map(w => 
       w.charAt(0).toUpperCase() + w.slice(1)
     ).join(' '),
     description: prompt.description,
     parameters: prompt.arguments.map(arg => ({
       name: arg.name,
       type: 'text',
       required: arg.required,
       description: arg.description
     }))
   }));
   ```

3. **Replace hardcoded core endpoints fetch** (onMount function)
   
   **BEFORE:**
   ```typescript
   onMount(async () => {
     try {
       const response = await fetch('/api/mcp', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ method: 'tools/list' })
       });
       // ... process response
     } catch (error) {
       // ...
     }
   });
   ```
   
   **AFTER:**
   ```typescript
   onMount(() => {
     // Core endpoints are already loaded from server data
     coreEndpoints = data.tools.map(tool => ({
       name: tool.mcpName,
       description: tool.description,
       params: tool.parameters.map(p => ({
         name: p.name,
         type: p.type,
         required: p.required,
         description: p.description
       })),
       category: tool.category,
       examples: tool.examples
     }));
     isInitialized = true;
   });
   ```

4. **Update `testEndpoint` function** (Lines ~610-660)
   
   **BEFORE:** Hardcoded test parameters for each tool
   
   **AFTER:**
   ```typescript
   async function testEndpoint(endpoint: any) {
     // Find tool metadata
     const tool = data.tools.find(t => t.mcpName === endpoint.name);
     const testParams = tool ? getDefaultTestParams(tool) : {};
     
     // Use MCP SDK to call tool
     try {
       const result = await callTool(endpoint.name, testParams);
       endpointTestResults[endpoint.name] = {
         status: 'success',
         message: 'Test passed'
       };
       return result;
     } catch (error: any) {
       endpointTestResults[endpoint.name] = {
         status: 'error',
         message: error.message
       };
       throw error;
     }
   }
   ```

5. **Remove hardcoded prompt workflow steps** (Lines ~300-500)
   
   These can be derived from prompt metadata or kept as UI-only enhancements.

---

### Phase 2: API Explorer Page

**File**: `ui/src/routes/api-explorer/+page.svelte`

#### Changes Required:

1. **Import server data and types**
   ```svelte
   <script lang="ts">
     import type { PageData } from './$types';
     import type { ToolMetadata } from '$lib/types/tools-metadata';
     import { groupToolsByCategory } from '$lib/types/tools-metadata';
     
     export let data: PageData;
   </script>
   ```

2. **Replace hardcoded endpoints array** (Lines ~16-400)
   
   **BEFORE:**
   ```typescript
   const endpoints: Endpoint[] = [
     {
       name: 'Fetch Scripture',
       path: '/api/fetch-scripture',
       description: 'Fetch Bible scripture text...',
       // ... hardcoded definition
     },
     // ... 8 more hardcoded endpoints
   ];
   ```
   
   **AFTER:**
   ```typescript
   // Use endpoints from server data (already loaded)
   $: endpoints = data.endpoints; // ToolMetadata[] from server
   $: endpointsByCategory = groupToolsByCategory(endpoints);
   ```

3. **Update parameter rendering**
   
   The existing parameter rendering should work with minimal changes since the structure is similar:
   
   ```svelte
   {#each endpoint.parameters as param}
     <div class="parameter">
       <label>
         {param.name}
         {#if param.required}<span class="required">*</span>{/if}
       </label>
       
       {#if param.type === 'boolean'}
         <input type="checkbox" name={param.name} />
       {:else if param.options}
         <select name={param.name} required={param.required}>
           {#each param.options as option}
             <option value={option}>{option}</option>
           {/each}
         </select>
       {:else}
         <input
           type="text"
           name={param.name}
           required={param.required}
           placeholder={param.example || param.description}
         />
       {/if}
       
       <p class="description">{param.description}</p>
     </div>
   {/each}
   ```

4. **Add example usage display**
   
   ```svelte
   {#if endpoint.examples && endpoint.examples.length > 0}
     <div class="examples">
       <h4>Examples</h4>
       {#each endpoint.examples as example}
         <div class="example">
           <h5>{example.title}</h5>
           {#if example.description}
             <p>{example.description}</p>
           {/if}
           <button on:click={() => loadExample(endpoint, example.parameters)}>
             Try this example
           </button>
         </div>
       {/each}
     </div>
   {/if}
   ```

5. **Update category filtering**
   
   ```svelte
   <script lang="ts">
     let selectedCategory = 'all';
     $: categories = data.categories; // Already loaded from server
     $: filteredEndpoints = selectedCategory === 'all'
       ? endpoints
       : endpoints.filter(e => e.category === selectedCategory);
   </script>
   
   <div class="category-filter">
     <button
       class:active={selectedCategory === 'all'}
       on:click={() => selectedCategory = 'all'}
     >
       All ({endpoints.length})
     </button>
     {#each categories as category}
       <button
         class:active={selectedCategory === category}
         on:click={() => selectedCategory = category}
       >
         {category} ({endpoints.filter(e => e.category === category).length})
       </button>
     {/each}
   </div>
   ```

---

## Testing Checklist

After implementing the changes:

### MCP Tools Page
- [ ] All 9 tools appear in "Core Tools" section
- [ ] All 5 prompts appear in "MCP Prompts" section
- [ ] Parameter forms render correctly for each tool
- [ ] "Test All" button works
- [ ] Individual tool testing works
- [ ] Examples are displayed and functional
- [ ] Categories are properly organized
- [ ] No console errors

### API Explorer Page
- [ ] All 9 endpoints are listed
- [ ] Category filtering works (Discovery, Scripture, Training, Translation Helps)
- [ ] Parameter inputs render with correct types (text, boolean, select)
- [ ] Required parameters are marked with asterisk
- [ ] Parameter descriptions are displayed
- [ ] Example buttons work and populate form
- [ ] "Try this endpoint" functionality works
- [ ] Response display shows results correctly
- [ ] No console errors

---

## Backward Compatibility

The changes maintain backward compatibility:

1. **Parameter structure** matches existing format
2. **Tool names** remain consistent (mcpName for MCP, endpoint for REST)
3. **Response formats** unchanged
4. **UI components** can be updated incrementally

---

## Rollback Plan

If issues arise during implementation:

1. Server-side load functions are non-breaking (pages still receive props)
2. Can temporarily revert to hardcoded data while keeping metadata API
3. Metadata API is cacheable and doesn't affect existing functionality
4. Changes are isolated to UI layer only

---

## Future Enhancements

Once dynamic metadata is working:

1. **Auto-generate API documentation** from metadata
2. **Create OpenAPI/Swagger spec** from metadata
3. **Generate SDK code** automatically
4. **Build test suites** from examples
5. **Add tool search/filtering** by parameter or description
6. **Create "playground" mode** for testing tools interactively
7. **Add tool comparison view** to compare similar tools
8. **Generate usage analytics** based on tool metadata

---

## Example Implementation Snippet

Here's a complete example of how the MCP Tools page should consume the data:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import { getDefaultTestParams, findTool } from '$lib/types/tools-metadata';
  
  export let data: PageData;
  
  // Tools and prompts are already loaded from server
  $: tools = data.tools;
  $: prompts = data.prompts;
  $: categories = data.categories;
  
  let selectedCategory = 'core';
  let selectedTool: any = null;
  
  // Group tools by category for display
  $: toolsByCategory = tools.reduce((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {} as Record<string, typeof tools>);
  
  async function testTool(tool: typeof tools[0]) {
    const params = getDefaultTestParams(tool);
    
    try {
      const result = await callTool(tool.mcpName, params);
      console.log('Test result:', result);
      // Show success UI
    } catch (error) {
      console.error('Test failed:', error);
      // Show error UI
    }
  }
</script>

<div class="tools-page">
  <div class="sidebar">
    {#each categories as category}
      <button
        class:active={selectedCategory === category}
        on:click={() => selectedCategory = category}
      >
        {category} ({toolsByCategory[category]?.length || 0})
      </button>
    {/each}
  </div>
  
  <div class="content">
    {#each toolsByCategory[selectedCategory] || [] as tool}
      <div class="tool-card">
        <h3>{tool.name}</h3>
        <p>{tool.description}</p>
        
        <div class="parameters">
          {#each tool.parameters as param}
            <div class="param">
              <label>
                {param.name}
                {#if param.required}<span>*</span>{/if}
              </label>
              <input
                type="text"
                placeholder={param.example || param.description}
              />
            </div>
          {/each}
        </div>
        
        {#if tool.examples.length > 0}
          <div class="examples">
            <h4>Quick Examples</h4>
            {#each tool.examples as example}
              <button on:click={() => testTool(tool)}>
                {example.title}
              </button>
            {/each}
          </div>
        {/if}
        
        <button on:click={() => testTool(tool)} class="primary">
          Test Tool
        </button>
      </div>
    {/each}
  </div>
</div>
```

---

## Questions?

If you encounter issues during implementation:

1. Check `/api/tools-metadata` returns expected data
2. Verify server-side load functions are working (check network tab)
3. Ensure TypeScript types are correctly imported
4. Check browser console for errors
5. Compare with this guide's examples

The metadata system is designed to be simple and straightforward. All complexity is handled in the metadata generation—the UI just consumes clean, typed data.
