# Streamable HTTP with SSE Implementation

## Overview

This MCP server implements the **Streamable HTTP transport** as specified by Anthropic's Model Context Protocol (MCP). This allows AI clients (like Claude Desktop) to connect to our translation resources server over standard HTTP with optional Server-Sent Events (SSE) streaming.

**Specification Reference**: [MCP Streamable HTTP Transport](https://spec.modelcontextprotocol.io/specification/basic/transports/#http-with-sse)

---

## 🚀 Key Features

- ✅ **JSON-RPC 2.0 over HTTP** - Standard HTTP POST requests with JSON-RPC protocol
- ✅ **SSE Streaming** - Optional Server-Sent Events for real-time streaming responses
- ✅ **Session Management** - Stateful sessions with `MCP-Session-Id` header
- ✅ **Protocol Version Negotiation** - Supports multiple MCP protocol versions (`2024-11-05`, `2025-03-26`, `2025-11-25`)
- ✅ **Session Teardown** - DELETE endpoint for clean session termination
- ✅ **CORS Support** - Full CORS headers for cross-origin access
- ✅ **Dual Endpoints** - Both `/mcp` (streamable HTTP) and `/api/mcp` (legacy JSON-RPC)

---

## 📍 Endpoints

### 1. `/mcp` - Streamable HTTP Endpoint (Recommended)

This is the **primary endpoint** for MCP clients and follows the official MCP specification.

#### POST /mcp - Execute Tool Calls

**Request Format:**
```bash
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "MCP-Session-Id: <session-uuid>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "JHN 3:16",
        "language": "en"
      }
    },
    "id": 1
  }'
```

**Headers:**
- `Content-Type: application/json` - Required
- `Accept: application/json` or `text/event-stream` - For standard JSON or SSE streaming
- `MCP-Session-Id: <uuid>` - Optional. Server will create one if not provided
- `MCP-Protocol-Version: 2024-11-05` - Optional. Defaults to `2024-11-05`

**Response (Standard JSON):**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "For God so loved the world..."
      }
    ]
  },
  "id": 1
}
```

**Response Headers:**
```
Content-Type: application/json
MCP-Session-Id: 123e4567-e89b-12d3-a456-426614174000
MCP-Protocol-Version: 2024-11-05
```

#### GET /mcp - Endpoint Information

Returns metadata about the endpoint and session status.

```bash
curl -X GET http://localhost:5173/mcp \
  -H "MCP-Session-Id: <session-uuid>"
```

**Response:**
```json
{
  "endpoint": "/mcp",
  "transport": "streamable-http",
  "protocol": "2024-11-05",
  "features": ["sse", "session-management"],
  "session": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "active": true
  }
}
```

#### DELETE /mcp - Session Teardown

Terminates a session and cleans up server resources.

```bash
curl -X DELETE http://localhost:5173/mcp \
  -H "MCP-Session-Id: <session-uuid>"
```

**Response:**
```json
{
  "success": true,
  "sessionId": "123e4567-e89b-12d3-a456-426614174000",
  "deleted": true
}
```

---

### 2. `/api/mcp` - Legacy JSON-RPC Endpoint

This endpoint provides backwards compatibility but does not support SSE streaming.

**Key Differences:**
- ❌ No SSE streaming support
- ✅ Session management via `MCP-Session-Id` header
- ✅ Protocol version negotiation
- ✅ DELETE handler for session teardown

**Usage:** Same as `/mcp` but without `Accept: text/event-stream` support.

---

## 🔄 SSE Streaming Mode

When you set `Accept: text/event-stream`, the server returns responses as Server-Sent Events:

**Request:**
```bash
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "MCP-Session-Id: <session-uuid>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": { "name": "list_languages", "arguments": {} },
    "id": 1
  }'
```

**Response (SSE Stream):**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

event: message
data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"..."}]},"id":1}

event: endpoint
data: {}
```

**SSE Event Types:**
- `message` - Contains the JSON-RPC response data
- `endpoint` - Signals the end of the stream

---

## 🗂️ Session Management

Sessions are stored in-memory and automatically expire after **1 hour** of inactivity.

**Session Lifecycle:**

1. **Creation**: Server creates a session on first POST request (or if `MCP-Session-Id` header is missing)
2. **Tracking**: `MCP-Session-Id` header is returned with every response
3. **Reuse**: Send the same `MCP-Session-Id` in subsequent requests to reuse the session
4. **Expiration**: Sessions are automatically cleaned up after 1 hour of inactivity
5. **Teardown**: Clients can explicitly delete a session via `DELETE /mcp`

**Session Storage (Development):**
```typescript
// In-memory Map (use Redis/database in production)
const sessions = new Map<string, {
  created: Date;
  lastUsed: Date;
  data?: any;
}>();
```

---

## 🎯 MCP Protocol Versions

The server supports multiple MCP protocol versions:

| Version | Status | Description |
|---------|--------|-------------|
| `2024-11-05` | ✅ Default | Initial MCP specification |
| `2025-03-26` | ✅ Supported | Enhanced resource handling |
| `2025-11-25` | ✅ Supported | Latest protocol updates |

**Version Negotiation:**
- Client sends `MCP-Protocol-Version` header with desired version
- Server responds with `MCP-Protocol-Version` header indicating the version used
- If client doesn't specify, server defaults to `2024-11-05`

---

## 🔧 Integration Examples

### JavaScript SDK

```typescript
import { TranslationHelpsClient } from '@translation-helps/mcp-client';

// Connect to streamable HTTP endpoint
const client = new TranslationHelpsClient({
  serverUrl: 'http://localhost:5173/mcp',
  timeout: 90000
});

// Call a tool (SDK handles session management automatically)
const result = await client.callTool('fetch_scripture', {
  reference: 'JHN 3:16',
  language: 'en'
});
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "translation-helps": {
      "url": "http://localhost:5173/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### Python SDK

```python
from translation_helps import TranslationHelpsClient

# Connect to streamable HTTP endpoint
client = TranslationHelpsClient(
    server_url='http://localhost:5173/mcp',
    timeout=90000
)

# Call a tool
result = await client.call_tool('fetch_scripture', {
    'reference': 'JHN 3:16',
    'language': 'en'
})
```

---

## 🧪 Testing the Implementation

### Test Standard JSON-RPC

```bash
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

### Test SSE Streaming

```bash
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "list_languages",
      "arguments": {}
    },
    "id": 1
  }'
```

### Test Session Management

```bash
# Create session
SESSION_ID=$(curl -s -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}' | \
  grep -oP 'MCP-Session-Id: \K[^;]+')

# Reuse session
curl -X POST http://localhost:5173/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# Delete session
curl -X DELETE http://localhost:5173/mcp \
  -H "MCP-Session-Id: $SESSION_ID"
```

---

## 📊 Monitoring & Debugging

### Console Logs

The implementation includes comprehensive logging:

```typescript
console.log('[MCP SSE] POST request received', { sessionId, protocolVersion });
console.log('[MCP SSE] New session created:', sessionId);
console.log('[MCP SSE] Existing session accessed:', sessionId);
console.log('[MCP SSE] Session deleted:', sessionId, { existed });
console.log('[MCP SSE] Client requested SSE stream');
```

### Session Statistics

Check active sessions:
```bash
curl http://localhost:5173/mcp
```

### Error Handling

All errors return proper JSON-RPC error format:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": {
      "validBookCodes": [...],
      "invalidCode": "XYZ"
    }
  },
  "id": 1
}
```

---

## 🚀 Production Considerations

### 1. Session Storage

Replace in-memory Map with persistent storage:

```typescript
// Instead of:
const sessions = new Map();

// Use:
import { Redis } from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

// Store session
await redis.setex(`session:${sessionId}`, 3600, JSON.stringify(sessionData));
```

### 2. Rate Limiting

Add rate limiting per session/IP:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each session to 100 requests per windowMs
});
```

### 3. Metrics & Monitoring

Track endpoint performance:

```typescript
import { register, Counter, Histogram } from 'prom-client';

const requestCounter = new Counter({
  name: 'mcp_requests_total',
  help: 'Total number of MCP requests'
});

const responseDuration = new Histogram({
  name: 'mcp_response_duration_seconds',
  help: 'Response duration in seconds'
});
```

### 4. Load Balancing

For multiple server instances, use sticky sessions:

```nginx
upstream mcp_servers {
  ip_hash;
  server mcp1.example.com:5173;
  server mcp2.example.com:5173;
}
```

---

## 📚 Related Documentation

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Server-Sent Events (SSE) Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Translation Helps MCP API Reference](./docs/API_REFERENCE.md)

---

## ✅ Implementation Checklist

- [x] `/mcp` endpoint with JSON-RPC support
- [x] SSE streaming support (`Accept: text/event-stream`)
- [x] Session management with `MCP-Session-Id` header
- [x] Protocol version negotiation (`MCP-Protocol-Version`)
- [x] DELETE handler for session teardown
- [x] CORS support for cross-origin requests
- [x] Session expiration (1 hour timeout)
- [x] Automatic session cleanup
- [x] Comprehensive error handling
- [x] Console logging for debugging
- [x] UI integration (MCP Tools page)
- [x] SDK client integration
- [ ] Production session storage (Redis/database)
- [ ] Rate limiting per session
- [ ] Metrics & monitoring (Prometheus)
- [ ] Load balancing configuration

---

**Last Updated**: March 13, 2026
**Protocol Version**: 2024-11-05
**Status**: ✅ Production Ready (with in-memory sessions for development)
