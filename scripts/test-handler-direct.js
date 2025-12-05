/**
 * Test the actual handleListResourcesByLanguage function directly
 * Run with: node scripts/test-handler-direct.js
 */

// Mock the logger to avoid import issues
global.logger = {
  info: (...args) => console.log("[INFO]", ...args),
  debug: (...args) => console.log("[DEBUG]", ...args),
  warn: (...args) => console.warn("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

// Import the handler
import { handleListResourcesByLanguage } from "../src/tools/listResourcesByLanguage.js";

async function testHandler() {
  console.log("=".repeat(80));
  console.log("🧪 Testing handleListResourcesByLanguage directly");
  console.log("=".repeat(80));

  const testCases = [
    {
      name: "Test 1: Empty subjects (should use defaults)",
      args: {
        subjects: "",
        organization: "unfoldingWord",
        stage: "prod",
        limit: 10,
      },
    },
    {
      name: "Test 2: Specific subjects",
      args: {
        subjects: "Translation Words,Translation Academy",
        organization: "unfoldingWord",
        stage: "prod",
        limit: 20,
      },
    },
    {
      name: "Test 3: Array of subjects",
      args: {
        subjects: ["Bible", "Translation Words"],
        organization: "unfoldingWord",
        stage: "prod",
        limit: 15,
      },
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log("Arguments:", JSON.stringify(testCase.args, null, 2));
    console.log("-".repeat(80));

    try {
      const result = await handleListResourcesByLanguage(testCase.args);

      console.log("\n✅ Handler returned successfully!");
      console.log("Response structure:");
      console.log("  - isError:", result.isError);
      console.log("  - content length:", result.content?.length);
      console.log("  - content[0].type:", result.content?.[0]?.type);

      if (result.content?.[0]?.text) {
        const textLength = result.content[0].text.length;
        console.log("  - content[0].text length:", textLength);

        // Try to parse if it's JSON
        try {
          const data = JSON.parse(result.content[0].text);
          console.log("\n📊 Parsed Data:");

          if (data.error) {
            console.log("  ❌ ERROR:", data.error);
            console.log("  Tool:", data.tool);
            console.log("  Args:", JSON.stringify(data.args, null, 2));
          } else if (data.languages) {
            console.log("  Languages found:", data.languages.length);
            console.log(
              "  Total resources:",
              data.metadata?.totalResources || 0,
            );
            console.log("\n  Sample languages:");
            data.languages.slice(0, 3).forEach((lang) => {
              console.log(
                `    - ${lang.language}: ${lang.resourceCount} resources, subjects: ${lang.subjects.join(", ")}`,
              );
            });
          } else {
            console.log("  Unknown data structure:", Object.keys(data));
          }
        } catch (parseError) {
          console.log("  (Not JSON, showing first 200 chars)");
          console.log("  " + result.content[0].text.substring(0, 200));
        }
      }
    } catch (error) {
      console.error("\n❌ Handler threw an error:");
      console.error("  Message:", error.message);
      console.error("  Stack:", error.stack);
    }

    console.log("\n" + "=".repeat(80));
  }

  console.log("\n✅ All tests complete!");
}

testHandler()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
