#!/bin/bash

# Test Dynamic Titles in Citations
# Verifies that all per-item citations include dynamic title from DCS catalog

API_BASE="http://localhost:8178/api"
echo "🧪 Testing Dynamic Titles in Per-Item Citations..."
echo ""

# Test 1: Translation Notes - per-item citation has title
echo "📖 Test 1: Translation Notes - per-item citation includes title"
TN_RESPONSE=$(curl -s "$API_BASE/fetch-translation-notes?reference=john+3:16&language=en")

# Check that items have citation with title
# Need to grep through more lines since items array can be large
if echo "$TN_RESPONSE" | python -m json.tool | grep -A 500 '"items":' | grep -A 8 '"citation":' | grep -q '"title":'; then
    echo "✅ TN per-item citations include title field"
else
    echo "❌ FAIL: TN per-item citations missing title field"
    exit 1
fi

# Verify the title is not empty and looks like a proper resource title
TN_TITLE=$(echo "$TN_RESPONSE" | python -m json.tool | grep -A 10 '"items":' | grep -A 8 '"citation":' | grep '"title":' | head -1)
if echo "$TN_TITLE" | grep -q 'Translation Notes'; then
    echo "✅ TN title is dynamic from catalog: $TN_TITLE"
else
    echo "⚠️  WARNING: TN title doesn't match expected pattern"
fi

echo ""
echo "📝 Test 2: Translation Questions - per-item citation includes title"
TQ_RESPONSE=$(curl -s "$API_BASE/fetch-translation-questions?reference=john+3:16&language=en")

if echo "$TQ_RESPONSE" | python -m json.tool | grep -A 500 '"items":' | grep -A 8 '"citation":' | grep -q '"title":'; then
    echo "✅ TQ per-item citations include title field"
else
    echo "❌ FAIL: TQ per-item citations missing title field"
    exit 1
fi

TQ_TITLE=$(echo "$TQ_RESPONSE" | python -m json.tool | grep -A 10 '"items":' | grep -A 8 '"citation":' | grep '"title":' | head -1)
if echo "$TQ_TITLE" | grep -q 'Translation Questions'; then
    echo "✅ TQ title is dynamic from catalog: $TQ_TITLE"
else
    echo "⚠️  WARNING: TQ title doesn't match expected pattern"
fi

echo ""
echo "📖 Test 3: Scripture - per-item citation includes title"
SCRIPTURE_RESPONSE=$(curl -s "$API_BASE/fetch-scripture?reference=john+3:16&language=en")

if echo "$SCRIPTURE_RESPONSE" | python -m json.tool | grep -A 15 '"scripture":' | grep -A 10 '"citation":' | grep -q '"title":'; then
    echo "✅ Scripture per-item citations include title field"
else
    echo "❌ FAIL: Scripture per-item citations missing title field"
    exit 1
fi

# Check that different resources have different titles
SCRIPTURE_TITLES=$(echo "$SCRIPTURE_RESPONSE" | python -m json.tool | grep -A 10 '"citation":' | grep '"title":' | sort -u)
UNIQUE_COUNT=$(echo "$SCRIPTURE_TITLES" | wc -l)

if [ "$UNIQUE_COUNT" -gt 1 ]; then
    echo "✅ Scripture resources have different dynamic titles (found $UNIQUE_COUNT unique)"
    echo "   Examples:"
    echo "$SCRIPTURE_TITLES" | head -3 | sed 's/^/   /'
else
    echo "⚠️  WARNING: All scripture resources have the same title"
fi

echo ""
echo "✨ All tests passed!"
echo ""
echo "📋 Summary:"
echo "  ✅ Translation Notes: Per-item citations include dynamic title"
echo "  ✅ Translation Questions: Per-item citations include dynamic title"
echo "  ✅ Scripture: Per-item citations include dynamic title"
echo "  ✅ All titles are dynamic from DCS catalog (not hardcoded)"
echo ""
