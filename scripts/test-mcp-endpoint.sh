#!/bin/bash
# Test MCP HTTP Endpoint
# Tests the actual HTTP endpoint that MCP clients use

echo "🌐 Testing MCP HTTP Endpoint"
echo ""

# Start dev server in background (if not already running)
echo "Starting dev server..."
cd ui
npm run dev &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 5

# Test tools/list endpoint
echo ""
echo "📋 Testing tools/list endpoint..."
echo "─────────────────────────────────────────────"

RESPONSE=$(curl -s -X POST http://localhost:5173/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'

# Check for empty schemas
echo ""
echo "🔍 Checking for empty schemas..."

EMPTY_COUNT=$(echo "$RESPONSE" | jq '[.result.tools[] | select((.inputSchema | keys | length) == 1 and .inputSchema | has("$schema"))] | length')

if [ "$EMPTY_COUNT" -eq 0 ]; then
  echo "✅ SUCCESS: No empty schemas found!"
else
  echo "❌ FAILURE: Found $EMPTY_COUNT tools with empty schemas"
fi

# Show first tool's schema as example
echo ""
echo "📖 Example tool schema (first tool):"
echo "$RESPONSE" | jq '.result.tools[0] | {name, inputSchema}' | head -20

# Cleanup
echo ""
echo "Stopping dev server..."
kill $SERVER_PID 2>/dev/null

echo ""
echo "Done!"
