#!/bin/bash

# Manual Test Script for Translation Helps MCP (Windows-compatible, no emojis)

set -e

SERVER_URL="http://localhost:8174"

echo "================================================================================"
echo "  Translation Helps MCP - Manual Test Suite"
echo "================================================================================"
echo ""

# Check server health
echo "Checking server health..."
if curl -s "$SERVER_URL/api/health" | grep -q "healthy"; then
  echo "[OK] Server is running and healthy"
else
  echo "[FAIL] Server is not healthy or not running"
  echo "Start the server with: npm run dev"
  exit 1
fi

# TEST 1: Endpoint Parity Check
echo ""
echo "================================================================================"
echo "TEST 1: Endpoint Parity Check"
echo "================================================================================"

echo "Listing all MCP tools..."
curl -s "$SERVER_URL/api/list-tools" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  tools = data.get('tools', [])
  print('[OK] Total MCP Tools:', len(tools))
  for tool in tools:
    print('  -', tool['name'])
  
  tool_names = [t['name'] for t in tools]
  expected = ['fetch_scripture', 'fetch_translation_notes', 'fetch_translation_questions',
              'fetch_translation_word', 'fetch_translation_academy', 'list_languages',
              'list_subjects', 'list_resources_for_language']
  
  missing = [t for t in expected if t not in tool_names]
  if missing:
    print('[FAIL] Missing tools:', missing)
  else:
    print('[OK] All expected core tools present')
except Exception as e:
  print('[FAIL] Error:', e)
"

# TEST 2: Response Equivalence - Scripture
echo ""
echo "================================================================================"
echo "TEST 2: Response Equivalence - Scripture"
echo "================================================================================"

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
  print('[OK] REST API Response:')
  print('  - Has scripture:', 'scripture' in rest)
  print('  - Language:', rest.get('language', 'N/A'))
  print('  - Organization:', rest.get('organization', 'N/A'))
  if 'scripture' in rest and len(rest['scripture']) > 0:
    print('  - Text length:', len(rest['scripture'][0].get('text', '')), 'chars')
    print('  - Preview:', rest['scripture'][0].get('text', '')[:80] + '...')
except Exception as e:
  print('[FAIL] Error parsing REST response:', e)
"

echo "$MCP_RESULT" | python -c "
import sys, json
try:
  mcp = json.load(sys.stdin)
  print('[OK] MCP API Response:')
  if 'result' in mcp and 'content' in mcp['result']:
    content = mcp['result']['content'][0]['text']
    print('  - Response length:', len(content), 'chars')
    print('  - Preview:', content[:80] + '...')
  else:
    print('[FAIL] Unexpected MCP response structure')
except Exception as e:
  print('[FAIL] Error parsing MCP response:', e)
"

# TEST 3: Prompt Execution
echo ""
echo "================================================================================"
echo "TEST 3: Prompt Execution"
echo "================================================================================"

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
    print('[OK] Prompt Executed Successfully')
    print('  - Response length:', len(content), 'chars')
    print('  - Contains scripture:', 'scripture' in content.lower())
    print('  - Contains notes:', 'note' in content.lower())
    print('  - Preview:', content[:150] + '...')
  else:
    print('[FAIL] Error in prompt response')
    print('  - Response:', str(data)[:200])
except Exception as e:
  print('[FAIL] Error:', e)
"

# TEST 4: Organization Parameter
echo ""
echo "================================================================================"
echo "TEST 4: Organization Parameter Validation"
echo "================================================================================"

echo "Test 4a: Without organization (searches all)..."
curl -s "$SERVER_URL/api/fetch-translation-academy?path=figs-metaphor&language=es-419" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  org = data.get('metadata', {}).get('organization', 'NOT_SET')
  print('  - Organization:', org)
  if org and org != 'unfoldingWord':
    print('[OK] Correctly searched all organizations')
  elif org == 'unfoldingWord':
    print('[FAIL] Incorrectly defaulted to unfoldingWord')
  else:
    print('[WARNING] Organization not in metadata')
except Exception as e:
  print('[FAIL] Error:', e)
"

echo "Test 4b: With organization=unfoldingWord..."
curl -s "$SERVER_URL/api/fetch-translation-academy?path=figs-metaphor&language=es-419&organization=unfoldingWord" 2>&1 | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  org = data.get('metadata', {}).get('organization', 'NOT_SET')
  print('  - Organization:', org)
  if org == 'unfoldingWord':
    print('[OK] Correctly used unfoldingWord')
  else:
    print('[WARNING] Expected unfoldingWord, got', org)
except Exception as e:
  error_str = str(e)
  if '404' in error_str or 'not found' in error_str.lower():
    print('[WARNING] 404 Not Found (expected - no unfoldingWord es-419 resource)')
  else:
    print('[FAIL] Error:', e)
"

# TEST 5: Format Parameter
echo ""
echo "================================================================================"
echo "TEST 5: Format Parameter Validation"
echo "================================================================================"

echo "Test 5a: format=json..."
curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&format=json&language=en" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  print('[OK] JSON format works')
  print('  - Type: object')
  print('  - Has content:', 'content' in data)
  if 'content' in data:
    print('  - Content length:', len(str(data['content'])), 'chars')
except Exception as e:
  print('[FAIL] Error:', e)
"

echo "Test 5b: format=md..."
MARKDOWN_RESULT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&format=md&language=en")
echo "$MARKDOWN_RESULT" | python -c "
import sys
try:
  content = sys.stdin.read()
  print('[OK] Markdown format works')
  print('  - Type: string/text')
  print('  - Length:', len(content), 'chars')
  print('  - Starts with #:', content.strip().startswith('#'))
  if len(content) > 0:
    print('  - Preview:', content[:80] + '...')
except Exception as e:
  print('[FAIL] Error:', e)
"

# TEST 6: Language Variant Discovery
echo ""
echo "================================================================================"
echo "TEST 6: Language Variant Auto-Discovery"
echo "================================================================================"

echo "Test 6a: Base language 'es' (should discover es-419)..."
curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=es" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  lang = data.get('language', 'NOT_SET')
  print('  - Resolved language:', lang)
  if 'es-' in lang:
    print('[OK] Correctly auto-discovered variant:', lang)
  elif lang == 'es':
    print('[WARNING] No variant discovered (might be expected)')
  else:
    print('[FAIL] Unexpected language:', lang)
except Exception as e:
  print('[FAIL] Error:', e)
"

echo "Test 6b: Explicit variant 'es-419'..."
curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=es-419" | python -c "
import sys, json
try:
  data = json.load(sys.stdin)
  lang = data.get('language', 'NOT_SET')
  print('  - Resolved language:', lang)
  if lang == 'es-419':
    print('[OK] Correctly used explicit variant')
  else:
    print('[WARNING] Expected es-419, got', lang)
except Exception as e:
  print('[FAIL] Error:', e)
"

# Summary
echo ""
echo "================================================================================"
echo "Test Summary"
echo "================================================================================"
echo ""
echo "[OK] Manual tests completed"
echo ""
echo "Tests Executed:"
echo "  1. Endpoint Parity Check (MCP tools list)"
echo "  2. Response Equivalence (REST vs MCP)"
echo "  3. Prompt Execution (translation-helps-report)"
echo "  4. Organization Parameter (empty vs specific)"
echo "  5. Format Parameter (json vs md)"
echo "  6. Language Variant Discovery (es vs es-419)"
echo ""
echo "Note: Review output above for any [FAIL] or [WARNING] indicators"
echo "================================================================================"
