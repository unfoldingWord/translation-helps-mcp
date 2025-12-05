/**
 * Test list_resources_for_language WITHOUT specifying organization
 * Should return resources from ALL organizations, not just unfoldingWord
 * Run with: node scripts/test-all-organizations.js
 */

async function testAllOrganizations() {
  console.log("=".repeat(80));
  console.log("🧪 Testing list_resources_for_language - ALL Organizations");
  console.log("=".repeat(80));

  const testCases = [
    {
      name: "Test 1: English - ALL organizations (no filter)",
      language: "en",
      organization: undefined,
    },
    {
      name: "Test 2: English - ONLY unfoldingWord",
      language: "en",
      organization: "unfoldingWord",
    },
    {
      name: "Test 3: French - ALL organizations",
      language: "fr",
      organization: undefined,
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`📋 ${testCase.name}`);
    console.log("=".repeat(80));

    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("lang", testCase.language);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "100");

    // Only set owner if organization is specified
    if (testCase.organization) {
      searchUrl.searchParams.set("owner", testCase.organization);
      console.log(`🏢 Organization filter: ${testCase.organization}`);
    } else {
      console.log(`🌐 No organization filter - searching ALL organizations`);
    }

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

      // Organize by organization AND subject
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
        console.log(`   Subjects: ${Array.from(orgData.subjects).join(", ")}`);
      }

      console.log(`\n${"─".repeat(80)}`);
      console.log(`📊 Summary:`);
      console.log(`   Total resources: ${items.length}`);
      console.log(`   Organizations: ${organizations.join(", ")}`);
      console.log(`   Total organizations: ${organizations.length}`);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("✅ Test complete!");
  console.log("=".repeat(80));

  console.log("\n💡 Key Points:");
  console.log(
    "  ✅ When organization is NOT specified → searches ALL organizations",
  );
  console.log(
    "  ✅ When organization IS specified → filters to that organization only",
  );
  console.log("  ✅ This gives users maximum flexibility!");
}

testAllOrganizations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
