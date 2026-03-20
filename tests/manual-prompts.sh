#!/bin/bash

# Manual Prompts Tests
# Verifies all MCP prompts execute correctly

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Prompts Execution Tests"
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

# TEST 1: translation-helps-report prompt
run_test "translation-helps-report prompt executes"

echo "  Executing prompt..."
REPORT_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"translation-helps-report",
            "arguments":{"reference":"John 3:16","language":"en"}
        }
    }')

if echo "$REPORT_RESPONSE" | grep -q "content\|messages"; then
    if echo "$REPORT_RESPONSE" | grep -q "error"; then
        fail_test "Prompt returned error"
    else
        pass_test "translation-helps-report executes successfully"
    fi
else
    fail_test "Prompt response malformed"
fi

# TEST 2: translation-helps-for-passage prompt
run_test "translation-helps-for-passage prompt executes"

echo "  Executing prompt..."
PASSAGE_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"translation-helps-for-passage",
            "arguments":{"reference":"Matthew 1:1","language":"en"}
        }
    }')

if echo "$PASSAGE_RESPONSE" | grep -q "content\|messages"; then
    pass_test "translation-helps-for-passage executes successfully"
else
    fail_test "Prompt response malformed"
fi

# TEST 3: get-translation-words-for-passage prompt
run_test "get-translation-words-for-passage prompt executes"

echo "  Executing prompt..."
WORDS_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"get-translation-words-for-passage",
            "arguments":{"reference":"Genesis 1:1","language":"en"}
        }
    }')

if echo "$WORDS_RESPONSE" | grep -q "content\|messages"; then
    pass_test "get-translation-words-for-passage executes successfully"
else
    fail_test "Prompt response malformed"
fi

# TEST 4: get-translation-academy-for-passage prompt
run_test "get-translation-academy-for-passage prompt executes"

echo "  Executing prompt..."
ACADEMY_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"get-translation-academy-for-passage",
            "arguments":{"reference":"John 1:1","language":"en"}
        }
    }')

if echo "$ACADEMY_RESPONSE" | grep -q "content\|messages"; then
    pass_test "get-translation-academy-for-passage executes successfully"
else
    fail_test "Prompt response malformed"
fi

# TEST 5: discover-resources-for-language prompt
run_test "discover-resources-for-language prompt executes"

echo "  Executing prompt..."
DISCOVER_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"discover-resources-for-language",
            "arguments":{"language":"en"}
        }
    }')

if echo "$DISCOVER_RESPONSE" | grep -q "content\|messages"; then
    pass_test "discover-resources-for-language executes successfully"
else
    fail_test "Prompt response malformed"
fi

# TEST 6: discover-languages-for-subject prompt
run_test "discover-languages-for-subject prompt executes"

echo "  Executing prompt..."
LANGS_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"discover-languages-for-subject",
            "arguments":{"subject":"Bible"}
        }
    }')

if echo "$LANGS_RESPONSE" | grep -q "content\|messages"; then
    pass_test "discover-languages-for-subject executes successfully"
else
    fail_test "Prompt response malformed"
fi

# TEST 7: Prompts handle missing arguments gracefully
run_test "Prompts execute even with missing optional arguments"

echo "  Testing prompt without required argument..."
NO_ARG_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"translation-helps-report",
            "arguments":{}
        }
    }')

# Prompts are templates - they can execute with missing args (will have empty values)
# This is by design - prompts fill in what they have and leave blanks for missing args
if echo "$NO_ARG_RESPONSE" | grep -q "content\|messages"; then
    pass_test "Prompts execute gracefully (templates can have missing args)"
else
    fail_test "Prompt execution failed completely"
fi

# TEST 8: Prompt response format
run_test "Prompt responses have correct format"

echo "  Checking response structure..."
# Should have either 'content' array or 'messages' array
HAS_CONTENT=$(echo "$REPORT_RESPONSE" | grep -o '"content"' | wc -l)
HAS_MESSAGES=$(echo "$REPORT_RESPONSE" | grep -o '"messages"' | wc -l)

if [ "$HAS_CONTENT" -gt 0 ] || [ "$HAS_MESSAGES" -gt 0 ]; then
    pass_test "Prompt responses have correct format"
else
    fail_test "Prompt responses missing content/messages array"
fi

# TEST 9: Prompt content is not empty
run_test "Prompt responses contain actual content"

echo "  Checking for content length..."
# Extract and check if there's actual text content
if echo "$REPORT_RESPONSE" | grep -q '"text".*[a-zA-Z]'; then
    pass_test "Prompt responses contain text content"
else
    fail_test "Prompt responses are empty"
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
    echo -e "${GREEN}✓ ALL PROMPT TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
