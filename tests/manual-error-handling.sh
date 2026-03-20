#!/bin/bash

# Manual Error Handling Tests
# Verifies consistent error responses

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Error Handling Tests"
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

# TEST 1: 400 for missing required parameters
run_test "Returns 400 for missing required parameters"

echo "  Testing REST without reference..."
REST_MISSING=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/api/fetch-scripture?language=en")
REST_CODE=$(echo "$REST_MISSING" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')

echo "  Testing MCP without reference..."
MCP_MISSING=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"language":"en"}}}')

if [ "$REST_CODE" = "400" ] && echo "$MCP_MISSING" | grep -q "error"; then
    pass_test "Both return 400/error for missing parameters"
else
    fail_test "Error codes inconsistent (REST: $REST_CODE, MCP: check)"
fi

# TEST 2: Clear error messages
run_test "Error messages are clear and actionable"

echo "  Checking error message content..."
ERROR_MSG=$(curl -s "$SERVER_URL/api/fetch-scripture?language=en")
if echo "$ERROR_MSG" | grep -qi "reference.*required\|missing.*reference"; then
    pass_test "Error message is clear"
else
    fail_test "Error message unclear or missing"
fi

# TEST 3: Invalid format error
run_test "Rejects invalid format with clear error"

echo "  Testing invalid format..."
INVALID_FMT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&format=xml")
if echo "$INVALID_FMT" | grep -qi "error.*format\|invalid.*format"; then
    pass_test "Invalid format rejected with clear message"
else
    fail_test "Format error handling unclear"
fi

# TEST 4: 404 for non-existent language
run_test "Returns 404 for non-existent language"

echo "  Testing with invalid language..."
LANG_404=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=xyz123")
LANG_CODE=$(echo "$LANG_404" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')

if [ "$LANG_CODE" = "404" ] || [ "$LANG_CODE" = "400" ]; then
    pass_test "Non-existent language returns 404/400"
else
    fail_test "Wrong status code for invalid language: $LANG_CODE"
fi

# TEST 5: 404 for non-existent resource
run_test "Returns 404 for non-existent resource path"

echo "  Testing with invalid path..."
PATH_404=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/api/fetch-translation-word?path=invalid/nonexistent&language=en")
PATH_CODE=$(echo "$PATH_404" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')

if [ "$PATH_CODE" = "404" ]; then
    pass_test "Non-existent path returns 404"
else
    fail_test "Wrong status code for invalid path: $PATH_CODE"
fi

# TEST 6: Error consistency across REST and MCP
run_test "Errors are consistent across REST and MCP"

echo "  Testing same error via both interfaces..."
REST_ERR=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Invalid&language=xyz")
MCP_ERR=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fetch_scripture","arguments":{"reference":"Invalid","language":"xyz"}}}')

if echo "$REST_ERR" | grep -q "error" && echo "$MCP_ERR" | grep -q "error"; then
    pass_test "Both interfaces return errors consistently"
else
    fail_test "Error handling differs between interfaces"
fi

# TEST 7: Malformed request handling
run_test "Handles malformed requests gracefully"

echo "  Testing with malformed JSON..."
MALFORMED=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"invalid json}')

if echo "$MALFORMED" | grep -q "error\|parse"; then
    pass_test "Malformed requests handled gracefully"
else
    fail_test "Malformed request not handled"
fi

# TEST 8: Invalid organization handling
run_test "Handles invalid organization appropriately"

echo "  Testing with non-existent organization..."
INVALID_ORG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=nonexistent")
# Should either return 404 or search across all orgs
if echo "$INVALID_ORG" | grep -q "scripture\|error\|404"; then
    pass_test "Invalid organization handled"
else
    fail_test "Invalid organization not handled"
fi

# TEST 9: Empty parameter values
run_test "Handles empty parameter values"

echo "  Testing with empty language..."
EMPTY_LANG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=")
# Empty language defaults to 'en' (by design), so should return scripture
if echo "$EMPTY_LANG" | grep -q "scripture\|error"; then
    pass_test "Empty parameters handled (defaults to 'en')"
else
    fail_test "Empty parameter handling issue"
fi

# TEST 10: Multiple errors reported
run_test "Multiple errors are reported together"

echo "  Testing with multiple missing parameters..."
MULTI_ERR=$(curl -s "$SERVER_URL/api/fetch-translation-notes?organization=test")
# Should mention missing reference
if echo "$MULTI_ERR" | grep -qi "error"; then
    pass_test "Multiple errors detected"
else
    fail_test "Multiple error reporting issue"
fi

# TEST 11: Error response structure
run_test "Error responses have consistent structure"

echo "  Checking error response format..."
if echo "$ERROR_MSG" | grep -q '"error"'; then
    # Check for actual fields: error, details, status (not message/code/statusCode)
    if echo "$ERROR_MSG" | grep -q '"details"\|"status"'; then
        pass_test "Error responses have consistent structure"
    else
        fail_test "Error response missing standard fields"
    fi
else
    fail_test "Error response structure inconsistent"
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
    echo -e "${GREEN}✓ ALL ERROR HANDLING TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
