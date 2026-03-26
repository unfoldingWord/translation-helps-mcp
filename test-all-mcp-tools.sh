#!/bin/bash

# Test All MCP Tools - Optimized Version
# Tests all 9 translation-helps MCP tools with appropriate timeouts

BASE_URL="${TEST_BASE_URL:-http://localhost:8174}"
MCP_URL="${BASE_URL}/api/mcp"
PASSED=0
FAILED=0

echo "=========================================="
echo "Testing All MCP Tools"
echo "=========================================="
echo "MCP_URL=$MCP_URL"
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test tools/list first
echo -e "${BLUE}Testing: tools/list (connectivity check)${NC}"
list_response=$(curl -s -m 10 -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{
        "jsonrpc": "2.0",
        "id": 0,
        "method": "tools/list",
        "params": {}
    }')

if echo "$list_response" | grep -q '"name"'; then
    tool_count=$(echo "$list_response" | grep -o '"name":' | wc -l)
    echo -e "${GREEN}✅ Server connected - Found $tool_count tools${NC}"
else
    echo -e "${RED}❌ Server not responding${NC}"
    echo "$list_response"
    exit 1
fi
echo ""

test_mcp_tool() {
    local name="$1"
    local tool_name="$2"
    local params="$3"
    local check_pattern="$4"
    local timeout="${5:-60}"
    
    echo -e "${BLUE}Testing: $name${NC}"
    
    response=$(curl -s -m "$timeout" -X POST "$MCP_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"jsonrpc\": \"2.0\",
            \"id\": 1,
            \"method\": \"tools/call\",
            \"params\": {
                \"name\": \"$tool_name\",
                \"arguments\": $params
            }
        }" 2>&1)
    
    # Check for MCP success (no error) and expected data pattern
    # MCP wraps data in: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"...actual data..."}]}}
    if echo "$response" | grep -q '"error"'; then
        echo -e "${RED}❌ FAIL - Error response${NC}"
        echo "$response" | grep -o '"error":[^}]*}'
        ((FAILED++))
    elif echo "$response" | grep -q "$check_pattern"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAIL - Pattern not found${NC}"
        echo "Expected: $check_pattern"
        echo "Response: ${response:0:300}..."
        ((FAILED++))
    fi
    echo ""
}

# Discovery tools (faster) - patterns match escaped JSON in "text" field
test_mcp_tool "list_languages" "list_languages" \
    '{"stage": "prod"}' \
    '\\"languages\\":' 30

test_mcp_tool "list_subjects" "list_subjects" \
    '{"language": "en", "stage": "prod"}' \
    '\\"subjects\\":' 30

test_mcp_tool "list_resources_for_language" "list_resources_for_language" \
    '{"language": "en", "stage": "prod"}' \
    '\\"subjects\\":' 30

# Fetch tools (slower)
test_mcp_tool "fetch_scripture" "fetch_scripture" \
    '{"reference": "JHN 3:16", "language": "en", "resource": "ult"}' \
    '\\"text\\":' 60

test_mcp_tool "fetch_translation_notes" "fetch_translation_notes" \
    '{"reference": "JHN 3:16", "language": "en"}' \
    '\\"verseNotes\\":' 60

test_mcp_tool "fetch_translation_questions" "fetch_translation_questions" \
    '{"reference": "JHN 1:1", "language": "en"}' \
    '\\"items\\":' 60

test_mcp_tool "fetch_translation_word_links" "fetch_translation_word_links" \
    '{"reference": "JHN 3:16", "language": "en"}' \
    '\\"items\\":' 60

test_mcp_tool "fetch_translation_word" "fetch_translation_word" \
    '{"path": "bible/kt/grace", "language": "en"}' \
    '\\"content\\":' 60

test_mcp_tool "fetch_translation_academy" "fetch_translation_academy" \
    '{"path": "translate/figs-metaphor", "language": "en"}' \
    '\\"content\\":' 60

# Summary
echo "=========================================="
echo "MCP Tools Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED / 9${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $FAILED / 9${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
fi
