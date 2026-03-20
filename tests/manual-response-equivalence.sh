#!/bin/bash

# Manual Response Equivalence Tests
# Verifies MCP and REST return equivalent data

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Response Equivalence Tests"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_test() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo "TEST $TOTAL_TESTS: $1"
}

pass_test() {
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo -e "${GREEN}[PASS]${NC} $1"
    echo ""
}

fail_test() {
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo -e "${RED}[FAIL]${NC} $1"
    echo ""
}

# Health check
if ! curl -s "$SERVER_URL/api/health" > /dev/null; then
    echo "Server not running"
    exit 1
fi

# Helper function to compare JSON responses
# MCP wraps responses in content array, so extract inner JSON first
compare_responses() {
    local rest_response="$1"
    local mcp_response="$2"
    local check_field="$3"
    
    # Extract field from REST (direct JSON)
    rest_value=$(echo "$rest_response" | grep -o "\"$check_field\"" | wc -l)
    
    # Extract inner JSON from MCP wrapper (content[0].text contains stringified JSON)
    mcp_inner=$(echo "$mcp_response" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('result', {})
    content = result.get('content', [])
    if content and len(content) > 0:
        text = content[0].get('text', '')
        # The text field contains stringified JSON, print it
        print(text)
    else:
        print('{}')
except:
    print('{}')
" 2>/dev/null)
    
    # Now check if field exists in extracted inner JSON
    mcp_value=$(echo "$mcp_inner" | grep -o "\"$check_field\"" | wc -l)
    
    if [ "$rest_value" -gt 0 ] && [ "$mcp_value" -gt 0 ]; then
        return 0
    else
        return 1
    fi
}

# TEST 1: Scripture equivalence
run_test "fetch_scripture returns equivalent data (REST vs MCP)"

echo "  Fetching via REST..."
REST_SCRIPTURE=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=unfoldingWord")

echo "  Fetching via MCP..."
MCP_SCRIPTURE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"tools/call",
        "params":{
            "name":"fetch_scripture",
            "arguments":{"reference":"John 3:16","language":"en","organization":"unfoldingWord"}
        }
    }')

echo "  Comparing responses..."
if compare_responses "$REST_SCRIPTURE" "$MCP_SCRIPTURE" "scripture"; then
    if compare_responses "$REST_SCRIPTURE" "$MCP_SCRIPTURE" "metadata"; then
        pass_test "Scripture responses are equivalent"
    else
        fail_test "Scripture responses missing metadata match"
    fi
else
    fail_test "Scripture responses differ"
fi

# TEST 2: Translation Notes equivalence
run_test "fetch_translation_notes returns equivalent data"

echo "  Fetching via REST..."
REST_TN=$(curl -s "$SERVER_URL/api/fetch-translation-notes?reference=John+3:16&language=en&organization=unfoldingWord")

echo "  Fetching via MCP..."
MCP_TN=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"tools/call",
        "params":{
            "name":"fetch_translation_notes",
            "arguments":{"reference":"John 3:16","language":"en","organization":"unfoldingWord"}
        }
    }')

# Translation Notes uses "items" field, not "notes"
if compare_responses "$REST_TN" "$MCP_TN" "items"; then
    pass_test "Translation Notes responses are equivalent"
else
    fail_test "Translation Notes responses differ"
fi

# TEST 3: Translation Word equivalence
run_test "fetch_translation_word returns equivalent data"

echo "  Fetching via REST..."
REST_TW=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&organization=unfoldingWord")

echo "  Fetching via MCP..."
MCP_TW=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"tools/call",
        "params":{
            "name":"fetch_translation_word",
            "arguments":{"path":"kt/god","language":"en","organization":"unfoldingWord"}
        }
    }')

if compare_responses "$REST_TW" "$MCP_TW" "content"; then
    pass_test "Translation Word responses are equivalent"
else
    fail_test "Translation Word responses differ"
fi

# TEST 4: Translation Academy equivalence
run_test "fetch_translation_academy returns equivalent data"

echo "  Fetching via REST..."
REST_TA=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&organization=unfoldingWord")

echo "  Fetching via MCP..."
MCP_TA=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"tools/call",
        "params":{
            "name":"fetch_translation_academy",
            "arguments":{"path":"translate/figs-metaphor","language":"en","organization":"unfoldingWord"}
        }
    }')

if compare_responses "$REST_TA" "$MCP_TA" "content"; then
    pass_test "Translation Academy responses are equivalent"
else
    fail_test "Translation Academy responses differ"
fi

# TEST 5: List Languages equivalence
run_test "list_languages returns equivalent data"

echo "  Fetching via REST..."
REST_LANGS=$(curl -s "$SERVER_URL/api/list-languages")

echo "  Fetching via MCP..."
MCP_LANGS=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_languages","arguments":{}}}')

if compare_responses "$REST_LANGS" "$MCP_LANGS" "languages"; then
    pass_test "Languages list responses are equivalent"
else
    fail_test "Languages list responses differ"
fi

# TEST 6: Metadata consistency across both interfaces
run_test "Metadata fields are consistent"

echo "  Checking REST metadata..."
REST_HAS_META=$(echo "$REST_SCRIPTURE" | grep -o '"metadata"' | wc -l)

echo "  Checking MCP metadata..."
MCP_HAS_META=$(echo "$MCP_SCRIPTURE" | grep -o '"metadata"' | wc -l)

if [ "$REST_HAS_META" -gt 0 ] && [ "$MCP_HAS_META" -gt 0 ]; then
    pass_test "Both interfaces include metadata"
else
    fail_test "Metadata missing from one interface"
fi

# TEST 7: Error responses are equivalent
run_test "Error responses are equivalent"

echo "  Testing invalid request via REST..."
REST_ERROR=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Invalid&language=xyz")

echo "  Testing invalid request via MCP..."
MCP_ERROR=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"Invalid","language":"xyz"}}}')

if echo "$REST_ERROR" | grep -q "error" && echo "$MCP_ERROR" | grep -q "error"; then
    pass_test "Both interfaces return errors consistently"
else
    fail_test "Error handling differs between interfaces"
fi

# Summary
echo "==========================================="
echo "SUMMARY"
echo "==========================================="
echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ ALL RESPONSE EQUIVALENCE TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
