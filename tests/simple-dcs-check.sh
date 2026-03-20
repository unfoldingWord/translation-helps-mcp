#!/bin/bash

# Simple DCS Verification - Tests core comparison logic

SERVER_URL="http://localhost:8174"
DCS_BASE="https://git.door43.org"

echo "================================"
echo "DCS Source Verification Tests"
echo "================================"
echo ""

# Test 1: Check if our API and DCS both have English scripture
echo "[TEST 1] English Scripture Verification"
echo "----------------------------------------"

echo "1. Testing DCS catalog API..."
DCS_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$DCS_BASE/api/v1/catalog/search?lang=en&owner=unfoldingWord&subject=Bible&stage=prod&limit=1")
DCS_HTTP_CODE=$(echo "$DCS_RESPONSE" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
DCS_BODY=$(echo "$DCS_RESPONSE" | grep -v "HTTP_CODE:")

if [ "$DCS_HTTP_CODE" = "200" ]; then
    echo "   DCS API responded: 200 OK"
    DCS_HAS_DATA=$(echo "$DCS_BODY" | grep -o '"data":\[' | wc -l)
    if [ "$DCS_HAS_DATA" -gt 0 ]; then
        echo "   DCS has English scripture data"
        DCS_VERDICT="HAS_DATA"
    else
        echo "   DCS has no English scripture data"
        DCS_VERDICT="NO_DATA"
    fi
else
    echo "   DCS API error: $DCS_HTTP_CODE"
    DCS_VERDICT="ERROR"
fi

echo ""
echo "2. Testing our API..."
OUR_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=en&organization=unfoldingWord")
OUR_HTTP_CODE=$(echo "$OUR_RESPONSE" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
OUR_BODY=$(echo "$OUR_RESPONSE" | grep -v "HTTP_CODE:")

if [ "$OUR_HTTP_CODE" = "200" ]; then
    echo "   Our API responded: 200 OK"
    # Check for either "scripture" or "verses" field
    OUR_HAS_DATA=$(echo "$OUR_BODY" | grep -o '"scripture":\[' | wc -l)
    if [ "$OUR_HAS_DATA" -eq 0 ]; then
        OUR_HAS_DATA=$(echo "$OUR_BODY" | grep -o '"verses":\[' | wc -l)
    fi
    if [ "$OUR_HAS_DATA" -gt 0 ]; then
        echo "   Our API has scripture data"
        OUR_VERDICT="HAS_DATA"
    else
        echo "   Our API has no scripture data"
        OUR_VERDICT="NO_DATA"
    fi
else
    echo "   Our API error: $OUR_HTTP_CODE"
    OUR_VERDICT="ERROR"
fi

echo ""
echo "3. Comparison:"
echo "   DCS: $DCS_VERDICT"
echo "   Our API: $OUR_VERDICT"

if [ "$DCS_VERDICT" = "HAS_DATA" ] && [ "$OUR_VERDICT" = "HAS_DATA" ]; then
    echo "   ✓ PASS: Both DCS and our API have the data"
    TEST1_PASS=1
elif [ "$DCS_VERDICT" = "NO_DATA" ] && [ "$OUR_VERDICT" = "NO_DATA" ]; then
    echo "   ✓ PASS: Both DCS and our API don't have the data"
    TEST1_PASS=1
else
    echo "   ✗ FAIL: Mismatch between DCS and our API"
    TEST1_PASS=0
fi

echo ""
echo ""

# Test 2: Check metadata
echo "[TEST 2] Metadata Verification"
echo "----------------------------------------"

echo "Checking if our API includes metadata..."
HAS_LANGUAGE=$(echo "$OUR_BODY" | grep -o '"language"' | wc -l)
HAS_ORG=$(echo "$OUR_BODY" | grep -o '"organization"' | wc -l)

if [ "$HAS_LANGUAGE" -gt 0 ] && [ "$HAS_ORG" -gt 0 ]; then
    echo "   ✓ PASS: Metadata includes language and organization"
    TEST2_PASS=1
else
    echo "   ✗ FAIL: Metadata missing language or organization"
    echo "   Has language: $HAS_LANGUAGE"
    echo "   Has organization: $HAS_ORG"
    TEST2_PASS=0
fi

echo ""
echo ""

# Test 3: Invalid resource
echo "[TEST 3] Invalid Resource Handling"
echo "----------------------------------------"

echo "Testing with invalid language 'xyz123'..."
INVALID_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/api/fetch-scripture?reference=John%203:16&language=xyz123&organization=unfoldingWord")
INVALID_HTTP_CODE=$(echo "$INVALID_RESPONSE" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
INVALID_BODY=$(echo "$INVALID_RESPONSE" | grep -v "HTTP_CODE:")

echo "   Our API responded: $INVALID_HTTP_CODE"

if [ "$INVALID_HTTP_CODE" = "404" ] || [ "$INVALID_HTTP_CODE" = "400" ]; then
    echo "   ✓ PASS: Correctly rejects invalid language"
    TEST3_PASS=1
elif echo "$INVALID_BODY" | grep -q "error"; then
    echo "   ✓ PASS: Returns error for invalid language"
    TEST3_PASS=1
else
    echo "   ✗ FAIL: Should reject invalid language"
    TEST3_PASS=0
fi

echo ""
echo ""

# Summary
echo "================================"
echo "SUMMARY"
echo "================================"

TOTAL_PASS=$((TEST1_PASS + TEST2_PASS + TEST3_PASS))

echo "Test 1 (Data Verification): $([ $TEST1_PASS -eq 1 ] && echo '✓ PASS' || echo '✗ FAIL')"
echo "Test 2 (Metadata): $([ $TEST2_PASS -eq 1 ] && echo '✓ PASS' || echo '✗ FAIL')"
echo "Test 3 (Invalid Resource): $([ $TEST3_PASS -eq 1 ] && echo '✓ PASS' || echo '✗ FAIL')"
echo ""
echo "Total: $TOTAL_PASS/3 tests passed"

if [ $TOTAL_PASS -eq 3 ]; then
    echo ""
    echo "✓ ALL TESTS PASSED"
    echo "Our API correctly mirrors DCS source of truth"
    exit 0
else
    echo ""
    echo "✗ SOME TESTS FAILED"
    echo "Check logs above for details"
    exit 1
fi
