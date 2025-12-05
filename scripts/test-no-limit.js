/**
 * Test list_resources_for_language WITHOUT limit parameter
 * Should fetch ALL available resources
 * Run with: node scripts/test-no-limit.js
 */

async function testNoLimit() {
  console.log("=".repeat(80));
  console.log("🧪 Testing list_resources_for_language WITHOUT limit");
  console.log("=".repeat(80));

  const testCases = [
    {
      name: "English - NO limit (should get ALL resources)",
      language: "en",
      limit: undefined, // No limit!
    },
    {
      name: "English - WITH limit of 10 (for comparison)",
      language: "en",
      limit: 10,
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📋 ${testCase.name}`);
    console.log("=".repeat(80));

    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("lang", testCase.language);
    searchUrl.searchParams.set("stage", "prod");

    // Only set limit if specified
    if (testCase.limit) {
      searchUrl.searchParams.set("limit", testCase.limit.toString());
      console.log(`🔢 Limit: ${testCase.limit}`);
    } else {
      // Use a very high limit to get all results
      searchUrl.searchParams.set("limit", "5000");
      console.log(`🔢 Limit: 5000 (effectively unlimited)`);
    }
    // No owner parameter = search all organizations

    try {
      console.log(`\n📡 URL: ${searchUrl.toString()}\n`);

      const startTime = Date.now();
      const response = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      const duration = Date.now() - startTime;

      console.log(`⏱️  Response in ${duration}ms`);
      console.log(`📊 Status: ${response.status}`);

      if (!response.ok) {
        console.log(`❌ Failed: ${response.statusText}\n`);
        continue;
      }

      const data = await response.json();
      const items = data.data || [];

      console.log(`✅ Found ${items.length} resources\n`);

      // Organize by organization
      const byOrg = {};
      for (const item of items) {
        const org = item.owner || "unknown";
        if (!byOrg[org]) {
          byOrg[org] = { count: 0, subjects: new Set() };
        }
        byOrg[org].count++;
        byOrg[org].subjects.add(item.subject || "Unknown");
      }

      const organizations = Object.keys(byOrg).sort();
      console.log(`🏢 Organizations found: ${organizations.length}`);
      console.log(`${"─".repeat(80)}\n`);

      for (const org of organizations) {
        const orgData = byOrg[org];
        console.log(`**${org}**: ${orgData.count} resources`);
        console.log(
          `   Subjects: ${Array.from(orgData.subjects).slice(0, 5).join(", ")}${orgData.subjects.size > 5 ? "..." : ""}`,
        );
      }

      console.log(`\n${"─".repeat(80)}`);
      console.log(`📊 Summary:`);
      console.log(`   Total resources: ${items.length}`);
      console.log(`   Total organizations: ${organizations.length}`);
      console.log(
        `   Unique subjects: ${new Set([...Object.values(byOrg).flatMap((o) => [...o.subjects])]).size}`,
      );
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("✅ Test complete!");
  console.log("=".repeat(80));

  console.log("\n💡 Key Point:");
  console.log(
    "  When limit is NOT specified, we use a high limit (5000) to fetch ALL available resources!",
  );
  console.log(
    "  This gives users complete discovery power without worrying about pagination.",
  );
}

testNoLimit()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
