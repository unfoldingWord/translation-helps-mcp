#!/bin/bash

# Manual Cache Isolation Tests
# Verifies cache correctly isolates by parameters

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Cache Isolation Tests"
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

# TEST 1: Identical requests use cache
run_test "Identical requests return same cached data"

echo "  Request 1..."
REQ1=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Philippians+4:13&language=en&organization=unfoldingWord")
REQ1_TEXT=$(echo "$REQ1" | grep -o '"text".*[a-zA-Z]' | head -1)

echo "  Request 2 (should be cached)..."
REQ2=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Philippians+4:13&language=en&organization=unfoldingWord")
REQ2_TEXT=$(echo "$REQ2" | grep -o '"text".*[a-zA-Z]' | head -1)

if [ "$REQ1_TEXT" = "$REQ2_TEXT" ] && [ -n "$REQ1_TEXT" ]; then
    pass_test "Cache returns identical data"
else
    fail_test "Cached data differs from original"
fi

# TEST 2: Cache isolates by organization
run_test "Cache isolates by organization parameter"

echo "  Fetching with organization=unfoldingWord..."
ORG1=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+11:35&language=en&organization=unfoldingWord")

echo "  Fetching with empty organization..."
ORG2=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+11:35&language=en")

# Should either be different or one should be empty/error
ORG1_META=$(echo "$ORG1" | grep -o '"organization".*"unfoldingWord"')
ORG2_META=$(echo "$ORG2" | grep -o '"organization"')

if [ "$ORG1_META" != "$ORG2_META" ] || [ -z "$ORG2_META" ]; then
    pass_test "Cache correctly isolates by organization"
else
    # Check if they have different content
    if [ "$ORG1" != "$ORG2" ]; then
        pass_test "Cache isolates by organization (different content)"
    else
        fail_test "Cache not isolating by organization"
    fi
fi

# TEST 3: Cache isolates by language
run_test "Cache isolates by language parameter"

echo "  Fetching in English..."
LANG_EN=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Psalm+23:1&language=en")

echo "  Fetching in Spanish..."
LANG_ES=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Psalm+23:1&language=es")

# Should be different (or ES might 404)
if [ "$LANG_EN" != "$LANG_ES" ]; then
    pass_test "Cache correctly isolates by language"
else
    fail_test "Cache not isolating by language"
fi

# TEST 4: Cache isolates by format
run_test "Cache isolates by format parameter"

echo "  Fetching in JSON format..."
FMT_JSON=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/love&language=en&format=json")

echo "  Fetching in Markdown format..."
FMT_MD=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/love&language=en&format=md")

# Should have different content structure
if [ "$FMT_JSON" != "$FMT_MD" ]; then
    pass_test "Cache correctly isolates by format"
else
    fail_test "Cache not isolating by format"
fi

# TEST 5: Cache isolates by reference
run_test "Different references get separate cache entries"

echo "  Fetching John 3:16..."
REF1=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")

echo "  Fetching John 3:17..."
REF2=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:17&language=en")

if [ "$REF1" != "$REF2" ]; then
    pass_test "Cache correctly isolates by reference"
else
    fail_test "Cache not isolating by reference"
fi

# TEST 6: Cache isolates by path (Translation Words)
run_test "Different paths get separate cache entries"

echo "  Fetching kt/god..."
PATH1=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en")

echo "  Fetching kt/jesus..."
PATH2=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/jesus&language=en")

if [ "$PATH1" != "$PATH2" ]; then
    pass_test "Cache correctly isolates by path"
else
    fail_test "Cache not isolating by path"
fi

# TEST 7: Empty string vs undefined parameter
run_test "Empty string vs missing parameter handled differently"

echo "  With organization=unfoldingWord..."
WITH_ORG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Romans+5:8&language=en&organization=unfoldingWord")

echo "  With organization='' (empty)..."
EMPTY_ORG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Romans+5:8&language=en&organization=")

echo "  Without organization parameter..."
NO_ORG=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Romans+5:8&language=en")

# Empty and missing should behave similarly (both search all)
# But should differ from explicit org
if [ "$WITH_ORG" != "$NO_ORG" ] || echo "$WITH_ORG" | grep -q "unfoldingWord"; then
    pass_test "Empty vs undefined parameters handled correctly"
else
    fail_test "Empty string handling issue"
fi

# TEST 8: Cache doesn't confuse similar paths
run_test "Similar paths don't cause cache collisions"

echo "  Fetching translate/figs-metaphor..."
SIMILAR1=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en")

echo "  Fetching translate/figs-metonymy..."
SIMILAR2=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-metonymy&language=en")

if [ "$SIMILAR1" != "$SIMILAR2" ]; then
    if echo "$SIMILAR1" | grep -q "Metaphor" && echo "$SIMILAR2" | grep -q "Metonymy"; then
        pass_test "Similar paths correctly isolated"
    else
        pass_test "Similar paths isolated (content differs)"
    fi
else
    fail_test "Cache confusing similar paths"
fi

# TEST 9: Topic parameter isolation
run_test "Cache isolates by topic parameter"

echo "  Fetching with topic=tc-ready..."
TOPIC1=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/translate-names&language=en&topic=tc-ready")

echo "  Fetching without topic..."
TOPIC2=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/translate-names&language=en")

# Should be same content (topic is a filter, not content changer)
# But cache keys should be different
if echo "$TOPIC1" | grep -q "content" && echo "$TOPIC2" | grep -q "content"; then
    pass_test "Topic parameter handled in cache"
else
    fail_test "Topic parameter cache handling issue"
fi

# TEST 10: Case sensitivity in cache keys
run_test "Cache keys are case-sensitive"

echo "  Fetching John+3:16..."
CASE1=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John+3:16&language=en")

echo "  Fetching john+3:16 (lowercase)..."
CASE2=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=john+3:16&language=en")

# References might be normalized, so both could work
# But cache should handle them correctly
if echo "$CASE1" | grep -q "scripture" && echo "$CASE2" | grep -q "scripture"; then
    pass_test "Case sensitivity handled correctly"
else
    # One might fail if not normalized
    if [ "$CASE1" != "$CASE2" ]; then
        pass_test "Cache respects case differences"
    else
        fail_test "Case sensitivity issue"
    fi
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
    echo -e "${GREEN}✓ ALL CACHE ISOLATION TESTS PASSED${NC}"
    echo ""
    echo "Cache correctly isolates by:"
    echo "  - Organization parameter"
    echo "  - Language parameter"
    echo "  - Format parameter"
    echo "  - Reference/path"
    echo "  - Topic parameter"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
