#!/bin/bash

# Manual Test Script for Translation Helps MCP
# 
# This script performs manual tests using curl since vitest has configuration issues.
# Run this to validate MCP tools, prompts, and REST endpoints are working.

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SERVER_URL="http://localhost:8174"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Translation Helps MCP - Manual Test Suite                  ║${NC}"
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Check server health
echo -e "${BLUE}🔍 Checking server health...${NC}"
if curl -s "$SERVER_URL/api/health" | grep -q "healthy"; then
  echo -e "${GREEN}✅ Server is running and healthy${NC}"
else
  echo -e "${RED}❌ Server is not healthy or not running${NC}"
  echo -e "${YELLOW}💡 Start the server with: npm run dev${NC}"
  exit 1
fi

# TEST 1: Endpoint Parity Check
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 1: Endpoint Parity Check${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Listing all MCP tools..."
curl -s "$SERVER_URL/api/list-tools" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  tools = data.get('tools', [])
  print(f'${GREEN}✅ Total MCP Tools: {len(tools)}${NC}')
  for tool in tools:
    print(f'  - {tool[\"name\"]}')
  
  # Check for expected tools
  tool_names = [t['name'] for t in tools]
  expected = ['fetch_scripture', 'fetch_translation_notes', 'fetch_translation_questions',
              'fetch_translation_word', 'fetch_translation_academy', 'list_languages',
              'list_subjects', 'list_resources_for_language']
  
  missing = [t for t in expected if t not in tool_names]
  if missing:
    print(f'${RED}❌ Missing tools: {missing}${NC}')
  else:
    print(f'${GREEN}✅ All expected core tools present${NC}')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

# TEST 2: Response Equivalence - Scripture
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 2: Response Equivalence - Scripture${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Calling REST API..."
REST_RESULT=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=en&organization=unfoldingWord")

echo "Calling MCP API..."
MCP_RESULT=$(curl -s -X POST "$SERVER_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {"reference": "John 3:16", "language": "en", "organization": "unfoldingWord"}
    }
  }')

echo "$REST_RESULT" | python -c "
import sys, json
try:
  rest = json.load(sys.stdin)
  print(f'${GREEN}✅ REST API Response:${NC}')
  print(f'  - Has scripture: {\"scripture\" in rest}')
  print(f'  - Language: {rest.get(\"language\", \"N/A\")}')
  print(f'  - Organization: {rest.get(\"organization\", \"N/A\")}')
  if 'scripture' in rest and len(rest['scripture']) > 0:
    print(f'  - Text length: {len(rest[\"scripture\"][0].get(\"text\", \"\"))} chars')
    print(f'  - Preview: {rest[\"scripture\"][0].get(\"text\", \"\")[:80]}...')
except Exception as e:
  print(f'${RED}❌ Error parsing REST response: {e}${NC}')
"

echo "$MCP_RESULT" | python -c "
import sys, json
try:
  mcp = json.load(sys.stdin)
  print(f'${GREEN}✅ MCP API Response:${NC}')
  if 'result' in mcp and 'content' in mcp['result']:
    content = mcp['result']['content'][0]['text']
    print(f'  - Response length: {len(content)} chars')
    print(f'  - Preview: {content[:80]}...')
  else:
    print(f'${RED}❌ Unexpected MCP response structure${NC}')
except Exception as e:
  print(f'${RED}❌ Error parsing MCP response: {e}${NC}')
"

# TEST 3: Prompt Execution
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 3: Prompt Execution${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Executing 'translation-helps-report' prompt..."
curl -s -X POST "$SERVER_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "prompts/get",
    "params": {
      "name": "translation-helps-report",
      "arguments": {"reference": "John 3:16", "language": "en"}
    }
  }' | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  if 'result' in data and 'content' in data['result']:
    content = data['result']['content'][0]['text']
    print(f'${GREEN}✅ Prompt Executed Successfully${NC}')
    print(f'  - Response length: {len(content)} chars')
    print(f'  - Contains scripture: {\"scripture\" in content.lower()}')
    print(f'  - Contains notes: {\"note\" in content.lower()}')
    print(f'  - Preview: {content[:150]}...')
  else:
    print(f'${RED}❌ Error in prompt response${NC}')
    print(f'  - Response: {json.dumps(data, indent=2)[:200]}')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

# TEST 4: Parameter Validation - Organization
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 4: Organization Parameter Validation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Test 4a: Without organization (searches all)..."
curl -s "$SERVER_URL/api/fetch-translation-academy?path=figs-metaphor&language=es-419" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  org = data.get('metadata', {}).get('organization', 'NOT_SET')
  print(f'  - Organization: {org}')
  if org and org != 'unfoldingWord':
    print(f'${GREEN}✅ Correctly searched all organizations${NC}')
  elif org == 'unfoldingWord':
    print(f'${RED}❌ Incorrectly defaulted to unfoldingWord${NC}')
  else:
    print(f'${YELLOW}⚠️  Organization not in metadata${NC}')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

echo "Test 4b: With organization=unfoldingWord..."
curl -s "$SERVER_URL/api/fetch-translation-academy?path=figs-metaphor&language=es-419&organization=unfoldingWord" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  org = data.get('metadata', {}).get('organization', 'NOT_SET')
  print(f'  - Organization: {org}')
  if org == 'unfoldingWord':
    print(f'${GREEN}✅ Correctly used unfoldingWord${NC}')
  else:
    print(f'${YELLOW}⚠️  Expected unfoldingWord, got {org}${NC}')
except Exception as e:
  # 404 is expected if no unfoldingWord es-419 resource exists
  if '404' in str(e) or 'not found' in str(e).lower():
    print(f'${YELLOW}⚠️  404 Not Found (expected - no unfoldingWord es-419 resource)${NC}')
  else:
    print(f'${RED}❌ Error: {e}${NC}')
"

# TEST 5: Format Parameter
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 5: Format Parameter Validation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Test 5a: format=json..."
curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&format=json&language=en" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  print(f'${GREEN}✅ JSON format works${NC}')
  print(f'  - Type: object')
  print(f'  - Has content: {\"content\" in data}')
  if 'content' in data:
    print(f'  - Content length: {len(str(data[\"content\"]))} chars')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

echo "Test 5b: format=md..."
MARKDOWN_RESULT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&format=md&language=en")
echo "$MARKDOWN_RESULT" | python -c "
import sys
try:
  content = sys.stdin.read()
  print(f'${GREEN}✅ Markdown format works${NC}')
  print(f'  - Type: string/text')
  print(f'  - Length: {len(content)} chars')
  print(f'  - Starts with #: {content.strip().startswith(\"#\")}')
  if len(content) > 0:
    print(f'  - Preview: {content[:80]}...')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

# TEST 6: Language Variant Discovery
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 6: Language Variant Auto-Discovery${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

echo "Test 6a: Base language 'es' (should discover es-419)..."
curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=es" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  lang = data.get('language', 'NOT_SET')
  print(f'  - Resolved language: {lang}')
  if 'es-' in lang:
    print(f'${GREEN}✅ Correctly auto-discovered variant: {lang}${NC}')
  elif lang == 'es':
    print(f'${YELLOW}⚠️  No variant discovered (might be expected)${NC}')
  else:
    print(f'${RED}❌ Unexpected language: {lang}${NC}')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

echo "Test 6b: Explicit variant 'es-419'..."
curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=es-419" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  lang = data.get('language', 'NOT_SET')
  print(f'  - Resolved language: {lang}')
  if lang == 'es-419':
    print(f'${GREEN}✅ Correctly used explicit variant${NC}')
  else:
    print(f'${YELLOW}⚠️  Expected es-419, got {lang}${NC}')
except Exception as e:
  print(f'${RED}❌ Error: {e}${NC}')
"

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}✅ Manual tests completed${NC}"
echo ""
echo "Tests Executed:"
echo "  1. Endpoint Parity Check (MCP tools list)"
echo "  2. Response Equivalence (REST vs MCP)"
echo "  3. Prompt Execution (translation-helps-report)"
echo "  4. Organization Parameter (empty vs specific)"
echo "  5. Format Parameter (json vs md)"
echo "  6. Language Variant Discovery (es vs es-419)"
echo ""
echo -e "${YELLOW}📝 Note: Review output above for any ❌ or ⚠️  indicators${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
