# Chat Architecture & Tuning Guide

## 🏗️ **Architecture Overview**

The chat system connects to your MCP server through **multiple layers** for intelligent Bible study assistance:

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                  (ui/src/routes/(app)/chat/)                    │
│                                                                 │
│  • ChatInterface.svelte - Main chat UI                         │
│  • DebugSidebar.svelte - MCP call logs                         │
│  • XRayPanel.svelte - Performance traces                       │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ HTTP POST
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CHAT API ENDPOINT                          │
│              (ui/src/routes/api/chat-stream/)                   │
│                                                                 │
│  1. Receives user message + chat history                       │
│  2. Determines which MCP tools to call (via OpenAI)            │
│  3. Executes MCP tools in parallel                             │
│  4. Formats results for OpenAI context                         │
│  5. Calls OpenAI with MCP data + system prompt                 │
│  6. Returns AI response (+ debug data)                         │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ Uses SDK wrapper
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MCP CLIENT HELPER                          │
│                   (ui/src/lib/mcp/client.ts)                    │
│                                                                 │
│  • getMCPClient() - Creates SDK instance                       │
│  • listTools() - Discovers available tools                     │
│  • callTool() - Executes MCP tool                              │
│  • executePrompt() - Runs complex workflows                    │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ Uses official SDK
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                   TRANSLATION HELPS SDK                         │
│           (@translation-helps/mcp-client v1.4.0)                │
│                                                                 │
│  • TranslationHelpsClient class                                │
│  • Handles JSON-RPC 2.0 protocol                               │
│  • Error handling & retries                                    │
│  • Timeout management (90s default)                            │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ HTTP POST (JSON-RPC 2.0)
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP SERVER ENDPOINT                          │
│                    (ui/src/routes/mcp/)                         │
│                                                                 │
│  • Receives JSON-RPC requests                                  │
│  • Routes to tool handlers                                     │
│  • Supports SSE streaming                                      │
│  • Session management                                          │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP TOOL HANDLERS                            │
│              (src/tools/ & src/functions/)                      │
│                                                                 │
│  • fetch_scripture, fetch_translation_notes, etc.              │
│  • Resource discovery & caching                                │
│  • DCS API integration                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔌 **Connection Flow**

### **Step 1: User Sends Message**
```typescript
// ui/src/routes/(app)/chat/ChatInterface.svelte (line 473)
const response = await fetch('/api/chat-stream?stream=1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  },
  body: JSON.stringify({
    message: userMessage.content,
    chatHistory: messages.slice(0, -2).map((m) => ({ 
      role: m.role, 
      content: m.content 
    })),
    enableXRay: false
  })
});
```

### **Step 2: Chat API Discovers MCP Tools**
```typescript
// ui/src/routes/api/chat-stream/+server.ts (line 413)
import { callTool, listTools, listPrompts } from '$lib/mcp/client.js';

const tools = await listTools(serverUrl);
const prompts = await listPrompts(serverUrl);
```

### **Step 3: MCP Client Helper Uses SDK**
```typescript
// ui/src/lib/mcp/client.ts (lines 16-35)
export function getMCPClient(serverUrl?: string, enableMetrics = false): TranslationHelpsClient {
  const defaultServerUrl = '/mcp'; // ← Streamable HTTP endpoint
  
  if (!clientInstance) {
    clientInstance = new TranslationHelpsClient({
      serverUrl: serverUrl || defaultServerUrl,
      timeout: 90000, // 90 seconds for cold cache
      enableMetrics
    });
  }
  return clientInstance;
}

export async function callTool(
  name: string,
  arguments_: Record<string, any>,
  serverUrl?: string,
  enableMetrics = false
): Promise<MCPResponse> {
  await initializeMCPClient(serverUrl, enableMetrics);
  const client = getMCPClient(serverUrl, enableMetrics);
  return await client.callTool(name, arguments_);
}
```

### **Step 4: SDK Sends JSON-RPC Request**
```typescript
// packages/js-sdk/src/client.ts (simplified)
async callTool(name: string, args: Record<string, any>): Promise<MCPResponse> {
  const response = await fetch(this.serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: this.requestId++
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    // Error handling...
    throw new Error(data.error.message);
  }
  
  return data.result;
}
```

### **Step 5: MCP Server Executes Tool**
```typescript
// ui/src/routes/mcp/+server.ts (simplified)
if (method === 'tools/call') {
  const { name, arguments: args } = params;
  
  // Route to tool handler
  const result = await executeToolHandler(name, args);
  
  return json({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    id
  });
}
```

### **Step 6: Chat API Calls OpenAI**
```typescript
// ui/src/routes/api/chat-stream/+server.ts (line 1758)
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: `${context}\n\nUser: ${message}` }
    ],
    temperature: 0.3,
    stream: true,
    max_tokens: 2000
  })
});
```

---

## 🎛️ **Tuning Points**

### **1. MCP Client Configuration**

**File:** `ui/src/lib/mcp/client.ts`

```typescript
export function getMCPClient(serverUrl?: string, enableMetrics = false): TranslationHelpsClient {
  const defaultServerUrl = '/mcp'; // ← Change endpoint
  
  if (!clientInstance) {
    clientInstance = new TranslationHelpsClient({
      serverUrl: serverUrl || defaultServerUrl,
      timeout: 90000, // ← Adjust timeout (milliseconds)
      enableMetrics // ← Enable/disable metrics collection
    });
  }
  return clientInstance;
}
```

**Tuning Options:**
- **`serverUrl`**: Switch between `/mcp` (streamable HTTP) or `/api/mcp` (legacy)
- **`timeout`**: Increase for slow connections (90000ms = 90s)
- **`enableMetrics`**: Enable to collect response headers, timing, cache status

---

### **2. OpenAI Model & Parameters**

**File:** `ui/src/routes/api/chat-stream/+server.ts`

**Line 1765 (Streaming):**
```typescript
body: JSON.stringify({
  model: 'gpt-4o-mini', // ← Change model
  messages,
  temperature: 0.3,     // ← Adjust creativity (0-2)
  stream: true,
  max_tokens: 2000      // ← Adjust response length
})
```

**Line 1600 (Non-Streaming):**
```typescript
body: JSON.stringify({
  model: 'gpt-4o-mini', // ← Change model
  messages,
  temperature: 0.3,     // ← Adjust creativity (0-2)
  max_tokens: 2000      // ← Adjust response length
})
```

**Tuning Options:**

| Parameter | Current | Options | Effect |
|-----------|---------|---------|--------|
| `model` | `gpt-4o-mini` | `gpt-4o`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` | Quality vs speed/cost |
| `temperature` | `0.3` | `0.0` - `2.0` | Lower = factual, Higher = creative |
| `max_tokens` | `2000` | `1000` - `4096+` | Response length limit |

**Model Recommendations:**
- **`gpt-4o-mini`** (current) - Fast, cheap, good for most tasks
- **`gpt-4o`** - Better reasoning, more expensive
- **`gpt-4-turbo`** - Faster than gpt-4, good middle ground
- **`gpt-3.5-turbo`** - Cheapest, less capable

---

### **3. System Prompt**

**File:** `ui/src/routes/api/chat-stream/+server.ts`

**Lines 43-805** contain the massive system prompt that instructs the AI how to behave.

**Key sections to tune:**

**A. Prompt Selection (Line 1535):**
```typescript
const USE_OPTIMIZED_PROMPT = true; // ← Toggle between optimized vs legacy

const systemPrompt = USE_OPTIMIZED_PROMPT
  ? getSystemPrompt(requestType, availableTools, availablePrompts) // SDK-generated
  : SYSTEM_PROMPT_LEGACY; // Long hardcoded prompt
```

**Tuning Options:**
- **`USE_OPTIMIZED_PROMPT = true`** - Uses SDK's context-aware prompts (recommended)
- **`USE_OPTIMIZED_PROMPT = false`** - Uses legacy hardcoded prompt (more verbose)

**B. Request Type Detection:**
```typescript
// Uses SDK's detectRequestType() to analyze user message
const requestType = detectRequestType(message);
// Returns: 'discover' | 'passage' | 'term' | 'concept' | 'question' | 'general'
```

The SDK generates **different prompts** based on request type for optimal performance.

---

### **4. MCP Tool Call Determination**

**File:** `ui/src/routes/api/chat-stream/+server.ts` (Line 810)

```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  // ...
  body: JSON.stringify({
    model: 'gpt-4o-mini', // ← Uses AI to determine which tools to call
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that determines which API endpoints to call...'
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: message,
          availableEndpoints: endpoints,
          availablePrompts: prompts
        })
      }
    ],
    temperature: 0.0, // ← Very deterministic for tool selection
    response_format: { type: 'json_object' }
  })
});
```

**Tuning Options:**
- **Temperature:** Currently `0.0` for deterministic tool selection
- **Timeout:** `15000ms` (15 seconds)
- **Model:** Uses same model as main chat

---

### **5. Streaming vs Non-Streaming**

**File:** `ui/src/routes/(app)/chat/ChatInterface.svelte`

```typescript
const USE_STREAM = true; // ← Toggle streaming
```

**File:** `ui/src/routes/api/chat-stream/+server.ts` (Line 2054)

```typescript
const streamMode =
  url.searchParams.get('stream') === '1' ||
  (request.headers.get('accept') || '').includes('text/event-stream');

if (streamMode) {
  // Use Server-Sent Events (SSE) for streaming
  const sseStream = await callOpenAIStream(...);
  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store'
    }
  });
}
```

**Tuning Options:**
- **Enable streaming:** `?stream=1` query parameter OR set `Accept: text/event-stream` header
- **Disable streaming:** Remove query parameter, use standard JSON response

---

## 🎯 **Common Tuning Scenarios**

### **Scenario 1: Improve Response Quality**

**Current:** `gpt-4o-mini` with `temperature: 0.3`

**Option A: Use Better Model**
```typescript
// ui/src/routes/api/chat-stream/+server.ts (lines 1765, 1600)
model: 'gpt-4o' // ← Better reasoning, more expensive
```

**Option B: Adjust Temperature**
```typescript
temperature: 0.1 // ← More factual (for scripture quotes)
temperature: 0.5 // ← More creative (for explanations)
```

**Option C: Increase Max Tokens**
```typescript
max_tokens: 4000 // ← Longer, more detailed responses
```

---

### **Scenario 2: Faster Responses**

**Current:** Multiple steps with OpenAI calls

**Option A: Use Faster Model**
```typescript
model: 'gpt-3.5-turbo' // ← Much faster, slightly lower quality
```

**Option B: Reduce Timeout**
```typescript
// ui/src/lib/mcp/client.ts
timeout: 30000 // ← 30s instead of 90s (good for cached data)
```

**Option C: Skip Tool Determination Step**
```typescript
// In chat-stream/+server.ts, instead of calling OpenAI to determine tools,
// use rule-based logic to directly determine which tools to call
```

---

### **Scenario 3: Support Multiple AI Providers**

**Current:** Hardcoded to OpenAI

**To Add Anthropic/Claude:**

1. **Install Anthropic SDK:**
   ```bash
   cd ui
   npm install @anthropic-ai/sdk
   ```

2. **Update chat-stream/+server.ts:**
   ```typescript
   import Anthropic from '@anthropic-ai/sdk';
   
   const AI_PROVIDER = env.AI_PROVIDER || 'openai'; // 'openai' or 'anthropic'
   
   if (AI_PROVIDER === 'anthropic') {
     const anthropic = new Anthropic({
       apiKey: env.ANTHROPIC_API_KEY
     });
     
     const response = await anthropic.messages.create({
       model: 'claude-3-5-sonnet-20241022',
       max_tokens: 2000,
       temperature: 0.3,
       messages: [
         { role: 'user', content: `${context}\n\nUser: ${message}` }
       ]
     });
     
     return response.content[0].text;
   }
   ```

3. **Add environment variable:**
   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   AI_PROVIDER=anthropic
   ```

---

### **Scenario 4: Optimize for Lower Token Usage**

**Current:** Full system prompt + all chat history sent to OpenAI

**Option A: Use Optimized Prompts (Already Enabled)**
```typescript
const USE_OPTIMIZED_PROMPT = true; // ✅ Already using SDK's optimized prompts
```

**Option B: Limit Chat History**
```typescript
// ui/src/routes/(app)/chat/ChatInterface.svelte
chatHistory: messages.slice(-4).map(...) // ← Only last 4 messages instead of all
```

**Option C: Reduce System Prompt Size**
```typescript
// Edit the SYSTEM_PROMPT_LEGACY or SDK's getSystemPrompt() to be more concise
```

---

### **Scenario 5: Enable Debug/Metrics Mode**

**Current:** `enableMetrics = false` by default

**Enable Full Diagnostics:**

1. **Enable SDK metrics:**
   ```typescript
   // ui/src/lib/mcp/client.ts
   export function getMCPClient(serverUrl?: string, enableMetrics = true) { // ← true
     // ...
     enableMetrics: true // Collects response headers, timing, cache status
   }
   ```

2. **Enable X-Ray traces:**
   ```typescript
   // ui/src/routes/(app)/chat/ChatInterface.svelte
   enableXRay: true // ← Include in request body
   ```

3. **Check debug logs:**
   - The chat UI has a **Debug Sidebar** (DebugSidebar.svelte) that logs all MCP calls
   - Shows: Tool name, parameters, response, duration, errors
   - Access via the UI's debug panel

---

## 🔧 **Key Configuration Files**

### **1. Environment Variables**

**File:** `.env` (create if missing, see `.env.example`)

```bash
# Required for chat functionality
OPENAI_API_KEY=sk-...

# Optional: Switch AI providers
AI_PROVIDER=openai  # or 'anthropic'
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Custom MCP endpoint
MCP_SERVER_URL=https://tc-helps.mcp.servant.bible/mcp
```

### **2. MCP Client Configuration**

**File:** `ui/src/lib/mcp/client.ts`

```typescript
export function getMCPClient(serverUrl?: string, enableMetrics = false): TranslationHelpsClient {
  const defaultServerUrl = '/mcp'; // ← LOCAL: Use relative path
  // For remote: 'https://tc-helps.mcp.servant.bible/mcp'
  
  return new TranslationHelpsClient({
    serverUrl: serverUrl || defaultServerUrl,
    timeout: 90000,      // ← Tune for your use case
    enableMetrics        // ← Enable for debugging
  });
}
```

### **3. Chat UI Configuration**

**File:** `ui/src/routes/(app)/chat/ChatInterface.svelte`

```typescript
const USE_STREAM = true; // ← Enable/disable streaming responses
```

---

## 📊 **Performance Optimization**

### **Current Performance Profile**

From the logs you showed:
- **Scripture:** ~700-900ms (3 resources, all cached, parallel fetch ✅)
- **Translation Questions:** ~100ms (cached)
- **Translation Word Links:** ~100ms (cached)
- **Translation Notes:** ~100ms (cached)

**Why scripture is still slow despite parallel fetching:**
- Check if compilation error from earlier is still present
- The parallel fetch was added but may not have compiled correctly

---

## 🐛 **Debugging Tools**

### **1. Debug Sidebar (Built-in)**

The chat UI includes a **DebugSidebar** component that logs ALL MCP calls:

```typescript
// ui/src/routes/(app)/chat/ChatInterface.svelte (lines 48-63)
let debugLogs: Array<{
  id: string;
  timestamp: Date;
  type: 'mcp-tool' | 'mcp-prompt' | 'network' | 'llm' | 'other';
  endpoint?: string;
  params?: Record<string, any>;
  error?: string;
  status?: number;
  duration?: number;
  response?: any; // Full MCP server response
  llmResponse?: string; // LLM's final response
  isError?: boolean;
  requestId?: string;
}> = [];
```

**Access:** Click the debug icon in the chat UI

### **2. X-Ray Performance Traces**

**Enable X-Ray:**
```typescript
// When calling chat API
fetch('/api/chat-stream', {
  body: JSON.stringify({
    message: '...',
    enableXRay: true // ← Include performance traces
  })
});
```

**View Traces:** Click the performance icon in the chat UI

### **3. SDK Metrics**

**Enable metrics collection:**
```typescript
// ui/src/lib/mcp/client.ts
getMCPClient(serverUrl, true); // ← enableMetrics = true
```

**What you get:**
- Response time (ms)
- Cache status (hit/miss/bypass)
- HTTP status code
- All response headers
- X-Ray trace data (if available)

---

## 🚀 **Quick Tuning Checklist**

### **For Better Quality:**
- [ ] Switch to `gpt-4o` (line 1765, 1600 in chat-stream/+server.ts)
- [ ] Lower temperature to `0.1` for more factual responses
- [ ] Increase `max_tokens` to `4000` for longer explanations

### **For Faster Responses:**
- [ ] Use `gpt-3.5-turbo` (cheaper, faster)
- [ ] Reduce SDK timeout to `30000` (30s)
- [ ] Limit chat history to last 4 messages

### **For Debugging:**
- [ ] Enable `enableMetrics: true` in client.ts
- [ ] Enable `enableXRay: true` in chat requests
- [ ] Check DebugSidebar logs in UI

### **For Cost Optimization:**
- [ ] Keep `gpt-4o-mini` (current)
- [ ] Use `USE_OPTIMIZED_PROMPT = true` (current)
- [ ] Limit `max_tokens` to `1500`

---

## 📝 **Architecture Summary**

### **Data Flow:**

1. **User Message** → ChatInterface.svelte
2. **HTTP POST** → `/api/chat-stream` endpoint
3. **Discover Tools** → `listTools()` via SDK
4. **AI Determines Tools** → OpenAI analyzes message
5. **Execute MCP Tools** → `callTool()` via SDK (parallel)
6. **Format Context** → MCP results → text context
7. **AI Generates Response** → OpenAI with MCP data + system prompt
8. **Stream/Return** → SSE or JSON to UI

### **Key Technologies:**

- **Frontend:** SvelteKit + Svelte 5
- **MCP SDK:** `@translation-helps/mcp-client` v1.4.0 (TypeScript)
- **MCP Protocol:** JSON-RPC 2.0 over HTTP (with SSE support)
- **AI Provider:** OpenAI GPT-4o-mini
- **Streaming:** Server-Sent Events (SSE)
- **Caching:** R2 (ZIP files), KV (catalog), Memory (runtime)

---

## 🎓 **Next Steps for Tuning**

1. **Test different models** - Compare quality vs speed
2. **Adjust temperature** - Find sweet spot for your use case
3. **Enable metrics** - Measure actual performance
4. **Optimize system prompt** - Remove unnecessary instructions
5. **Consider caching OpenAI responses** - For repeated queries

---

**Questions for you:**

1. What specific aspect do you want to tune? (quality, speed, cost, accuracy)
2. Are you having issues with the current setup?
3. Would you like to add support for other AI providers (Anthropic Claude, Google Gemini)?

Let me know and I can help you make targeted improvements! 🎯
