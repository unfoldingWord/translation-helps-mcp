#!/bin/bash
# Test MCP Schema Fix in Production
# Tests the deployed Cloudflare endpoint to verify schemas are complete

set -e

PRODUCTION_URL="${1:-https://tc-helps.mcp.servant.bible/api/mcp}"

echo "🌐 Testing MCP Production Endpoint"
echo "URL: $PRODUCTION_URL"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Call tools/list
echo "📋 Test 1: Fetching tools/list..."
RESPONSE=$(curl -s -X POST "$PRODUCTION_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }')

# Check if response is valid JSON
if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
  echo -e "${RED}❌ FAILED: Invalid JSON response${NC}"
  echo "$RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Received valid JSON response${NC}"

# Test 2: Check for empty schemas
echo ""
echo "🔍 Test 2: Checking for empty schemas..."
EMPTY_COUNT=$(echo "$RESPONSE" | jq '[.result.tools[]? | select((.inputSchema | keys | length) == 1 and .inputSchema | has("$schema"))] | length')

if [ "$EMPTY_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✅ SUCCESS: No empty schemas found!${NC}"
else
  echo -e "${RED}❌ FAILURE: Found $EMPTY_COUNT tools with empty schemas${NC}"
  echo ""
  echo "Empty tools:"
  echo "$RESPONSE" | jq -r '.result.tools[]? | select((.inputSchema | keys | length) == 1) | .name'
  exit 1
fi

# Test 3: Count tools and parameters
echo ""
echo "📊 Test 3: Counting tools and parameters..."
TOOL_COUNT=$(echo "$RESPONSE" | jq '.result.tools? | length')
TOTAL_PARAMS=$(echo "$RESPONSE" | jq '[.result.tools[]? | .inputSchema.properties? // {} | keys | length] | add')

echo -e "${GREEN}✅ Found $TOOL_COUNT tools with $TOTAL_PARAMS total parameters${NC}"

# Test 4: Verify specific critical tools
echo ""
echo "🔎 Test 4: Verifying critical tools..."
CRITICAL_TOOLS=("fetch_scripture" "fetch_translation_notes" "fetch_translation_word" "list_resources_for_language")

for TOOL in "${CRITICAL_TOOLS[@]}"; do
  TOOL_EXISTS=$(echo "$RESPONSE" | jq -r ".result.tools[]? | select(.name == \"$TOOL\") | .name" 2>/dev/null || echo "")
  
  if [ -n "$TOOL_EXISTS" ]; then
    PARAM_COUNT=$(echo "$RESPONSE" | jq -r ".result.tools[]? | select(.name == \"$TOOL\") | .inputSchema.properties? // {} | keys | length")
    echo -e "  ${GREEN}✅ $TOOL${NC} - $PARAM_COUNT parameters"
  else
    echo -e "  ${RED}❌ $TOOL${NC} - NOT FOUND"
    exit 1
  fi
done

# Test 5: Show example schema
echo ""
echo "📖 Test 5: Example schema (fetch_scripture):"
echo "$RESPONSE" | jq '.result.tools[]? | select(.name == "fetch_scripture") | .inputSchema' | head -30

# Test 6: Verify reference parameter
echo ""
echo "🔍 Test 6: Verifying 'reference' parameter in fetch_scripture..."
HAS_REFERENCE=$(echo "$RESPONSE" | jq -r '.result.tools[]? | select(.name == "fetch_scripture") | .inputSchema.properties.reference // empty')

if [ -n "$HAS_REFERENCE" ]; then
  echo -e "${GREEN}✅ 'reference' parameter found${NC}"
  echo "$RESPONSE" | jq '.result.tools[]? | select(.name == "fetch_scripture") | .inputSchema.properties.reference'
else
  echo -e "${RED}❌ 'reference' parameter missing${NC}"
  exit 1
fi

# Summary
echo ""
echo "─────────────────────────────────────────────────────────────"
echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
echo ""
echo "Summary:"
echo "  • Total tools: $TOOL_COUNT"
echo "  • Total parameters: $TOTAL_PARAMS"
echo "  • Empty schemas: 0"
echo "  • Critical tools verified: ${#CRITICAL_TOOLS[@]}"
echo ""
echo -e "${GREEN}✅ MCP schema fix is working correctly in production!${NC}"
echo "─────────────────────────────────────────────────────────────"
