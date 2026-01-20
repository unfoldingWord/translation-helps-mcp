/**
 * Comprehensive test for all MCP tools and prompts
 * Tests all 9 tools via REST API endpoints (more reliable than MCP HTTP)
 * Tests all 5 prompts via MCP endpoint
 * Run with: node scripts/test-all-tools-and-prompts.js
 *
 * Requirements:
 * - UI server must be running (npm run dev in ui/ directory)
 * - Uses unfoldingWord as organization
 * - Uses en as language where needed
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8174";
const MCP_ENDPOINT = `${BASE_URL}/api/mcp`;

// Test configuration
const TEST_CONFIG = {
  organization: "unfoldingWord",
  language: "en",
  reference: "John 3:16",
  term: "grace",
  moduleId: "figs-metaphor",
  testLanguage: "es-419", // For discovery tests
  testSubject: "Translation Words", // For discovery tests
};

// Test results
const results = {
  tools: {},
  prompts: {},
  passed: 0,
  failed: 0,
  total: 0,
};

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log("\n" + "=".repeat(80));
  log(title, "bright");
  console.log("=".repeat(80));
}

function logTest(name, status, details = "") {
  const icon = status === "pass" ? "✅" : status === "fail" ? "❌" : "⏸️";
  const color =
    status === "pass" ? "green" : status === "fail" ? "red" : "yellow";
  log(`${icon} ${name}`, color);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Test a tool via REST API
async function testToolRest(toolName, params, description, endpointPath) {
  results.total++;
  try {
    log(`\n🧪 Testing: ${toolName}`, "cyan");
    console.log(`   Description: ${description}`);
    console.log(`   Parameters: ${JSON.stringify(params, null, 2)}`);

    // Build query string
    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });

    const url = `${BASE_URL}${endpointPath}?${queryParams.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    // Validate result
    if (
      result &&
      (result.scripture ||
        result.notes ||
        result.questions ||
        result.words ||
        result.languages ||
        result.subjects ||
        result.resources ||
        Array.isArray(result) ||
        typeof result === "object")
    ) {
      const resultSize = JSON.stringify(result).length;
      results.tools[toolName] = { status: "pass", result };
      results.passed++;
      logTest(toolName, "pass", `Got response (${resultSize} chars)`);
      return true;
    } else {
      results.tools[toolName] = {
        status: "fail",
        error: "Invalid response format",
      };
      results.failed++;
      logTest(toolName, "fail", "Invalid response format");
      return false;
    }
  } catch (error) {
    results.tools[toolName] = { status: "fail", error: error.message };
    results.failed++;
    logTest(toolName, "fail", error.message);
    return false;
  }
}

// Send MCP request via HTTP (for prompts)
async function sendMCPRequest(method, params = {}) {
  const request = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };

  try {
    const response = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || "MCP error");
    }

    return data.result;
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Test a prompt
async function testPrompt(promptName, params, description) {
  results.total++;
  try {
    log(`\n🎯 Testing Prompt: ${promptName}`, "cyan");
    console.log(`   Description: ${description}`);
    console.log(`   Parameters: ${JSON.stringify(params, null, 2)}`);

    const result = await sendMCPRequest("prompts/get", {
      name: promptName,
      arguments: params,
    });

    // Validate result
    if (result && result.messages && Array.isArray(result.messages)) {
      results.prompts[promptName] = { status: "pass", result };
      results.passed++;
      logTest(
        promptName,
        "pass",
        `Got prompt template with ${result.messages.length} messages`,
      );
      return true;
    } else {
      results.prompts[promptName] = {
        status: "fail",
        error: "Invalid response format",
      };
      results.failed++;
      logTest(promptName, "fail", "Invalid response format");
      return false;
    }
  } catch (error) {
    results.prompts[promptName] = { status: "fail", error: error.message };
    results.failed++;
    logTest(promptName, "fail", error.message);
    return false;
  }
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

// Main test function
async function runAllTests() {
  logSection("🧪 COMPREHENSIVE MCP TOOLS & PROMPTS TEST");
  console.log(`Testing with:`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Organization: ${TEST_CONFIG.organization}`);
  console.log(`  Language: ${TEST_CONFIG.language}`);
  console.log(`  Reference: ${TEST_CONFIG.reference}`);
  console.log(`  Term: ${TEST_CONFIG.term}`);
  console.log(`\n  Note: Tools tested via REST API, prompts via MCP endpoint`);

  // Check if server is running
  log("\n🔍 Checking if server is running...", "blue");
  const serverRunning = await checkServer();
  if (!serverRunning) {
    log("\n❌ Server is not running!", "red");
    console.log("\nPlease start the server first:");
    console.log("  cd ui && npm run dev");
    console.log("\nOr set TEST_BASE_URL environment variable:");
    console.log(
      "  TEST_BASE_URL=http://your-server:port node scripts/test-all-tools-and-prompts.js",
    );
    process.exit(1);
  }
  log("✅ Server is running", "green");

  try {
    // Test all tools via REST API
    logSection("📋 TESTING TOOLS (9 tools via REST API)");

    // 1. fetch_scripture
    await testToolRest(
      "fetch_scripture",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch Bible scripture text for a specific reference",
      "/api/fetch-scripture",
    );

    // 2. fetch_translation_notes
    await testToolRest(
      "fetch_translation_notes",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch translation notes for a specific Bible reference",
      "/api/fetch-translation-notes",
    );

    // 3. fetch_translation_questions
    await testToolRest(
      "fetch_translation_questions",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch translation questions for a specific Bible reference",
      "/api/fetch-translation-questions",
    );

    // 4. fetch_translation_word_links
    await testToolRest(
      "fetch_translation_word_links",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch translation word links (TWL) for a specific Bible reference",
      "/api/fetch-translation-word-links",
    );

    // 5. fetch_translation_word
    await testToolRest(
      "fetch_translation_word",
      {
        term: TEST_CONFIG.term,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch translation word articles for biblical terms",
      "/api/fetch-translation-word",
    );

    // 6. fetch_translation_academy
    await testToolRest(
      "fetch_translation_academy",
      {
        moduleId: TEST_CONFIG.moduleId,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "Fetch translation academy (tA) modules and training content",
      "/api/fetch-translation-academy",
    );

    // 7. list_languages
    await testToolRest(
      "list_languages",
      {
        organization: TEST_CONFIG.organization,
        stage: "prod",
      },
      "List all available languages from the Door43 catalog",
      "/api/list-languages",
    );

    // 8. list_subjects
    await testToolRest(
      "list_subjects",
      {
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
        stage: "prod",
      },
      "List all available resource subjects (resource types)",
      "/api/list-subjects",
    );

    // 9. list_resources_for_language
    await testToolRest(
      "list_resources_for_language",
      {
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
        stage: "prod",
        topic: "tc-ready",
      },
      "List all available resources for a specific language",
      "/api/list-resources-for-language",
    );

    // Test all prompts via MCP endpoint
    logSection("🎯 TESTING PROMPTS (5 prompts via MCP endpoint)");

    // 1. translation-helps-for-passage
    await testPrompt(
      "translation-helps-for-passage",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
      },
      "Get comprehensive translation help for a Bible passage",
    );

    // 2. get-translation-words-for-passage
    await testPrompt(
      "get-translation-words-for-passage",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
      },
      "Get all translation word definitions for a passage",
    );

    // 3. get-translation-academy-for-passage
    await testPrompt(
      "get-translation-academy-for-passage",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
      },
      "Get Translation Academy training articles for a passage",
    );

    // 4. discover-resources-for-language
    await testPrompt(
      "discover-resources-for-language",
      {
        language: TEST_CONFIG.testLanguage,
        organization: TEST_CONFIG.organization,
      },
      "Discover what translation resources are available for a specific language",
    );

    // 5. discover-languages-for-subject
    await testPrompt(
      "discover-languages-for-subject",
      {
        subject: TEST_CONFIG.testSubject,
        organization: TEST_CONFIG.organization,
      },
      "Discover which languages have a specific resource type available",
    );

    // Summary
    logSection("📊 TEST SUMMARY");
    console.log(`\nTotal Tests: ${results.total}`);
    log(`Passed: ${results.passed}`, "green");
    log(`Failed: ${results.failed}`, results.failed > 0 ? "red" : "green");
    console.log(
      `\nSuccess Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`,
    );

    if (results.failed > 0) {
      console.log("\n❌ Failed Tests:");
      Object.entries({ ...results.tools, ...results.prompts }).forEach(
        ([name, result]) => {
          if (result.status === "fail") {
            log(`  - ${name}: ${result.error}`, "red");
          }
        },
      );
    }

    console.log("\n" + "=".repeat(80));
    if (results.failed === 0) {
      log("✅ ALL TESTS PASSED!", "green");
    } else {
      log(`⚠️  ${results.failed} TEST(S) FAILED`, "yellow");
      process.exit(1);
    }
  } catch (error) {
    log(`\n❌ Test suite error: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runAllTests()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
