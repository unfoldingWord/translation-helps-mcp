#!/bin/bash

# Test Phase 2: Metadata Standardization
# Tests that all endpoints return standardized metadata with dynamic subjects

API_BASE="http://localhost:8178/api"

echo "==================================="
echo "PHASE 2 METADATA STANDARDIZATION TEST"
echo "==================================="
echo ""

# Test Translation Notes
echo "1. Translation Notes - Metadata Structure"
echo "----------------------------------------"
TN_RESPONSE=$(curl -s "$API_BASE/fetch-translation-notes?reference=gen+1:1")
echo "$TN_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$TN_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "ResourceType field present:"
echo "$TN_RESPONSE" | grep -qi '"resourceType".*:.*"tn"' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "License field present:"
echo "$TN_RESPONSE" | grep -qi '"license":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""

# Test Translation Questions
echo "2. Translation Questions - Metadata Structure"
echo "----------------------------------------"
TQ_RESPONSE=$(curl -s "$API_BASE/fetch-translation-questions?reference=gen+1:1")
echo "$TQ_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$TQ_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "ResourceType field present:"
echo "$TQ_RESPONSE" | grep -qi '"resourceType".*:.*"tq"' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "License field present:"
echo "$TQ_RESPONSE" | grep -qi '"license":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""

# Test Translation Word Links
echo "3. Translation Word Links - Metadata Structure"
echo "----------------------------------------"
TWL_RESPONSE=$(curl -s "$API_BASE/fetch-translation-word-links?reference=gen+1:1")
echo "$TWL_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$TWL_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "ResourceType field present:"
echo "$TWL_RESPONSE" | grep -qi '"resourceType".*:.*"twl"' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "License field present:"
echo "$TWL_RESPONSE" | grep -qi '"license":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "ExternalReference present (not rcLink):"
echo "$TWL_RESPONSE" | grep -qi '"externalReference":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "Old rcLink removed:"
echo "$TWL_RESPONSE" | grep -qi '"rcLink":' && echo "❌ FAIL (still present)" || echo "✅ PASS (removed)"
echo ""

# Test Scripture
echo "4. Scripture - Metadata Structure"
echo "----------------------------------------"
SCRIPTURE_RESPONSE=$(curl -s "$API_BASE/fetch-scripture?reference=gen+1:1")
echo "$SCRIPTURE_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$SCRIPTURE_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "ResourceType field present:"
echo "$SCRIPTURE_RESPONSE" | grep -qi '"resourceType".*:.*"scripture"' && echo "✅ PASS" || echo "❌ FAIL"
echo ""
echo "License field present:"
echo "$SCRIPTURE_RESPONSE" | grep -qi '"license":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""

# Test Translation Word (from Phase 1 - regression test)
echo "5. Translation Word - Metadata Structure (Regression)"
echo "----------------------------------------"
TW_RESPONSE=$(curl -s "$API_BASE/fetch-translation-word?path=bible/kt/love")
echo "$TW_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$TW_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""

# Test Translation Academy (from Phase 1 - regression test)
echo "6. Translation Academy - Metadata Structure (Regression)"
echo "----------------------------------------"
TA_RESPONSE=$(curl -s "$API_BASE/fetch-translation-academy?path=translate/figs-metaphor")
echo "$TA_RESPONSE" | python -m json.tool | grep -A 10 '"metadata":'
echo ""
echo "Subject field present:"
echo "$TA_RESPONSE" | grep -qi '"subject":' && echo "✅ PASS" || echo "❌ FAIL"
echo ""

echo "==================================="
echo "PHASE 2 TEST COMPLETE"
echo "==================================="
