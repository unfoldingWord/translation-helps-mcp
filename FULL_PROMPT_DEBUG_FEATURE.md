# Full Prompt Debugging Feature

## Overview

Added comprehensive prompt debugging to the chat page's debug console. You can now see **exactly** what prompt is being sent to the LLM, including:
- System prompt (rules & instructions)
- Context (MCP data)
- Chat history
- User message
- Token estimates

## Changes Made

### 1. Backend: `ui/src/routes/api/chat-stream/+server.ts`

#### Non-Streaming Response Path (Lines 2184-2225)
```typescript
// Build full prompt object for debugging
const fullPromptData = {
  systemPrompt,
  context: context.substring(0, 10000) + (context.length > 10000 ? '... (truncated)' : ''),
  contextSize: context.length,
  chatHistory: chatHistory.slice(-6),
  userMessage: message,
  totalTokens: estimateTokens(...)
};

result.xrayData = {
  // ... existing xray data ...
  fullPrompt: fullPromptData // NEW: Add full prompt
};
```

#### Streaming Response Path (Lines 2043-2088)
```typescript
// Build system prompt for streaming (same logic as callOpenAIStream)
const requestType = endpointCalls
  ? detectRequestType(endpointCalls as EndpointCall[], message)
  : undefined;
let systemPromptForDebug = USE_OPTIMIZED_PROMPT
  ? getSystemPrompt(requestType, endpointCalls as EndpointCall[] | undefined, message)
  : SYSTEM_PROMPT_LEGACY;

// Add language context
// ... (same logic as callOpenAIStream)

const fullPromptData = {
  systemPrompt: systemPromptForDebug,
  context: context.substring(0, 10000) + (context.length > 10000 ? '... (truncated)' : ''),
  contextSize: context.length,
  chatHistory: chatHistory.slice(-6),
  userMessage: message,
  totalTokens: estimateTokens(...)
};

const xrayInit: any = {
  // ... existing xray data ...
  fullPrompt: fullPromptData // NEW: Add full prompt
};
```

### 2. Frontend: `ui/src/routes/(app)/chat/ChatInterface.svelte`

#### Updated Debug Log Interface (Lines 48-63)
```typescript
let debugLogs: Array<{
  id: string;
  timestamp: Date;
  type: 'mcp-tool' | 'mcp-prompt' | 'network' | 'llm' | 'other';
  endpoint?: string;
  params?: Record<string, any>;
  error?: string;
  status?: number;
  duration?: number;
  userMessage?: string;
  response?: any;
  llmResponse?: string;
  isError?: boolean;
  requestId?: string;
  fullPrompt?: any; // NEW: Full prompt sent to LLM for debugging
}> = [];
```

#### Updated logMCPCall Function (Lines 280-291)
```typescript
function logMCPCall(
  type: 'mcp-tool' | 'mcp-prompt' | 'network' | 'llm' | 'other',
  details: {
    endpoint?: string;
    params?: Record<string, any>;
    status?: number;
    duration?: number;
    response?: any;
    error?: string;
    fullPrompt?: any; // NEW: Accept fullPrompt
  }
) {
  // ... creates log with fullPrompt
}
```

#### Extract fullPrompt from xrayData (Lines 401-418, 542-559)
```typescript
// Non-streaming path
logMCPCall(toolType, {
  endpoint: call.endpoint || call.name,
  params: call.params,
  status: call.status,
  duration: ...,
  response: call.response,
  error: call.error,
  fullPrompt: data.xrayData?.fullPrompt // NEW: Extract from xrayData
});

// Streaming path
logMCPCall(toolType, {
  endpoint: call.endpoint || call.name,
  params: call.params,
  status: call.status,
  duration: ...,
  response: call.response,
  error: call.error,
  fullPrompt: json.fullPrompt // NEW: Extract from streaming xray event
});
```

### 3. UI: `ui/src/routes/(app)/chat/DebugSidebar.svelte`

#### Updated Log Interface (Lines 4-17)
```typescript
export let logs: Array<{
  id: string;
  timestamp: Date;
  type: 'mcp-tool' | 'mcp-prompt' | 'network' | 'llm' | 'other';
  endpoint?: string;
  params?: Record<string, any>;
  error?: string;
  status?: number;
  duration?: number;
  userMessage?: string;
  response?: any;
  llmResponse?: string;
  isError?: boolean;
  fullPrompt?: any; // NEW: Full prompt for debugging
}> = [];
```

#### New UI Section (After line 336)
```svelte
<!-- Full Prompt Sent to LLM (for debugging) -->
{#if log.fullPrompt}
  <details class="mt-2">
    <summary class="cursor-pointer text-xs text-purple-400 hover:text-purple-300">
      📋 Full Prompt Sent to LLM
    </summary>
    <div class="mt-2 rounded bg-gray-950 p-3 space-y-3">
      <!-- System Prompt -->
      {#if log.fullPrompt.systemPrompt}
        <div>
          <div class="mb-1 text-xs font-semibold text-purple-300">System Prompt:</div>
          <pre class="...">{log.fullPrompt.systemPrompt}</pre>
        </div>
      {/if}

      <!-- Context (MCP Data) -->
      {#if log.fullPrompt.context}
        <div>
          <div class="mb-1 text-xs font-semibold text-cyan-300">
            Context (MCP Data):
            <span class="ml-1 font-normal text-gray-500">
              {log.fullPrompt.contextSize} chars,
              ~{Math.ceil(log.fullPrompt.contextSize / 4)} tokens
            </span>
          </div>
          <pre class="...">{log.fullPrompt.context}</pre>
        </div>
      {/if}

      <!-- Chat History -->
      {#if log.fullPrompt.chatHistory && log.fullPrompt.chatHistory.length > 0}
        <div>
          <div class="mb-1 text-xs font-semibold text-blue-300">
            Chat History: ({log.fullPrompt.chatHistory.length} messages)
          </div>
          <div class="space-y-1">
            {#each log.fullPrompt.chatHistory as msg, i}
              <div class="p-2 rounded bg-gray-900">
                <div class="text-xs font-semibold {msg.role === 'user' ? 'text-green-400' : 'text-blue-400'}">
                  {msg.role === 'user' ? '👤 User' : '🤖 Assistant'}:
                </div>
                <pre class="...">{msg.content}</pre>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- User Message -->
      {#if log.fullPrompt.userMessage}
        <div>
          <div class="mb-1 text-xs font-semibold text-green-300">Current User Message:</div>
          <pre class="...">{log.fullPrompt.userMessage}</pre>
        </div>
      {/if}

      <!-- Total Token Count -->
      {#if log.fullPrompt.totalTokens}
        <div class="pt-2 border-t border-gray-800">
          <div class="text-xs text-gray-400">
            <span class="font-semibold">Total Prompt Size:</span>
            ~{log.fullPrompt.totalTokens} tokens
          </div>
        </div>
      {/if}
    </div>
  </details>
{/if}
```

## Features

### 1. **System Prompt Display**
- Shows the complete system prompt including:
  - Base prompt (optimized or legacy)
  - Language context
  - Current settings (language, organization, stage)
  - Tool usage instructions

### 2. **Context Display**
- Shows MCP data formatted for the LLM
- Displays:
  - Scripture text
  - Translation notes
  - Translation words
  - Translation academy articles
  - Questions
- Includes character count and token estimate
- **Truncated to 10,000 chars** to prevent UI slowdown

### 3. **Chat History Display**
- Shows last 6 messages (same as sent to LLM)
- Visually distinguishes:
  - 👤 User messages (green)
  - 🤖 Assistant messages (blue)
- Each message is scrollable

### 4. **Current User Message**
- Shows the exact user query being processed

### 5. **Token Estimation**
- Displays approximate total token count
- Uses `estimateTokens()` function (1 token ≈ 4 chars)

## Usage

### How to Access

1. **Start chat session** on `http://localhost:8177/chat`
2. **Send a query** (e.g., "Show me John 3:16")
3. **Click debug console button** (bottom right, bug icon 🐛)
4. **Click on any MCP tool log entry**
5. **Expand "📋 Full Prompt Sent to LLM"** section

### What You'll See

```
📋 Full Prompt Sent to LLM

├── System Prompt:
│   You are a Bible study assistant that provides...
│   **LANGUAGE HANDLING:**
│   1. When user EXPLICITLY provides language code...
│   [Full system prompt with all rules]
│
├── Context (MCP Data): 5,234 chars, ~1,309 tokens
│   Available MCP Data:
│   Scripture for John 3:16:
│   - ULT: "For God so loved the world..."
│   [Full MCP response data]
│
├── Chat History: (2 messages)
│   👤 User: "Show me Genesis 1:1"
│   🤖 Assistant: "Here's Genesis 1:1..."
│
├── Current User Message:
│   "Show me John 3:16"
│
└── Total Prompt Size: ~2,150 tokens
```

## Benefits

### 1. **Debug Complex Prompts**
- See exactly what instructions the LLM receives
- Identify overly complex or conflicting instructions
- Verify context is formatted correctly

### 2. **Understand LLM Behavior**
- See why LLM made certain tool choices
- Understand token usage
- Debug unexpected responses

### 3. **Optimize Prompts**
- Identify redundant instructions
- Find opportunities to reduce token usage
- Test prompt variations

### 4. **Development Workflow**
```
1. User reports unexpected behavior
   ↓
2. Check debug console → "📋 Full Prompt Sent to LLM"
   ↓
3. Identify problematic instruction or missing context
   ↓
4. Update system prompt or context formatting
   ↓
5. Test and verify fix
```

## Performance Considerations

### Context Truncation
- Context is truncated to **10,000 chars** in the debug display
- Prevents UI slowdown with large MCP responses
- Shows truncation indicator: `"... (truncated)"`
- Full context is still used by the LLM (only display is truncated)

### Token Estimation
- Uses simple formula: `tokens ≈ chars / 4`
- Good enough for rough estimates
- Actual OpenAI tokenization may vary slightly

## Examples

### Example 1: Simple Query
```
User: "Show me John 3:16"

Full Prompt:
- System Prompt: ~800 tokens (simplified prompt)
- Context: ~200 tokens (single scripture verse)
- Chat History: 0 tokens (first message)
- User Message: ~5 tokens
- Total: ~1,005 tokens
```

### Example 2: Complex Query with History
```
User: "What do the notes say about that verse?"

Full Prompt:
- System Prompt: ~800 tokens
- Context: ~1,500 tokens (notes for previous verse)
- Chat History: ~300 tokens (last 6 messages)
- User Message: ~8 tokens
- Total: ~2,608 tokens
```

### Example 3: Multi-Language Context
```
User: "Show me John 3:16 in Spanish (es-419)"

Full Prompt:
- System Prompt: ~850 tokens (includes language context)
- Context: ~200 tokens (Spanish scripture)
- Chat History: 0 tokens
- User Message: ~10 tokens
- Total: ~1,060 tokens
```

## Use Cases

### 1. **Debugging Prompt Complexity**
**Problem:** LLM is calling wrong tools or making unnecessary API calls
**Solution:** Check "📋 Full Prompt" → Identify conflicting instructions

### 2. **Understanding Token Usage**
**Problem:** API costs are high
**Solution:** Check "Total Prompt Size" → Identify opportunities to reduce context

### 3. **Verifying Context**
**Problem:** LLM isn't using MCP data correctly
**Solution:** Check "Context (MCP Data)" → Verify data is formatted as expected

### 4. **Testing Prompt Changes**
**Problem:** Need to verify prompt optimization worked
**Solution:** Before/after comparison of "System Prompt" section

## Future Enhancements

Potential improvements:
1. **Copy to clipboard** button for each prompt section
2. **Download as JSON** for full prompt data
3. **Diff view** to compare prompts across queries
4. **Highlight changes** when prompt changes between queries
5. **Search/filter** within prompt sections
6. **Export to file** for sharing with team

---

**Date:** 2026-03-13
**Feature:** Full prompt debugging in chat debug console
**Status:** ✅ Implemented and working
**Files Modified:** 3 (chat-stream/+server.ts, ChatInterface.svelte, DebugSidebar.svelte)
