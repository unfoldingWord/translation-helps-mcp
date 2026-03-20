#!/bin/bash

# Complete API Validation Test
# Validates all endpoints after Phase 1 & Phase 2 metadata standardization

API_BASE="http://localhost:8178/api"

echo "==========================================="
echo "COMPLETE API VALIDATION TEST"
echo "Phase 1 + Phase 2 Metadata Standardization"
echo "==========================================="
echo ""

# Helper function to test an endpoint
test_endpoint() {
    local name=$1
    local url=$2
    local resource_type=$3
    
    echo "Testing: $name"
    echo "URL: $url"
    echo "-------------------------------------------"
    
    RESPONSE=$(curl -s "$url")
    
    # Check HTTP success
    if [ -z "$RESPONSE" ]; then
        echo "❌ FAIL: Empty response"
        return 1
    fi
    
    # Check metadata structure
    echo "$RESPONSE" | grep -qi '"metadata"' && echo "✅ Metadata object present" || echo "❌ Metadata missing"
    echo "$RESPONSE" | grep -qi "\"resourceType\".*:.*\"$resource_type\"" && echo "✅ ResourceType: $resource_type" || echo "❌ ResourceType mismatch"
    echo "$RESPONSE" | grep -qi '"subject"' && echo "✅ Subject present" || echo "❌ Subject missing"
    echo "$RESPONSE" | grep -qi '"language"' && echo "✅ Language present" || echo "❌ Language missing"
    echo "$RESPONSE" | grep -qi '"organization"' && echo "✅ Organization present" || echo "❌ Organization missing"
    echo "$RESPONSE" | grep -qi '"license"' && echo "✅ License present" || echo "❌ License missing"
    
    # Show actual metadata
    echo ""
    echo "Metadata structure:"
    echo "$RESPONSE" | python -m json.tool 2>/dev/null | grep -A 10 '"metadata":' | head -12
    echo ""
}

# Test all 6 endpoints
echo "1. TRANSLATION WORD (TW)"
test_endpoint "Translation Word" "$API_BASE/fetch-translation-word?path=bible/kt/love" "tw"
echo ""

echo "2. TRANSLATION ACADEMY (TA)"
test_endpoint "Translation Academy" "$API_BASE/fetch-translation-academy?path=translate/figs-metaphor" "ta"
echo ""

echo "3. TRANSLATION NOTES (TN)"
test_endpoint "Translation Notes" "$API_BASE/fetch-translation-notes?reference=gen+1:1" "tn"
echo ""

echo "4. TRANSLATION QUESTIONS (TQ)"
test_endpoint "Translation Questions" "$API_BASE/fetch-translation-questions?reference=gen+1:1" "tq"
echo ""

echo "5. TRANSLATION WORD LINKS (TWL)"
test_endpoint "Translation Word Links" "$API_BASE/fetch-translation-word-links?reference=gen+1:1" "twl"
echo ""

echo "6. SCRIPTURE"
test_endpoint "Scripture" "$API_BASE/fetch-scripture?reference=gen+1:1" "scripture"
echo ""

echo "==========================================="
echo "EXTERNAL REFERENCE VALIDATION"
echo "==========================================="
echo ""

# Test TN → TA flow
echo "Test 1: TN → TA External Reference Flow"
echo "----------------------------------------"
TN_RESP=$(curl -s "$API_BASE/fetch-translation-notes?reference=gen+1:1")
TA_PATH=$(echo "$TN_RESP" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for item in data.get('items', []):
        ref = item.get('externalReference', {})
        if ref.get('target') == 'ta':
            print(ref['path'])
            break
except: pass
")

if [ -n "$TA_PATH" ]; then
    echo "✅ Extracted TA path: $TA_PATH"
    TA_RESP=$(curl -s "$API_BASE/fetch-translation-academy?path=$TA_PATH")
    echo "$TA_RESP" | grep -qi '"title"' && echo "✅ TA article fetched successfully" || echo "❌ TA fetch failed"
else
    echo "❌ No TA reference found"
fi
echo ""

# Test TWL → TW flow
echo "Test 2: TWL → TW External Reference Flow"
echo "-----------------------------------------"
TWL_RESP=$(curl -s "$API_BASE/fetch-translation-word-links?reference=gen+1:1")
TW_PATH=$(echo "$TWL_RESP" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for item in data.get('items', []):
        ref = item.get('externalReference', {})
        if ref.get('target') == 'tw':
            print(ref['path'])
            break
except: pass
")

if [ -n "$TW_PATH" ]; then
    echo "✅ Extracted TW path: $TW_PATH"
    TW_RESP=$(curl -s "$API_BASE/fetch-translation-word?path=$TW_PATH")
    echo "$TW_RESP" | grep -qi '"title"' && echo "✅ TW article fetched successfully" || echo "❌ TW fetch failed"
else
    echo "❌ No TW reference found"
fi
echo ""

echo "==========================================="
echo "VALIDATION COMPLETE"
echo "==========================================="
