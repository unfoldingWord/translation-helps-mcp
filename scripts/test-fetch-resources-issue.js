/**
 * Test script to reproduce the fetch_resources issue
 *
 * This script simulates what an agent would do:
 * 1. List available tools
 * 2. Try to call fetch_resources (if it exists)
 * 3. Measure response size
 */

const BASE_URL =
  process.env.TEST_BASE_URL || "https://tc-helps.mcp.servant.bible";
const MCP_ENDPOINT = `${BASE_URL}/api/mcp`;

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function sendMCPRequest(method, params = {}) {
  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "mcp-protocol-version": "2024-11-05",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`MCP Error: ${data.error.message}`);
  }

  // Handle both JSON-RPC 2.0 format and direct result
  return data.result !== undefined ? data.result : data;
}

async function testFetchResourcesIssue() {
  console.log("=".repeat(80));
  log("🔍 REPRODUCING fetch_resources ISSUE", "cyan");
  console.log("=".repeat(80));
  log(`\n📍 Testing: ${BASE_URL}`, "cyan");

  try {
    // Step 1: List tools
    log("\n📋 Step 1: Listing available tools...", "cyan");
    const toolsResult = await sendMCPRequest("tools/list");
    console.log(
      "   Debug - toolsResult:",
      JSON.stringify(toolsResult, null, 2).substring(0, 200),
    );
    const tools =
      toolsResult && toolsResult.tools
        ? toolsResult.tools
        : Array.isArray(toolsResult)
          ? toolsResult
          : [];
    const toolNames = tools.map((t) => (typeof t === "string" ? t : t.name));

    log(`   Found ${tools.length} tools`, "green");
    log(`   Tools: ${toolNames.join(", ")}`, "green");

    // Check if fetch_resources is in the list
    const hasFetchResources = toolNames.includes("fetch_resources");
    if (hasFetchResources) {
      log(
        "\n⚠️  ISSUE REPRODUCED: fetch_resources is in the tools list!",
        "yellow",
      );
      log("   This means agents will try to use it first", "yellow");
    } else {
      log("\n✅ FIXED: fetch_resources is NOT in the tools list", "green");
      log("   Agents will not see this tool", "green");
    }

    // Step 2: Try to call fetch_resources
    log("\n🧪 Step 2: Attempting to call fetch_resources...", "cyan");
    try {
      const result = await sendMCPRequest("tools/call", {
        name: "fetch_resources",
        arguments: {
          reference: "John 3:16",
          language: "en",
          organization: "unfoldingWord",
        },
      });

      const resultStr = JSON.stringify(result);
      const resultSize = resultStr.length;

      log(`   ✅ Call succeeded (but shouldn't be available)`, "yellow");
      log(`   Response size: ${resultSize} characters`, "yellow");

      if (resultSize < 50) {
        log(`   ⚠️  ISSUE: Response is too small (${resultSize} chars)`, "red");
        log(`   This matches the reported issue: ~29 characters`, "red");
        log(`   Response preview: ${resultStr.substring(0, 100)}`, "yellow");
      } else {
        log(`   Response seems substantial (${resultSize} chars)`, "green");
      }
    } catch (error) {
      if (error.message.includes("Unknown tool")) {
        log(`   ✅ CORRECT: fetch_resources is not available`, "green");
        log(`   Error: ${error.message}`, "green");
      } else {
        log(`   ❌ Unexpected error: ${error.message}`, "red");
      }
    }

    // Step 3: Compare with specific tools
    log("\n📊 Step 3: Comparing with specific tools...", "cyan");
    const specificTools = ["fetch_scripture", "fetch_translation_notes"];

    for (const toolName of specificTools) {
      if (toolNames.includes(toolName)) {
        try {
          const result = await sendMCPRequest("tools/call", {
            name: toolName,
            arguments: {
              reference: "John 3:16",
              language: "en",
              organization: "unfoldingWord",
            },
          });

          const resultStr = JSON.stringify(result);
          const resultSize = resultStr.length;
          log(`   ${toolName}: ${resultSize} characters`, "green");
        } catch (error) {
          log(`   ${toolName}: Error - ${error.message}`, "red");
        }
      }
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    log("📋 SUMMARY", "cyan");
    console.log("=".repeat(80));

    if (hasFetchResources) {
      log("❌ ISSUE STILL EXISTS:", "red");
      log("   - fetch_resources is advertised in tools/list", "red");
      log("   - Agents will try to use it first", "red");
      log("   - It returns minimal data (~29 chars)", "red");
      log("   - This wastes time before agents use specific tools", "red");
    } else {
      log("✅ ISSUE FIXED:", "green");
      log("   - fetch_resources is NOT in tools/list", "green");
      log("   - Agents will use specific tools directly", "green");
      log("   - No wasted time on useless calls", "green");
    }
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  }
}

testFetchResourcesIssue();
