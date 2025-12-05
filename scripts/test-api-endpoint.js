/**
 * Test the /api/list-resources-by-language endpoint directly
 * Run with: node scripts/test-api-endpoint.js
 * Make sure the dev server is running on localhost:5173
 */

async function testEndpoint() {
  console.log("=".repeat(80));
  console.log("🧪 Testing /api/list-resources-by-language endpoint");
  console.log("=".repeat(80));

  const baseUrl = "http://localhost:5173";

  const testCases = [
    {
      name: "Test 1: Basic request with defaults",
      url: `${baseUrl}/api/list-resources-by-language?organization=unfoldingWord&stage=prod&limit=20`,
    },
    {
      name: "Test 2: With specific subjects",
      url: `${baseUrl}/api/list-resources-by-language?subjects=Translation Words,Bible&organization=unfoldingWord&stage=prod&limit=30`,
    },
    {
      name: "Test 3: Format=json explicitly",
      url: `${baseUrl}/api/list-resources-by-language?organization=unfoldingWord&stage=prod&limit=15&format=json`,
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log(`URL: ${testCase.url}`);
    console.log("-".repeat(80));

    try {
      const startTime = Date.now();
      const response = await fetch(testCase.url);
      const duration = Date.now() - startTime;

      console.log(`\n⏱️  Response time: ${duration}ms`);
      console.log(`📊 Status: ${response.status} ${response.statusText}`);
      console.log(`📝 Content-Type: ${response.headers.get("content-type")}`);

      // Check for diagnostic headers
      const cacheStatus = response.headers.get("X-Cache-Status");
      const responseTime = response.headers.get("X-Response-Time");
      const traceId = response.headers.get("X-Trace-Id");

      if (cacheStatus) console.log(`💾 Cache Status: ${cacheStatus}`);
      if (responseTime)
        console.log(`⏱️  Server Response Time: ${responseTime}`);
      if (traceId) console.log(`🔍 Trace ID: ${traceId}`);

      if (response.ok) {
        const text = await response.text();

        try {
          const data = JSON.parse(text);

          if (data.error) {
            console.log(`\n❌ API returned error:`);
            console.log(`   Error: ${data.error}`);
            console.log(`   Tool: ${data.tool}`);
            console.log(`   Timestamp: ${data.timestamp}`);
            console.log(`   Response Time: ${data.responseTime}ms`);
            console.log(`   Args:`, JSON.stringify(data.args, null, 2));
          } else if (data.languages) {
            console.log(`\n✅ Success!`);
            console.log(`   Languages: ${data.languages.length}`);
            console.log(
              `   Total Resources: ${data.metadata?.totalResources || "N/A"}`,
            );
            console.log(
              `   Service Metadata:`,
              data.metadata?.serviceMetadata ? "Present" : "None",
            );

            console.log(`\n📋 Languages:`);
            data.languages.slice(0, 5).forEach((lang) => {
              console.log(
                `   - ${lang.language.toUpperCase()}: ${lang.resourceCount} resources`,
              );
              console.log(`     Subjects: ${lang.subjects.join(", ")}`);
            });

            if (data.languages.length > 5) {
              console.log(
                `   ... and ${data.languages.length - 5} more languages`,
              );
            }
          } else {
            console.log(`\n⚠️  Unknown response structure:`);
            console.log(`   Keys: ${Object.keys(data).join(", ")}`);
            console.log(`   Data (first 500 chars): ${text.substring(0, 500)}`);
          }
        } catch (parseError) {
          console.log(`\n⚠️  Response is not JSON:`);
          console.log(`   ${text.substring(0, 500)}`);
        }
      } else {
        console.log(`\n❌ HTTP Error: ${response.status}`);
        const errorText = await response.text();
        console.log(`   ${errorText.substring(0, 500)}`);
      }
    } catch (error) {
      console.error(`\n❌ Request failed:`);
      console.error(`   ${error.message}`);
      if (error.code === "ECONNREFUSED") {
        console.error(
          `\n💡 Make sure the dev server is running on localhost:5173`,
        );
        console.error(`   Run: npm run dev (in the ui directory)`);
      }
    }

    console.log("\n" + "=".repeat(80));
  }

  console.log("\n✅ All endpoint tests complete!");
}

testEndpoint()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
