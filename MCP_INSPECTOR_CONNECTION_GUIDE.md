# How to Connect MCP Inspector to Local Server

## Important Note

The MCP Inspector command-line approach (`npx @modelcontextprotocol/inspector node ...`) is designed for **STDIO-based servers** that communicate via standard input/output.

**Your server is an HTTP endpoint** (SvelteKit), so you need to:

1. Start your server separately
2. Use the Inspector UI to connect via HTTP transport

## Prerequisites

1. **Start your local dev server:**

   ```bash
   cd ui
   npm run dev
   ```

   Your server should be running at `http://localhost:8177`

2. **Start the MCP Inspector:**

   ```bash
   npx @modelcontextprotocol/inspector
   ```

   The Inspector UI will open at `http://localhost:6274`

   > **Note:** The command-line approach (`npx @modelcontextprotocol/inspector node ...`) is for STDIO servers, not HTTP endpoints. For HTTP servers, you must use the UI.

## Connection Steps

### Using the Inspector UI (Required for HTTP Servers)

1. **Open the MCP Inspector** in your browser at `http://localhost:6274`

2. **Select Transport Type:**
   - In the "Server connection pane", click on the transport dropdown
   - Select **"HTTP"** or **"Streamable HTTP"** (not STDIO)

3. **Enter Server URL:**
   - In the connection URL field, enter:
     ```
     http://localhost:8177/api/mcp
     ```

4. **Click "Connect"**

5. **Verify Connection:**
   - You should see the server initialize
   - Tools list should appear in the Tools tab
   - Prompts list should appear in the Prompts tab
   - You can now test tools and prompts interactively

## Why Not Command-Line?

According to the [MCP Inspector documentation](https://modelcontextprotocol.io/docs/tools/inspector), the command-line approach is for STDIO servers:

```bash
# For STDIO servers (not applicable to HTTP endpoints)
npx @modelcontextprotocol/inspector node path/to/server/index.js
```

**Your server is an HTTP endpoint**, so:

- ✅ **Use the Inspector UI** with HTTP transport
- ❌ **Cannot use** the command-line STDIO approach

## Alternative: Convert to STDIO Server (Advanced)

If you want to use the command-line approach, you would need to create a separate STDIO-based MCP server (like the one in `src/index.ts`). However, for testing your HTTP endpoint, the UI approach is the correct method.

## Troubleshooting

### CORS Errors

✅ **Fixed!** We've added `mcp-protocol-version` to allowed headers.

### Connection Refused

- Make sure your dev server is running on port 8177
- Check: `curl http://localhost:8177/api/mcp` should return server info

### ZodError

- Make sure you've restarted the dev server after our fixes
- The response format should now match what Inspector expects

### 401 Unauthorized on `/config`

- This is normal - it's the Inspector's proxy trying to access its own config
- It doesn't affect the direct connection to your MCP server

## Verification

Before connecting, verify your server is working:

```bash
# Test OPTIONS (CORS preflight)
curl -X OPTIONS http://localhost:8177/api/mcp \
  -H "Origin: http://localhost:6274" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type, Authorization, mcp-protocol-version" \
  -v

# Test initialize
curl -X POST http://localhost:8177/api/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-protocol-version: 2024-11-05" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'
```

Both should return 200 OK.

## Expected Behavior

Once connected, you should see:

1. **Server Info:**
   - Name: `translation-helps-mcp`
   - Version: `7.3.0`
   - Protocol Version: `2024-11-05`

2. **Tools List:**
   - 13 tools available (fetch_scripture, fetch_translation_notes, etc.)

3. **Prompts List:**
   - 3 prompts available

4. **Ability to:**
   - Call tools with parameters
   - Get prompts
   - See responses in real-time

## Connection URL Summary

- **Direct HTTP:** `http://localhost:8177/api/mcp`
- **Transport Type:** HTTP / Streamable HTTP
- **No authentication required** for local testing
