#!/bin/bash

# Manual DCS Source Verification Script
# Compares our API responses with actual DCS catalog data

set -e

SERVER_URL="http://localhost:8174"
DCS_BASE="https://git.door43.org"

echo "==============================================="
echo "DCS Source of Truth Verification Tests"
echo "==============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Helper function to test
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
echo "Checking server health..."
if ! curl -s "$SERVER_URL/api/health" > /dev/null; then
    echo -e "${RED}ERROR: Server not running at $SERVER_URL${NC}"
    echo "Start with: npm run dev"
    exit 1
fi
echo -e "${GREEN}Server is healthy${NC}"
echo ""

# ============================================
# TEST 1: Language List Validation
# ============================================
run_test "Language list matches DCS catalog"

echo "  Fetching languages from DCS..."
DCS_LANGS=$(curl -s "$DCS_BASE/catalog/list/languages?stage=prod" | python -c "
import sys, json
data = json.load(sys.stdin)
langs = [item['lc'] for item in data.get('data', []) if 'lc' in item]
print(json.dumps(langs[:10]))  # First 10 for comparison
")

echo "  Fetching languages from our API..."
OUR_LANGS=$(curl -s "$SERVER_URL/api/list-languages" | python -c "
import sys, json
data = json.load(sys.stdin)
langs = [item['code'] for item in data.get('languages', [])[:10]]
print(json.dumps(langs))
")

echo "  DCS languages (first 10): $DCS_LANGS"
echo "  Our languages (first 10): $OUR_LANGS"

if [ "$DCS_LANGS" = "$OUR_LANGS" ]; then
    pass_test "Language lists match DCS"
else
    fail_test "Language lists differ from DCS"
fi

# ============================================
# TEST 2: Scripture Existence Verification
# ============================================
run_test "Scripture existence matches DCS"

echo "  Checking DCS for English scripture (unfoldingWord)..."
DCS_EN_EXISTS=$(curl -s "$DCS_BASE/api/v1/catalog/search?lang=en&owner=unfoldingWord&subject=Bible&stage=prod" | python -c "
import sys, json
data = json.load(sys.stdin)
exists = len(data.get('data', [])) > 0
print('true' if exists else 'false')
")

echo "  Checking our API for English scripture..."
OUR_RESPONSE=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=en&organization=unfoldingWord")
OUR_STATUS=$(echo "$OUR_RESPONSE" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'verses' in data and len(data['verses']) > 0:
        print('200')
    else:
        print('404')
except:
    print('error')
")

echo "  DCS has English scripture: $DCS_EN_EXISTS"
echo "  Our API status: $OUR_STATUS"

if [ "$DCS_EN_EXISTS" = "true" ] && [ "$OUR_STATUS" = "200" ]; then
    pass_test "Scripture existence matches DCS (both have it)"
elif [ "$DCS_EN_EXISTS" = "false" ] && [ "$OUR_STATUS" = "404" ]; then
    pass_test "Scripture existence matches DCS (both don't have it)"
else
    fail_test "Scripture existence mismatch with DCS"
fi

# ============================================
# TEST 3: Invalid Resource Verification  
# ============================================
run_test "Invalid language returns 404 (DCS has no data)"

echo "  Checking DCS for invalid language 'xyz123'..."
DCS_INVALID=$(curl -s "$DCS_BASE/api/v1/catalog/search?lang=xyz123&owner=unfoldingWord&subject=Bible&stage=prod" | python -c "
import sys, json
data = json.load(sys.stdin)
exists = len(data.get('data', [])) > 0
print('true' if exists else 'false')
")

echo "  Checking our API for invalid language..."
OUR_INVALID=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=xyz123&organization=unfoldingWord" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'error' in data or ('verses' in data and len(data['verses']) == 0):
        print('404')
    else:
        print('200')
except:
    print('404')
")

echo "  DCS has xyz123: $DCS_INVALID"
echo "  Our API response: $OUR_INVALID"

if [ "$DCS_INVALID" = "false" ] && [ "$OUR_INVALID" = "404" ]; then
    pass_test "Correctly returns 404 for invalid language (matches DCS)"
else
    fail_test "Should return 404 for invalid language"
fi

# ============================================
# TEST 4: Metadata Accuracy
# ============================================
run_test "Metadata matches DCS (language and organization)"

echo "  Fetching scripture with metadata from our API..."
METADATA=$(curl -s "$SERVER_URL/api/fetch-scripture?reference=Genesis%201:1&language=en&organization=unfoldingWord" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    meta = data.get('metadata', {})
    print(json.dumps({
        'language': meta.get('language', 'missing'),
        'organization': meta.get('organization', 'missing')
    }))
except Exception as e:
    print(json.dumps({'error': str(e)}))
")

echo "  Our API metadata: $METADATA"

# Check if metadata has expected values
HAS_LANGUAGE=$(echo "$METADATA" | python -c "
import sys, json
data = json.load(sys.stdin)
print('true' if data.get('language') == 'en' else 'false')
")

HAS_ORG=$(echo "$METADATA" | python -c "
import sys, json
data = json.load(sys.stdin)
print('true' if data.get('organization') == 'unfoldingWord' else 'false')
")

echo "  Has correct language (en): $HAS_LANGUAGE"
echo "  Has correct organization (unfoldingWord): $HAS_ORG"

if [ "$HAS_LANGUAGE" = "true" ] && [ "$HAS_ORG" = "true" ]; then
    pass_test "Metadata contains correct language and organization"
else
    fail_test "Metadata missing or incorrect"
fi

# ============================================
# TEST 5: Translation Academy Validation
# ============================================
run_test "Translation Academy exists in both DCS and our API"

echo "  Checking DCS for English Translation Academy..."
DCS_TA=$(curl -s "$DCS_BASE/api/v1/catalog/search?lang=en&owner=unfoldingWord&subject=Translation%20Academy&stage=prod" | python -c "
import sys, json
data = json.load(sys.stdin)
exists = len(data.get('data', [])) > 0
print('true' if exists else 'false')
")

echo "  Fetching TA article from our API..."
OUR_TA=$(curl -s "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&organization=unfoldingWord" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'content' in data and len(data.get('content', '')) > 0:
        print('200')
    else:
        print('404')
except:
    print('error')
")

echo "  DCS has English TA: $DCS_TA"
echo "  Our API status: $OUR_TA"

if [ "$DCS_TA" = "true" ] && [ "$OUR_TA" = "200" ]; then
    pass_test "Translation Academy matches DCS (both have it)"
else
    fail_test "Translation Academy mismatch with DCS"
fi

# ============================================
# TEST 6: Translation Word Validation
# ============================================
run_test "Translation Words exist in both DCS and our API"

echo "  Checking DCS for English Translation Words..."
DCS_TW=$(curl -s "$DCS_BASE/api/v1/catalog/search?lang=en&owner=unfoldingWord&subject=Translation%20Words&stage=prod" | python -c "
import sys, json
data = json.load(sys.stdin)
exists = len(data.get('data', [])) > 0
print('true' if exists else 'false')
")

echo "  Fetching TW article from our API..."
OUR_TW=$(curl -s "$SERVER_URL/api/fetch-translation-word?path=kt/god&language=en&organization=unfoldingWord" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'content' in data and len(data.get('content', '')) > 0:
        print('200')
    else:
        print('404')
except:
    print('error')
")

echo "  DCS has English TW: $DCS_TW"
echo "  Our API status: $OUR_TW"

if [ "$DCS_TW" = "true" ] && [ "$OUR_TW" = "200" ]; then
    pass_test "Translation Words match DCS (both have it)"
else
    fail_test "Translation Words mismatch with DCS"
fi

# ============================================
# SUMMARY
# ============================================
echo "==============================================="
echo "TEST SUMMARY"
echo "==============================================="
echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}ALL TESTS PASSED!${NC}"
    echo ""
    echo "Our API responses match DCS source of truth:"
    echo "  - Language lists are synchronized"
    echo "  - Resource existence matches DCS"
    echo "  - Invalid resources properly rejected"
    echo "  - Metadata is accurate"
    echo "  - Translation resources validated"
    exit 0
else
    echo -e "${RED}SOME TESTS FAILED${NC}"
    echo ""
    echo "Issues found:"
    echo "  - $FAILED_TESTS test(s) did not match DCS catalog"
    echo "  - Check logs above for details"
    exit 1
fi
