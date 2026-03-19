#!/bin/bash
# Parameter Validation Test Runner
# Tests all parameter combinations for Translation Academy and Translation Word endpoints

set -e

echo "🧪 Parameter Validation Test Suite"
echo "=================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="${TEST_BASE_URL:-http://localhost:8174}"

echo "🌐 Testing against: $BASE_URL"
echo ""

# Test counter
PASSED=0
FAILED=0
TOTAL=0

# Helper function to run test
run_test() {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  local check_pattern="$4"
  
  TOTAL=$((TOTAL + 1))
  echo -n "[$TOTAL] $name ... "
  
  response=$(curl -s -w "\n%{http_code}" "$url")
  body=$(echo "$response" | head -n -1)
  status=$(echo "$response" | tail -n 1)
  
  if [ "$status" = "$expected_status" ]; then
    if [ -n "$check_pattern" ]; then
      if echo "$body" | grep -q "$check_pattern"; then
        echo -e "${GREEN}✓ PASS${NC}"
        PASSED=$((PASSED + 1))
      else
        echo -e "${RED}✗ FAIL${NC} (status ok but pattern not found: $check_pattern)"
        FAILED=$((FAILED + 1))
      fi
    else
      echo -e "${GREEN}✓ PASS${NC}"
      PASSED=$((PASSED + 1))
    fi
  else
    echo -e "${RED}✗ FAIL${NC} (expected $expected_status, got $status)"
    FAILED=$((FAILED + 1))
  fi
}

echo "📚 Translation Academy Tests"
echo "----------------------------"

# Test 1: Empty organization (should find es-419_gl)
run_test "Empty org, es language (auto-retry to es-419)" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&organization=&format=json&topic=tc-ready" \
  "200" \
  "Metáfora"

# Test 2: Omitted organization (should find es-419_gl)
run_test "Omitted org, es language" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&format=json&topic=tc-ready" \
  "200" \
  "title"

# Test 3: Explicit unfoldingWord (should 404)
run_test "Explicit unfoldingWord org, es language (should 404)" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es&organization=unfoldingWord&format=json&topic=tc-ready" \
  "404" \
  "not available"

# Test 4: Explicit es-419_gl org
run_test "Explicit es-419_gl org, es-419 language" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es-419&organization=es-419_gl&format=json&topic=tc-ready" \
  "200" \
  "title"

# Test 5: English with unfoldingWord
run_test "English with unfoldingWord" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&organization=unfoldingWord&format=json&topic=tc-ready" \
  "200" \
  "Metaphor"

# Test 6: JSON format
run_test "JSON format" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=json" \
  "200" \
  "title"

# Test 7: Markdown format
run_test "Markdown format" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=md" \
  "200" \
  "# Metaphor"

# Test 8: Markdown format (markdown alias)
run_test "Markdown format (markdown alias)" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=markdown" \
  "200" \
  "# Metaphor"

# Test 9: Invalid format (text)
run_test "Invalid format - text (should 400)" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=text" \
  "400" \
  "format is invalid"

# Test 10: Invalid format (usfm)
run_test "Invalid format - usfm (should 400)" \
  "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=en&format=usfm" \
  "400" \
  ""

# Test 11: Invalid path
run_test "Invalid path (should 404)" \
  "$BASE_URL/api/fetch-translation-academy?path=invalid/nonexistent&language=en&format=json" \
  "404" \
  ""

# Test 12: Omitted path (TOC)
run_test "Omitted path - should return TOC (404)" \
  "$BASE_URL/api/fetch-translation-academy?language=en&format=json" \
  "404" \
  "table-of-contents"

echo ""
echo "📖 Translation Word Tests"
echo "------------------------"

# Test 13: TW with empty org
run_test "TW empty org, es language" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=es&organization=&format=json" \
  "200" \
  "title"

# Test 14: TW explicit unfoldingWord with es
run_test "TW unfoldingWord org, es language (should 404)" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=es&organization=unfoldingWord&format=json" \
  "404" \
  ""

# Test 15: TW English with unfoldingWord
run_test "TW English with unfoldingWord" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=en&organization=unfoldingWord&format=json" \
  "200" \
  "love"

# Test 16: TW JSON format
run_test "TW JSON format" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=en&format=json" \
  "200" \
  "definition"

# Test 17: TW markdown format
run_test "TW markdown format" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=en&format=md" \
  "200" \
  "#"

# Test 18: TW with category filter
run_test "TW with kt category" \
  "$BASE_URL/api/fetch-translation-word?path=bible/kt/love&language=en&category=kt&format=json" \
  "200" \
  "kt"

echo ""
echo "🎯 Cache Isolation Tests"
echo "------------------------"

# Test 19: Cache should not cross-contaminate between orgs
echo -n "[$((TOTAL + 1))] Cache isolation test ... "
TOTAL=$((TOTAL + 1))

# Request 1: All orgs (should succeed)
status1=$(curl -s -w "%{http_code}" -o /dev/null "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es-419&organization=&format=json")

# Request 2: Explicit unfoldingWord (should 404)
status2=$(curl -s -w "%{http_code}" -o /dev/null "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es-419&organization=unfoldingWord&format=json")

# Request 3: All orgs again (should succeed)
status3=$(curl -s -w "%{http_code}" -o /dev/null "$BASE_URL/api/fetch-translation-academy?path=translate/figs-metaphor&language=es-419&organization=&format=json")

if [ "$status1" = "200" ] && [ "$status2" = "404" ] && [ "$status3" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAIL${NC} (status1=$status1, status2=$status2, status3=$status3)"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "📊 Test Results"
echo "==============="
echo "Total:  $TOTAL"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
