#!/bin/bash

# Comprehensive Test Runner for Translation Helps MCP
# Runs all test suites and generates coverage reports

set -e  # Exit on error

echo "🧪 Translation Helps MCP - Comprehensive Test Suite"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TEST_SERVER_URL=${TEST_SERVER_URL:-"http://localhost:8174"}
SERVER_START_TIMEOUT=30

# Check if server is running
check_server() {
  echo -e "${BLUE}🔍 Checking server status...${NC}"
  
  for i in $(seq 1 $SERVER_START_TIMEOUT); do
    if curl -s "$TEST_SERVER_URL/api/health" > /dev/null 2>&1; then
      echo -e "${GREEN}✅ Server is running at $TEST_SERVER_URL${NC}"
      return 0
    fi
    
    if [ $i -eq 1 ]; then
      echo -e "${YELLOW}⏳ Waiting for server to start...${NC}"
    fi
    
    sleep 1
  done
  
  echo -e "${RED}❌ Server not responding after ${SERVER_START_TIMEOUT}s${NC}"
  echo -e "${YELLOW}💡 Start the server with: npm run dev${NC}"
  exit 1
}

# Run specific test suite
run_test_suite() {
  local test_file=$1
  local test_name=$2
  
  echo ""
  echo -e "${BLUE}📝 Running: $test_name${NC}"
  echo "----------------------------------------"
  
  if npx vitest run "$test_file" --reporter=verbose; then
    echo -e "${GREEN}✅ $test_name PASSED${NC}"
    return 0
  else
    echo -e "${RED}❌ $test_name FAILED${NC}"
    return 1
  fi
}

# Main execution
main() {
  # Check server
  check_server
  
  # Track results
  FAILED_TESTS=()
  PASSED_COUNT=0
  TOTAL_COUNT=0
  
  # Critical tests (must pass)
  echo ""
  echo -e "${BLUE}🎯 Phase 1: Critical Tests${NC}"
  echo "=================================================="
  
  if run_test_suite "tests/endpoint-parity.test.ts" "Endpoint Parity"; then
    ((PASSED_COUNT++))
  else
    FAILED_TESTS+=("Endpoint Parity")
  fi
  ((TOTAL_COUNT++))
  
  if run_test_suite "tests/response-equivalence.test.ts" "Response Equivalence"; then
    ((PASSED_COUNT++))
  else
    FAILED_TESTS+=("Response Equivalence")
  fi
  ((TOTAL_COUNT++))
  
  if run_test_suite "tests/prompts.test.ts" "Prompts"; then
    ((PASSED_COUNT++))
  else
    FAILED_TESTS+=("Prompts")
  fi
  ((TOTAL_COUNT++))
  
  # Validation tests
  echo ""
  echo -e "${BLUE}🔍 Phase 2: Validation Tests${NC}"
  echo "=================================================="
  
  if [ -f "tests/parameter-validation.test.ts" ]; then
    if run_test_suite "tests/parameter-validation.test.ts" "Parameter Validation"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Parameter Validation")
    fi
    ((TOTAL_COUNT++))
  fi
  
  if [ -f "tests/schema-validation.test.ts" ]; then
    if run_test_suite "tests/schema-validation.test.ts" "Schema Validation"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Schema Validation")
    fi
    ((TOTAL_COUNT++))
  fi
  
  if [ -f "tests/error-handling.test.ts" ]; then
    if run_test_suite "tests/error-handling.test.ts" "Error Handling"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Error Handling")
    fi
    ((TOTAL_COUNT++))
  fi
  
  # Integration and performance tests
  echo ""
  echo -e "${BLUE}🔗 Phase 3: Integration & Performance${NC}"
  echo "=================================================="
  
  if [ -f "tests/integration.test.ts" ]; then
    if run_test_suite "tests/integration.test.ts" "Integration Tests"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Integration Tests")
    fi
    ((TOTAL_COUNT++))
  fi
  
  if [ -f "tests/performance.test.ts" ]; then
    if run_test_suite "tests/performance.test.ts" "Performance Tests"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Performance Tests")
    fi
    ((TOTAL_COUNT++))
  fi
  
  if [ -f "tests/cache-isolation.test.ts" ]; then
    if run_test_suite "tests/cache-isolation.test.ts" "Cache Isolation"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Cache Isolation")
    fi
    ((TOTAL_COUNT++))
  fi
  
  if [ -f "tests/language-variants.test.ts" ]; then
    if run_test_suite "tests/language-variants.test.ts" "Language Variants"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("Language Variants")
    fi
    ((TOTAL_COUNT++))
  fi
  
  # DCS Source of Truth Verification
  echo ""
  echo -e "${BLUE}🌐 Phase 4: DCS Source Verification${NC}"
  echo "=================================================="
  
  if [ -f "tests/dcs-source-verification.test.ts" ]; then
    if run_test_suite "tests/dcs-source-verification.test.ts" "DCS Source Verification"; then
      ((PASSED_COUNT++))
    else
      FAILED_TESTS+=("DCS Source Verification")
    fi
    ((TOTAL_COUNT++))
  fi
  
  # Summary
  echo ""
  echo "=================================================="
  echo -e "${BLUE}📊 Test Summary${NC}"
  echo "=================================================="
  echo -e "Total Suites: $TOTAL_COUNT"
  echo -e "${GREEN}Passed: $PASSED_COUNT${NC}"
  
  if [ ${#FAILED_TESTS[@]} -eq 0 ]; then
    echo -e "${GREEN}Failed: 0${NC}"
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
    
    # Run coverage if all tests passed
    echo ""
    echo -e "${BLUE}📈 Generating coverage report...${NC}"
    npx vitest run --coverage || echo -e "${YELLOW}⚠️  Coverage generation requires @vitest/coverage-v8${NC}"
    
    exit 0
  else
    echo -e "${RED}Failed: ${#FAILED_TESTS[@]}${NC}"
    echo ""
    echo -e "${RED}❌ Failed test suites:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
      echo -e "${RED}  • $test${NC}"
    done
    exit 1
  fi
}

# Handle script arguments
case "${1:-}" in
  --help|-h)
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --help, -h     Show this help message"
    echo "  --watch, -w    Run tests in watch mode"
    echo ""
    echo "Environment Variables:"
    echo "  TEST_SERVER_URL    Server URL (default: http://localhost:8174)"
    echo ""
    exit 0
    ;;
  --watch|-w)
    check_server
    echo -e "${BLUE}👀 Running tests in watch mode...${NC}"
    npx vitest --reporter=verbose
    ;;
  *)
    main
    ;;
esac
