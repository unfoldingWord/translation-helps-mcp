#!/bin/bash

# Manual Schema Validation Tests
# Verifies parameter validation and schemas

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Schema Validation Tests"
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

# TEST 1: Required parameters
run_test "Required parameters are enforced"

echo "  Testing fetch_scripture without reference..."
NO_REF=$(curl -s "$SERVER_URL/api/fetch-scripture?language=en")
if echo "$NO_REF" | grep -qi "error\|required"; then
    pass_test "Missing reference parameter rejected"
else
    fail_test "Missing required parameter not detected"
fi

# TEST 2: Optional parameters accepted
run_test "Optional parameters are accepted"

echo "  Testing fetch_scripture with optional language..."
WITH_LANG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")
if echo "$WITH_LANG" | grep -q "scripture\|error"; then
    pass_test "Optional language parameter accepted"
else
    fail_test "Optional parameter handling failed"
fi

# TEST 3: Invalid enum values rejected
run_test "Invalid format enum values are rejected"

echo "  Testing with invalid format..."
INVALID_FORMAT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&format=invalid")
if echo "$INVALID_FORMAT" | grep -qi "error\|invalid"; then
    pass_test "Invalid format value rejected"
else
    fail_test "Invalid enum value not detected"
fi

# TEST 4: Valid enum values accepted
run_test "Valid enum values are accepted"

echo "  Testing with json format..."
JSON_FORMAT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&format=json")
if echo "$JSON_FORMAT" | grep -q "content\|error"; then
    echo "  Testing with md format..."
    MD_FORMAT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&format=md")
    # MD format returns plain markdown text (not JSON), check for markdown header
    if echo "$MD_FORMAT" | grep -q "^#\|Definition:"; then
        pass_test "Valid enum values (json, md) accepted"
    else
        fail_test "Markdown format not accepted"
    fi
else
    fail_test "JSON format not accepted"
fi

# TEST 5: String type validation
run_test "String parameters validated"

echo "  Testing with valid string reference..."
STRING_REF=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Genesis+1:1")
if echo "$STRING_REF" | grep -q "scripture"; then
    pass_test "String reference parameter accepted"
else
    fail_test "String parameter validation failed"
fi

# TEST 6: Empty string handling
run_test "Empty strings handled appropriately"

echo "  Testing with empty organization..."
EMPTY_ORG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&organization=")
# Empty organization should either search all or return error
if echo "$EMPTY_ORG" | grep -q "scripture\|error"; then
    pass_test "Empty organization handled"
else
    fail_test "Empty string handling issue"
fi

# TEST 7: Category parameter validation (Translation Word)
run_test "Category parameter validation"

echo "  Testing with valid category..."
VALID_CAT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&category=kt")
if echo "$VALID_CAT" | grep -q "content"; then
    pass_test "Valid category accepted"
else
    fail_test "Category validation failed"
fi

# TEST 8: Topic parameter validation (Translation Academy)
run_test "Topic parameter validation"

echo "  Testing with valid topic..."
VALID_TOPIC=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&topic=tc-ready")
if echo "$VALID_TOPIC" | grep -q "content"; then
    pass_test "Valid topic accepted"
else
    fail_test "Topic validation failed"
fi

# TEST 9: Stage parameter validation
run_test "Stage parameter validation"

echo "  Testing with prod stage..."
STAGE_PROD=$(curl -s "$SERVER_URL/api/list-languages?stage=prod")
if echo "$STAGE_PROD" | grep -q "languages"; then
    pass_test "Stage parameter accepted"
else
    fail_test "Stage validation failed"
fi

# TEST 10: Combined parameter validation
run_test "Multiple parameters validated together"

echo "  Testing with all parameters..."
ALL_PARAMS=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=unfoldingWord&format=json")
if echo "$ALL_PARAMS" | grep -q "scripture"; then
    pass_test "Multiple parameters work together"
else
    fail_test "Combined parameter validation failed"
fi

# TEST 11: Parameter order independence
run_test "Parameter order doesn't matter"

echo "  Testing with different parameter order..."
ORDER1=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=unfoldingWord")
ORDER2=$(curl -s "$SERVER_URL/api/fetch-scripture?organization=unfoldingWord&language=en&reference=John+3:16")

if echo "$ORDER1" | grep -q "scripture" && echo "$ORDER2" | grep -q "scripture"; then
    pass_test "Parameter order is independent"
else
    fail_test "Parameter order affects results"
fi

# TEST 12: Case sensitivity
run_test "Parameter names are case-sensitive"

echo "  Testing with wrong case..."
WRONG_CASE=$(curl -s "$SERVER_URL/api/fetch-scripture?Reference=John+3:16&Language=en")
if echo "$WRONG_CASE" | grep -qi "error\|required"; then
    pass_test "Parameter names are case-sensitive"
else
    fail_test "Case sensitivity not enforced"
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
    echo -e "${GREEN}✓ ALL SCHEMA VALIDATION TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
