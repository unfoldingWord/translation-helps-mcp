#!/bin/bash

# Test External Reference Flow
# Verify that externalReference from TN/TWL can be used to fetch TW/TA entries

API_BASE="http://localhost:8178/api"

echo "==================================="
echo "EXTERNAL REFERENCE FLOW TEST"
echo "==================================="
echo ""

# Step 1: Fetch Translation Notes and extract an externalReference to TA
echo "1. Fetch Translation Notes and extract TA reference"
echo "---------------------------------------------------"
TN_RESPONSE=$(curl -s "$API_BASE/fetch-translation-notes?reference=gen+1:1")
TA_REF=$(echo "$TN_RESPONSE" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for item in data.get('items', []):
        if item.get('externalReference', {}).get('target') == 'ta':
            print(item['externalReference']['path'])
            break
except: pass
")
echo "Extracted TA path: $TA_REF"
echo ""

# Step 2: Use that reference to fetch the TA article
if [ -n "$TA_REF" ]; then
    echo "2. Fetch TA article using extracted path"
    echo "----------------------------------------"
    TA_RESPONSE=$(curl -s "$API_BASE/fetch-translation-academy?path=$TA_REF")
    echo "$TA_RESPONSE" | python -m json.tool | grep -A 3 '"title":'
    echo ""
    echo "TA fetch successful:"
    echo "$TA_RESPONSE" | grep -qi '"title":' && echo "✅ PASS" || echo "❌ FAIL"
else
    echo "❌ No TA reference found in TN response"
fi
echo ""

# Step 3: Fetch Translation Word Links and extract an externalReference to TW
echo "3. Fetch Translation Word Links and extract TW reference"
echo "---------------------------------------------------------"
TWL_RESPONSE=$(curl -s "$API_BASE/fetch-translation-word-links?reference=gen+1:1")
TW_REF=$(echo "$TWL_RESPONSE" | python -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for item in data.get('items', []):
        if item.get('externalReference', {}).get('target') == 'tw':
            print(item['externalReference']['path'])
            break
except: pass
")
echo "Extracted TW path: $TW_REF"
echo ""

# Step 4: Use that reference to fetch the TW article
if [ -n "$TW_REF" ]; then
    echo "4. Fetch TW article using extracted path"
    echo "----------------------------------------"
    TW_RESPONSE=$(curl -s "$API_BASE/fetch-translation-word?path=$TW_REF")
    echo "$TW_RESPONSE" | python -m json.tool | grep -A 3 '"title":'
    echo ""
    echo "TW fetch successful:"
    echo "$TW_RESPONSE" | grep -qi '"title":' && echo "✅ PASS" || echo "❌ FAIL"
else
    echo "❌ No TW reference found in TWL response"
fi
echo ""

echo "==================================="
echo "EXTERNAL REFERENCE FLOW TEST COMPLETE"
echo "==================================="
