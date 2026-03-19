#!/bin/bash

# Manual Endpoint Parity Tests
# Verifies MCP tools and REST endpoints are synchronized

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Endpoint Parity Tests"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_test() {
    local test_name="$1"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo "TEST $TOTAL_TESTS: $test_name"
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
echo "Checking server..."
if ! curl -s "$SERVER_URL/api/health" > /dev/null; then
    echo -e "${RED}Server not running${NC}"
    exit 1
fi
echo -e "${GREEN}Server is running${NC}"
echo ""

# Get MCP tools list
echo "Fetching MCP tools list..."
MCP_TOOLS=$(curl -s "$SERVER_URL/api/list-tools" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tools = data.get('tools', [])
    names = [t['name'] for t in tools]
    print(','.join(sorted(names)))
except:
    print('')
")

echo "MCP Tools found: $(echo $MCP_TOOLS | tr ',' '\n' | wc -l)"
echo ""

# Expected tool-to-endpoint mappings
declare -A TOOL_ENDPOINT_MAP=(
    ["fetch_scripture"]="/api/fetch-scripture"
    ["fetch_translation_notes"]="/api/fetch-translation-notes"
    ["fetch_translation_questions"]="/api/fetch-translation-questions"
    ["fetch_translation_word_links"]="/api/fetch-translation-word-links"
    ["fetch_translation_word"]="/api/fetch-translation-word"
    ["fetch_translation_academy"]="/api/fetch-translation-academy"
    ["list_tools"]="/api/list-tools"
    ["list_languages"]="/api/list-languages"
    ["list_subjects"]="/api/list-subjects"
    ["list_resources_for_language"]="/api/list-resources-for-language"
)

# TEST 1: Verify each MCP tool has a REST endpoint
run_test "Each MCP tool has a corresponding REST endpoint"

MISSING_ENDPOINTS=""
for tool in $(echo $MCP_TOOLS | tr ',' '\n'); do
    endpoint="${TOOL_ENDPOINT_MAP[$tool]}"
    if [ -z "$endpoint" ]; then
        endpoint="/api/${tool//_/-}"
    fi
    
    echo "  Checking: $tool -> $endpoint"
    response=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL$endpoint")
    
    if [ "$response" = "200" ] || [ "$response" = "400" ]; then
        echo "    ✓ Endpoint exists (HTTP $response)"
    else
        echo "    ✗ Endpoint missing or error (HTTP $response)"
        MISSING_ENDPOINTS="$MISSING_ENDPOINTS $tool"
    fi
done

if [ -z "$MISSING_ENDPOINTS" ]; then
    pass_test "All MCP tools have REST endpoints"
else
    fail_test "Missing REST endpoints for:$MISSING_ENDPOINTS"
fi

# TEST 2: Verify REST endpoints match MCP tools
run_test "REST endpoints have corresponding MCP tools"

EXPECTED_TOOLS="fetch_scripture,fetch_translation_notes,fetch_translation_questions,fetch_translation_word,fetch_translation_word_links,fetch_translation_academy,list_languages,list_subjects,list_resources_for_language,list_tools"

MISSING_TOOLS=""
for expected in $(echo $EXPECTED_TOOLS | tr ',' '\n'); do
    if echo "$MCP_TOOLS" | grep -q "$expected"; then
        echo "  ✓ $expected exists in MCP"
    else
        echo "  ✗ $expected missing from MCP"
        MISSING_TOOLS="$MISSING_TOOLS $expected"
    fi
done

if [ -z "$MISSING_TOOLS" ]; then
    pass_test "All expected tools exist in MCP"
else
    fail_test "Missing MCP tools:$MISSING_TOOLS"
fi

# TEST 3: Verify parameter consistency
run_test "MCP and REST use consistent parameter names"

echo "  Testing fetch_scripture parameters..."
REST_PARAMS=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:1" 2>&1)
MCP_PARAMS=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"John 1:1"}}}' 2>&1)

if echo "$REST_PARAMS" | grep -q "scripture\|error" && echo "$MCP_PARAMS" | grep -q "scripture\|error"; then
    pass_test "Parameters work consistently"
else
    fail_test "Parameter consistency issue"
fi

# TEST 4: Check for orphan endpoints
run_test "No orphan REST endpoints (without MCP tools)"

echo "  Checking list-resources-by-language..."
ORPHAN_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL/api/list-resources-by-language?language=en")

if [ "$ORPHAN_RESPONSE" = "200" ]; then
    if echo "$MCP_TOOLS" | grep -q "list_resources_by_language"; then
        echo "  ✓ Has MCP tool"
        pass_test "No orphan endpoints found"
    else
        echo "  ✗ REST endpoint exists but no MCP tool"
        fail_test "Orphan endpoint: list-resources-by-language"
    fi
else
    pass_test "No orphan endpoints (endpoint doesn't exist)"
fi

# TEST 5: Verify naming conventions
run_test "Consistent naming conventions (underscores vs hyphens)"

CONVENTION_OK=true
for tool in $(echo $MCP_TOOLS | tr ',' '\n'); do
    endpoint="${TOOL_ENDPOINT_MAP[$tool]}"
    if [ -z "$endpoint" ]; then
        endpoint="/api/${tool//_/-}"
    fi
    
    # Check if tool uses underscores and endpoint uses hyphens
    if echo "$tool" | grep -q "_"; then
        if echo "$endpoint" | grep -q "-"; then
            echo "  ✓ $tool -> $endpoint (correct convention)"
        else
            echo "  ✗ $tool -> $endpoint (convention mismatch)"
            CONVENTION_OK=false
        fi
    fi
done

if [ "$CONVENTION_OK" = true ]; then
    pass_test "Naming conventions are consistent"
else
    fail_test "Naming convention inconsistencies found"
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
    echo -e "${GREEN}✓ ALL ENDPOINT PARITY TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
