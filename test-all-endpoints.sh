#!/bin/bash

# Test All REST Endpoints - Optimized Version
# Tests all 9 translation-helps API endpoints with appropriate timeouts

BASE_URL="${TEST_BASE_URL:-http://localhost:8174}"
PASSED=0
FAILED=0

echo "=========================================="
echo "Testing All REST API Endpoints"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

test_endpoint() {
    local name="$1"
    local url="$2"
    local check_pattern="$3"
    local timeout="${4:-30}"
    
    echo -e "${BLUE}Testing: $name${NC}"
    
    response=$(curl -s -m "$timeout" "$url" 2>&1)
    
    if echo "$response" | grep -q "$check_pattern"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "Expected pattern: $check_pattern"
        echo "Response: ${response:0:200}..."
        ((FAILED++))
    fi
    echo ""
}

# Discovery endpoints (faster)
test_endpoint "list_languages" \
    "$BASE_URL/api/list-languages?stage=prod" \
    '"languages":' 30

test_endpoint "list_subjects" \
    "$BASE_URL/api/list-subjects?language=en&stage=prod" \
    '"subjects":' 30

test_endpoint "list_resources_for_language" \
    "$BASE_URL/api/list-resources-for-language?language=en&stage=prod" \
    '"subjects":' 30

# Fetch endpoints (potentially slower due to ZIP downloads)
test_endpoint "fetch_scripture" \
    "$BASE_URL/api/fetch-scripture?reference=JHN%203:16&language=en" \
    '"text":' 60

test_endpoint "fetch_translation_notes" \
    "$BASE_URL/api/fetch-translation-notes?reference=JHN%203:16&language=en" \
    '"verseNotes":' 60

test_endpoint "fetch_translation_questions" \
    "$BASE_URL/api/fetch-translation-questions?reference=JHN%201:1&language=en" \
    '"items":' 60

test_endpoint "fetch_translation_word_links" \
    "$BASE_URL/api/fetch-translation-word-links?reference=JHN%203:16&language=en" \
    '"items":' 60

test_endpoint "fetch_translation_word" \
    "$BASE_URL/api/fetch-translation-word?path=bible/kt/grace&language=en" \
    '"content":' 60

test_endpoint "fetch_translation_academy" \
    "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en" \
    '"content":' 60

# Summary
echo "=========================================="
echo "REST API Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED / 9${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $FAILED / 9${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
fi
