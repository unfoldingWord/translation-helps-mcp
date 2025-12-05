/**
 * Test what parameters the Door43 catalog search endpoint supports
 * Run with: node scripts/test-catalog-params.js
 */

async function testCatalogParams() {
  console.log("=".repeat(80));
  console.log("🔍 Testing Door43 Catalog Search Endpoint Parameters");
  console.log("=".repeat(80));

  const baseUrl = "https://git.door43.org/api/v1/catalog/search";

  // Test different parameter combinations
  const tests = [
    {
      name: "1. Standard search with subject",
      params: { subject: "Translation Words", limit: "5" },
    },
    {
      name: "2. With topic parameter",
      params: { topic: "Translation Words", limit: "5" },
    },
    {
      name: "3. With tag parameter",
      params: { tag: "translation", limit: "5" },
    },
    {
      name: "4. With resource parameter",
      params: { resource: "tw", limit: "5" },
    },
    {
      name: "5. With type parameter",
      params: { type: "helps", limit: "5" },
    },
    {
      name: "6. All known valid parameters",
      params: {
        lang: "en",
        owner: "unfoldingWord",
        subject: "Translation Words",
        stage: "prod",
        limit: "5",
      },
    },
    {
      name: "7. Search with q (query) parameter",
      params: { q: "translation words", limit: "5" },
    },
  ];

  for (const test of tests) {
    console.log(`\n${test.name}`);
    console.log("─".repeat(80));

    const url = new URL(baseUrl);
    Object.entries(test.params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    console.log(`URL: ${url.toString()}`);

    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      console.log(`Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const data = await response.json();
        const items = data.data || [];
        console.log(`✅ Success: Found ${items.length} items`);

        if (items.length > 0) {
          console.log(`First result: ${items[0].name || "unnamed"}`);
          console.log(`Keys in response:`, Object.keys(data).join(", "));
        } else {
          console.log(`⚠️  No results returned`);
        }
      } else {
        const errorText = await response.text();
        console.log(`❌ Failed: ${errorText.substring(0, 200)}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("📋 DOCUMENTED CATALOG SEARCH PARAMETERS:");
  console.log("=".repeat(80));
  console.log("\nBased on testing and codebase usage:");
  console.log("  ✅ subject    - Filter by resource subject/type");
  console.log("  ✅ lang       - Filter by language code");
  console.log("  ✅ owner      - Filter by organization");
  console.log("  ✅ stage      - Filter by stage (prod/preprod/draft)");
  console.log("  ✅ limit      - Maximum results to return");
  console.log("  ❓ topic      - Need to test if supported");
  console.log("  ❓ q          - Need to test if query search is supported");
  console.log("  ❓ tag        - Need to test if tag filtering is supported");

  console.log(
    "\n💡 Check Door43 API docs at: https://git.door43.org/api/swagger",
  );
}

testCatalogParams()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
