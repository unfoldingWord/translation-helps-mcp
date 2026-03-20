#!/bin/bash

# Automatic Retry Mechanism Test Script
# Tests the internal server-side retry functionality

BASE_URL="${TEST_BASE_URL:-http://localhost:8174}"

echo "=========================================="
echo "Testing Automatic Retry Mechanism"
echo "Server: $BASE_URL"
echo "=========================================="
echo ""

# Test 1: Auto-retry with available book (Jonah in Spanish)
echo "✅ Test 1: Auto-retry es → es-419 with AVAILABLE book (Jonah)"
echo "Request: JON 1:1 in Spanish (es)"
echo "Expected: Success with es-419 scripture"
RESULT=$(curl -s "$BASE_URL/api/fetch-scripture?reference=JON+1:1&language=es&format=json")
HAS_SCRIPTURE=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print('scripture' in d)" 2>/dev/null)
if [ "$HAS_SCRIPTURE" = "True" ]; then
    LANG=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print(d.get('scripture', [{}])[0].get('citation', {}).get('language', 'N/A'))")
    echo "   ✅ SUCCESS - Language: $LANG"
else
    echo "   ❌ FAILED - No scripture returned"
fi
echo ""

# Test 2: Auto-retry with unavailable book (John in Spanish) - should show available books
echo "✅ Test 2: Auto-retry es → es-419 with UNAVAILABLE book (John)"
echo "Request: JHN 3:16 in Spanish (es)"
echo "Expected: Error with availableBooks list"
RESULT=$(curl -s "$BASE_URL/api/fetch-scripture?reference=JHN+3:16&language=es&format=json")
HAS_BOOKS=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print('availableBooks' in d.get('details', {}))" 2>/dev/null)
if [ "$HAS_BOOKS" = "True" ]; then
    BOOKS=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); books=list(set([b['name'] for b in d.get('details', {}).get('availableBooks', [])])); print(', '.join(books))")
    LANG=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print(d.get('details', {}).get('language', 'N/A'))")
    echo "   ✅ SUCCESS - Language: $LANG"
    echo "   ✅ Available books: $BOOKS"
else
    echo "   ❌ FAILED - No availableBooks in error"
fi
echo ""

# Test 3: Valid English request (baseline)
echo "✅ Test 3: Valid English request (baseline)"
echo "Request: JHN 3:16 in English"
echo "Expected: Multiple translations (ULT, UST, etc.)"
RESULT=$(curl -s "$BASE_URL/api/fetch-scripture?reference=JHN+3:16&language=en&format=json")
COUNT=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print(d.get('counts', {}).get('totalCount', 0))" 2>/dev/null)
if [ "$COUNT" -gt 0 ]; then
    echo "   ✅ SUCCESS - $COUNT translations found"
else
    echo "   ❌ FAILED - No scripture returned"
fi
echo ""

# Test 4: MCP protocol test (availableBooks)
echo "✅ Test 4: MCP JSON-RPC 2.0 protocol"
echo "Request: JHN 3:16 in Spanish via MCP"
echo "Expected: JSON-RPC error with availableBooks in data field"
RESULT=$(curl -s -X POST "$BASE_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "JHN 3:16",
        "language": "es",
        "format": "json"
      }
    },
    "id": 1
  }')
HAS_DATA=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print('data' in d.get('error', {}))" 2>/dev/null)
if [ "$HAS_DATA" = "True" ]; then
    BOOKS_COUNT=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('error', {}).get('data', {}).get('availableBooks', [])))")
    echo "   ✅ SUCCESS - $BOOKS_COUNT books in error.data.availableBooks"
else
    echo "   ❌ FAILED - No error.data field in JSON-RPC response"
fi
echo ""

# Test 5: MCP protocol test (successful retry)
echo "✅ Test 5: MCP successful auto-retry"
echo "Request: JON 1:1 in Spanish via MCP"
echo "Expected: Success result with es-419 scripture"
RESULT=$(curl -s -X POST "$BASE_URL/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_scripture",
      "arguments": {
        "reference": "JON 1:1",
        "language": "es",
        "format": "json"
      }
    },
    "id": 1
  }')
HAS_RESULT=$(echo "$RESULT" | python -c "import sys, json; d=json.load(sys.stdin); print('result' in d)" 2>/dev/null)
if [ "$HAS_RESULT" = "True" ]; then
    echo "   ✅ SUCCESS - MCP result returned"
else
    echo "   ❌ FAILED - MCP error returned"
fi
echo ""

echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Run these tests manually in the chat interface:"
echo "1. 'show me jonah 1:1 in spanish' → Should show Spanish text"
echo "2. 'show me john 3:16 in spanish' → Should suggest available books"
echo "3. 'show me john 3:16' → Should show English text (4 translations)"
echo ""
echo "Check debug panel for:"
echo "- 📖 Available Books display"
echo "- No JavaScript errors"
echo "- Proper retry status badges"
