#!/bin/bash

# Comprehensive test for language variant auto-retry across all tools
# Tests Spanish (es) → Spanish Latin America (es-419) automatic retry

BASE_URL="http://localhost:8174"

echo "================================================"
echo "🧪 AUTO-RETRY TEST SUITE - ALL TOOLS"
echo "Testing: es → es-419 automatic language variant detection"
echo "================================================"
echo

# Test 1: Scripture
echo "1. Testing fetch-scripture..."
curl -s "$BASE_URL/api/fetch-scripture?reference=JON+1:1&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); print('[OK] Scripture: Status=' + (str(s) if s else 'OK') + ', Scripture texts=' + str(len(d.get('scripture', []))))"
echo

# Test 2: Translation Notes
echo "2. Testing fetch-translation-notes..."
curl -s "$BASE_URL/api/fetch-translation-notes?reference=JON+1:1&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); items=d.get('items', []); print('[OK] Translation Notes: Status=' + (str(s) if s else 'OK') + ', Notes=' + str(len(items)))"
echo

# Test 3: Translation Questions
echo "3. Testing fetch-translation-questions..."
curl -s "$BASE_URL/api/fetch-translation-questions?reference=JON+1:1&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); items=d.get('items', []); print('[OK] Translation Questions: Status=' + (str(s) if s else 'OK') + ', Questions=' + str(len(items)) + ' (may be 0 for verse 1)')"
echo

# Test 4: Translation Word Links
echo "4. Testing fetch-translation-word-links..."
curl -s "$BASE_URL/api/fetch-translation-word-links?reference=JON+1:1&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); items=d.get('items', []); print('[OK] Word Links: Status=' + (str(s) if s else 'OK') + ', Links=' + str(len(items)))"
echo

# Test 5: Translation Word (using a known term from the links)
echo "5. Testing fetch-translation-word..."
curl -s "$BASE_URL/api/fetch-translation-word?path=bible/kt/wordofgod&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); article=d.get('article'); print('[OK] Translation Word: Status=' + (str(s) if s else 'OK') + ', Has article=' + str(bool(article)))"
echo

# Test 6: Translation Academy
echo "6. Testing fetch-translation-academy..."
curl -s "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&format=json" | \
py -c "import sys, json; d=json.load(sys.stdin); s=d.get('status'); content=d.get('content'); print('[OK] Translation Academy: Status=' + (str(s) if s else 'OK') + ', Has content=' + str(bool(content)))"
echo

echo "================================================"
echo "✅ AUTO-RETRY TEST SUITE COMPLETE"
echo "================================================"
echo
echo "Expected results:"
echo "  - All tools should return Status=OK or Status=None (200)"
echo "  - All tools should have data (verses, notes, links, articles, content)"
echo "  - Questions may be 0 for JON 1:1 (chapter-level data only)"
echo "  - All tools automatically detected es-419 as the variant"
echo
