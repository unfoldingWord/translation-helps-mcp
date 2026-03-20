#!/bin/bash

# Manual Performance Tests
# Benchmarks response times for various operations

set -e

SERVER_URL="http://localhost:8174"

echo "==========================================="
echo "Performance Tests"
echo "==========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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

warn_test() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    echo ""
}

# Health check
if ! curl -s "$SERVER_URL/api/health" > /dev/null; then
    echo "Server not running"
    exit 1
fi

# Helper to measure response time
measure_time() {
    local url="$1"
    local start=$(date +%s%3N)  # milliseconds
    curl -s "$url" > /dev/null
    local end=$(date +%s%3N)
    echo $((end - start))
}

# TEST 1: Scripture fetch performance (first call, uncached)
run_test "Scripture fetch < 2000ms (first call)"

echo "  Measuring first call (uncached)..."
TIME1=$(measure_time "$SERVER_URL/api/fetch-scripture?reference=Romans+8:1&language=en&organization=unfoldingWord")
echo "    Time: ${TIME1}ms"

if [ "$TIME1" -lt 2000 ]; then
    pass_test "Scripture fetch within 2000ms (${TIME1}ms)"
elif [ "$TIME1" -lt 5000 ]; then
    warn_test "Scripture fetch slow but acceptable (${TIME1}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Scripture fetch too slow (${TIME1}ms > 2000ms)"
fi

# TEST 2: Scripture fetch performance (second call, cached)
run_test "Scripture fetch < 500ms (cached)"

echo "  Measuring second call (should be cached)..."
TIME2=$(measure_time "$SERVER_URL/api/fetch-scripture?reference=Romans+8:1&language=en&organization=unfoldingWord")
echo "    Time: ${TIME2}ms"
echo "    Speedup: $((TIME1 - TIME2))ms faster"

if [ "$TIME2" -lt 500 ]; then
    pass_test "Cached fetch within 500ms (${TIME2}ms)"
elif [ "$TIME2" -lt 1000 ]; then
    warn_test "Cached fetch acceptable (${TIME2}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Cached fetch too slow (${TIME2}ms > 500ms)"
fi

# TEST 3: Language list performance
run_test "Language list < 1000ms"

echo "  Measuring language list..."
TIME_LANGS=$(measure_time "$SERVER_URL/api/list-languages")
echo "    Time: ${TIME_LANGS}ms"

if [ "$TIME_LANGS" -lt 1000 ]; then
    pass_test "Language list within 1000ms (${TIME_LANGS}ms)"
elif [ "$TIME_LANGS" -lt 2000 ]; then
    warn_test "Language list acceptable (${TIME_LANGS}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Language list too slow (${TIME_LANGS}ms > 1000ms)"
fi

# TEST 4: Translation Notes performance
run_test "Translation Notes fetch < 2000ms"

echo "  Measuring Translation Notes fetch..."
TIME_TN=$(measure_time "$SERVER_URL/api/fetch-translation-notes?reference=John+3:16&language=en&organization=unfoldingWord")
echo "    Time: ${TIME_TN}ms"

if [ "$TIME_TN" -lt 2000 ]; then
    pass_test "Translation Notes within 2000ms (${TIME_TN}ms)"
elif [ "$TIME_TN" -lt 5000 ]; then
    warn_test "Translation Notes acceptable (${TIME_TN}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Translation Notes too slow (${TIME_TN}ms > 2000ms)"
fi

# TEST 5: Translation Word performance
run_test "Translation Word fetch < 1500ms"

echo "  Measuring Translation Word fetch..."
TIME_TW=$(measure_time "$SERVER_URL/api/fetch-translation-word?path=kt/grace&language=en&organization=unfoldingWord")
echo "    Time: ${TIME_TW}ms"

if [ "$TIME_TW" -lt 1500 ]; then
    pass_test "Translation Word within 1500ms (${TIME_TW}ms)"
elif [ "$TIME_TW" -lt 3000 ]; then
    warn_test "Translation Word acceptable (${TIME_TW}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Translation Word too slow (${TIME_TW}ms > 1500ms)"
fi

# TEST 6: Translation Academy performance
run_test "Translation Academy fetch < 1500ms"

echo "  Measuring Translation Academy fetch..."
TIME_TA=$(measure_time "$SERVER_URL/api/fetch-translation-academy?path=translate/figs-idiom&language=en&organization=unfoldingWord")
echo "    Time: ${TIME_TA}ms"

if [ "$TIME_TA" -lt 1500 ]; then
    pass_test "Translation Academy within 1500ms (${TIME_TA}ms)"
elif [ "$TIME_TA" -lt 3000 ]; then
    warn_test "Translation Academy acceptable (${TIME_TA}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Translation Academy too slow (${TIME_TA}ms > 1500ms)"
fi

# TEST 7: Prompt execution performance
run_test "Prompt execution < 3000ms"

echo "  Measuring prompt execution..."
START=$(date +%s%3N)
curl -s -X POST "$SERVER_URL/api/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"translation-helps-report","arguments":{"reference":"John 3:16","language":"en"}}}' > /dev/null
END=$(date +%s%3N)
TIME_PROMPT=$((END - START))
echo "    Time: ${TIME_PROMPT}ms"

if [ "$TIME_PROMPT" -lt 3000 ]; then
    pass_test "Prompt execution within 3000ms (${TIME_PROMPT}ms)"
elif [ "$TIME_PROMPT" -lt 6000 ]; then
    warn_test "Prompt execution acceptable (${TIME_PROMPT}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Prompt execution too slow (${TIME_PROMPT}ms > 3000ms)"
fi

# TEST 8: Parallel requests performance
run_test "5 parallel requests complete efficiently"

echo "  Launching 5 parallel requests..."
START_PARALLEL=$(date +%s%3N)

curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:1&language=en" > /dev/null &
curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:2&language=en" > /dev/null &
curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:3&language=en" > /dev/null &
curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:4&language=en" > /dev/null &
curl -s "$SERVER_URL/api/fetch-scripture?reference=John+1:5&language=en" > /dev/null &

wait
END_PARALLEL=$(date +%s%3N)
TIME_PARALLEL=$((END_PARALLEL - START_PARALLEL))
echo "    Time: ${TIME_PARALLEL}ms"
echo "    Average per request: $((TIME_PARALLEL / 5))ms"

if [ "$TIME_PARALLEL" -lt 5000 ]; then
    pass_test "Parallel requests efficient (${TIME_PARALLEL}ms total)"
elif [ "$TIME_PARALLEL" -lt 10000 ]; then
    warn_test "Parallel requests acceptable (${TIME_PARALLEL}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Parallel requests too slow (${TIME_PARALLEL}ms > 5000ms)"
fi

# TEST 9: Cache speedup verification
run_test "Cache provides significant speedup"

echo "  Comparing uncached vs cached..."
SPEEDUP_RATIO=$(echo "scale=2; $TIME1 / $TIME2" | bc 2>/dev/null || echo "1")
echo "    Speedup ratio: ${SPEEDUP_RATIO}x"

if [ "$TIME1" -gt "$TIME2" ]; then
    SPEEDUP=$((TIME1 - TIME2))
    if [ "$SPEEDUP" -gt 500 ]; then
        pass_test "Cache provides ${SPEEDUP}ms speedup (${SPEEDUP_RATIO}x)"
    else
        warn_test "Cache speedup modest (${SPEEDUP}ms)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    fi
else
    fail_test "Cache not providing speedup"
fi

# TEST 10: Health check performance
run_test "Health check < 100ms"

echo "  Measuring health check..."
TIME_HEALTH=$(measure_time "$SERVER_URL/api/health")
echo "    Time: ${TIME_HEALTH}ms"

if [ "$TIME_HEALTH" -lt 100 ]; then
    pass_test "Health check fast (${TIME_HEALTH}ms)"
elif [ "$TIME_HEALTH" -lt 500 ]; then
    warn_test "Health check acceptable (${TIME_HEALTH}ms)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    fail_test "Health check slow (${TIME_HEALTH}ms > 100ms)"
fi

# Summary
echo "==========================================="
echo "SUMMARY"
echo "==========================================="
echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

echo "Performance Breakdown:"
echo "  Scripture (uncached): ${TIME1}ms"
echo "  Scripture (cached):   ${TIME2}ms"
echo "  Language list:        ${TIME_LANGS}ms"
echo "  Translation Notes:    ${TIME_TN}ms"
echo "  Translation Word:     ${TIME_TW}ms"
echo "  Translation Academy:  ${TIME_TA}ms"
echo "  Prompt execution:     ${TIME_PROMPT}ms"
echo "  5 parallel requests:  ${TIME_PARALLEL}ms"
echo "  Health check:         ${TIME_HEALTH}ms"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ ALL PERFORMANCE TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
