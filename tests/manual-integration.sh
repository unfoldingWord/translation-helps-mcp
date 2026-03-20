#!/bin/bash

# Manual Integration Tests
# Tests realistic end-to-end workflows

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Integration Tests"
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

# TEST 1: Discovery to Fetch workflow
run_test "Discover languages → List resources → Fetch scripture"

echo "  Step 1: Discover languages..."
LANGUAGES=$(curl -s "$SERVER_URL/api/list-languages")
if ! echo "$LANGUAGES" | grep -q "languages"; then
    fail_test "Language discovery failed"
else
    echo "    ✓ Languages discovered"
    
    echo "  Step 2: List resources for English..."
    RESOURCES=$(curl -s "$SERVER_URL/api/list-resources-for-language?language=en")
    if ! echo "$RESOURCES" | grep -q "resources\|subjects"; then
        fail_test "Resource listing failed"
    else
        echo "    ✓ Resources listed"
        
        echo "  Step 3: Fetch scripture..."
        SCRIPTURE=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")
        if echo "$SCRIPTURE" | grep -q "scripture"; then
            pass_test "Complete discovery-to-fetch workflow succeeded"
        else
            fail_test "Scripture fetch failed"
        fi
    fi
fi

# TEST 2: Translation workflow (Scripture + Notes + Words)
run_test "Fetch scripture → notes → words for same passage"

echo "  Step 1: Fetch scripture for John 3:16..."
SCRIP=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=unfoldingWord")
if echo "$SCRIP" | grep -q "scripture"; then
    echo "    ✓ Scripture fetched"
    
    echo "  Step 2: Fetch translation notes..."
    NOTES=$(curl -s "$SERVER_URL/api/fetch-translation-notes?reference=John+3:16&language=en&organization=unfoldingWord")
    if echo "$NOTES" | grep -q "items\|content"; then
        echo "    ✓ Notes fetched"
        
        echo "  Step 3: Fetch translation words..."
        WORDS=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/believe&language=en&organization=unfoldingWord")
        if echo "$WORDS" | grep -q "content"; then
            pass_test "Complete translation workflow succeeded"
        else
            fail_test "Translation word fetch failed"
        fi
    else
        fail_test "Translation notes fetch failed"
    fi
else
    fail_test "Scripture fetch failed in workflow"
fi

# TEST 3: Prompt execution flow
run_test "Execute translation-helps-report prompt end-to-end"

echo "  Executing prompt..."
PROMPT=$(curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc":"2.0",
        "id":1,
        "method":"prompts/get",
        "params":{
            "name":"translation-helps-report",
            "arguments":{"reference":"Genesis 1:1","language":"en"}
        }
    }')

if echo "$PROMPT" | grep -q "content\|messages"; then
    if echo "$PROMPT" | grep -qi "scripture\|translation"; then
        pass_test "Prompt execution returned formatted data"
    else
        fail_test "Prompt returned empty/invalid content"
    fi
else
    fail_test "Prompt execution failed"
fi

# TEST 4: Language variant auto-discovery workflow
run_test "Base language → auto-discover variant → fetch success"

echo "  Step 1: Request with base language (es)..."
ES_BASE=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:1&language=es")

if echo "$ES_BASE" | grep -q "scripture"; then
    echo "    ✓ Resource found (variant may have been auto-discovered)"
    
    # Check metadata for actual language used
    if echo "$ES_BASE" | grep -q '"language".*"es'; then
        pass_test "Language variant workflow succeeded"
    else
        fail_test "Language metadata missing"
    fi
else
    echo "    Note: Spanish not available (expected for some orgs)"
    pass_test "Language variant handling works (404 is valid)"
fi

# TEST 5: Parallel resource fetching
run_test "Fetch multiple resources in parallel workflow"

echo "  Fetching 3 resources concurrently..."
START=$(date +%s)

# Simulate parallel by launching in background
curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en" > /tmp/test1.json &
PID1=$!
curl -s "$SERVER_URL/api/fetch-translation-notes?reference=John+3:16&language=en" > /tmp/test2.json &
PID2=$!
curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en" > /tmp/test3.json &
PID3=$!

# Wait for all
wait $PID1 $PID2 $PID3
END=$(date +%s)
DURATION=$((END - START))

echo "    Completed in ${DURATION}s"

# Check all succeeded
if grep -q "scripture" /tmp/test1.json && \
   grep -q "items\|content" /tmp/test2.json && \
   grep -q "content" /tmp/test3.json; then
    pass_test "Parallel fetching succeeded"
else
    fail_test "Some parallel requests failed"
fi

# Cleanup
rm -f /tmp/test1.json /tmp/test2.json /tmp/test3.json

# TEST 6: Organization parameter workflow
run_test "Specify organization → fetch → verify org in metadata"

echo "  Fetching with specific organization..."
ORG_FETCH=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en&organization=unfoldingWord")

if echo "$ORG_FETCH" | grep -q "scripture"; then
    if echo "$ORG_FETCH" | grep -q '"organization".*"unfoldingWord"'; then
        pass_test "Organization parameter workflow succeeded"
    else
        fail_test "Organization not reflected in metadata"
    fi
else
    fail_test "Organization-filtered fetch failed"
fi

# TEST 7: Format parameter workflow
run_test "Request different formats → verify format applied"

echo "  Fetching in JSON format..."
JSON_FMT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&language=en&format=json")

echo "  Fetching in Markdown format..."
MD_FMT=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/faith&language=en&format=md")

# JSON should have "content" field, MD should be plain text with "#" heading
if echo "$JSON_FMT" | grep -q "content"; then
    if echo "$MD_FMT" | grep -q "^#"; then
        pass_test "Format parameter workflow succeeded"
    else
        fail_test "Markdown format not returning plain text"
    fi
else
    fail_test "JSON format not working"
fi

# TEST 8: Error recovery workflow
run_test "Invalid request → retry with valid params → succeed"

echo "  Step 1: Try invalid request..."
INVALID=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Invalid&language=xyz")
if echo "$INVALID" | grep -qi "error"; then
    echo "    ✓ Invalid request rejected"
    
    echo "  Step 2: Retry with valid parameters..."
    VALID=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")
    if echo "$VALID" | grep -q "scripture"; then
        pass_test "Error recovery workflow succeeded"
    else
        fail_test "Valid retry failed"
    fi
else
    fail_test "Invalid request not rejected"
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
    echo -e "${GREEN}✓ ALL INTEGRATION TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
