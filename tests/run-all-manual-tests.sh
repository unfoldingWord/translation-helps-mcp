#!/bin/bash

# Master Test Runner - All Manual Tests
# Runs all manual test scripts and generates comprehensive report

set -e

echo "================================================================"
echo "Translation Helps MCP - Complete Manual Test Suite"
echo "================================================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVER_URL=${SERVER_URL:-"http://localhost:8174"}

# Check server
echo -e "${BLUE}Checking server status...${NC}"
if ! curl -s "$SERVER_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Server not running at $SERVER_URL${NC}"
    echo "Start server with: npm run dev"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo ""

# Track results
TOTAL_SUITES=0
PASSED_SUITES=0
FAILED_SUITES=()

# Helper to run test suite
run_suite() {
    local script="$1"
    local name="$2"
    
    TOTAL_SUITES=$((TOTAL_SUITES + 1))
    
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    echo -e "${BLUE}Running: $name${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    
    if bash "$script"; then
        PASSED_SUITES=$((PASSED_SUITES + 1))
        echo -e "${GREEN}✓ $name PASSED${NC}"
    else
        FAILED_SUITES+=("$name")
        echo -e "${RED}✗ $name FAILED${NC}"
    fi
}

# Run all test suites
echo -e "${BLUE}Starting comprehensive test run...${NC}"
echo ""

run_suite "tests/simple-dcs-check.sh" "DCS Source Verification"
run_suite "tests/manual-endpoint-parity.sh" "Endpoint Parity"
run_suite "tests/manual-response-equivalence.sh" "Response Equivalence"
run_suite "tests/manual-prompts.sh" "Prompts Execution"
run_suite "tests/manual-schema-validation.sh" "Schema Validation"
run_suite "tests/manual-error-handling.sh" "Error Handling"
run_suite "tests/manual-integration.sh" "Integration Workflows"
run_suite "tests/manual-performance.sh" "Performance Benchmarks"
run_suite "tests/manual-cache-isolation.sh" "Cache Isolation"

# Final Summary
echo ""
echo "================================================================"
echo -e "${BLUE}FINAL TEST SUMMARY${NC}"
echo "================================================================"
echo ""
echo "Total Test Suites: $TOTAL_SUITES"
echo -e "${GREEN}Passed: $PASSED_SUITES${NC}"
echo -e "${RED}Failed: ${#FAILED_SUITES[@]}${NC}"
echo ""

if [ ${#FAILED_SUITES[@]} -eq 0 ]; then
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ ALL TEST SUITES PASSED!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════${NC}"
    echo ""
    echo "Test Coverage:"
    echo "  ✓ DCS Source Verification (3 tests)"
    echo "  ✓ Endpoint Parity (5 tests)"
    echo "  ✓ Response Equivalence (7 tests)"
    echo "  ✓ Prompts Execution (9 tests)"
    echo "  ✓ Schema Validation (12 tests)"
    echo "  ✓ Error Handling (11 tests)"
    echo "  ✓ Integration Workflows (8 tests)"
    echo "  ✓ Performance Benchmarks (10 tests)"
    echo "  ✓ Cache Isolation (10 tests)"
    echo ""
    echo "Total: ~75 individual test cases"
    echo ""
    exit 0
else
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo -e "${RED}✗ SOME TEST SUITES FAILED${NC}"
    echo -e "${RED}════════════════════════════════════════════${NC}"
    echo ""
    echo "Failed Test Suites:"
    for suite in "${FAILED_SUITES[@]}"; do
        echo -e "${RED}  ✗ $suite${NC}"
    done
    echo ""
    echo "Review the output above for details on failures."
    exit 1
fi
