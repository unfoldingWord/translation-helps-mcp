/**
 * Test es-419 specifically to find all organizations with Spanish (Latin America) resources
 * Run with: node scripts/test-es-419.js
 */

async function testSpanishLatinAmerica() {
  console.log("=".repeat(80));
  console.log("🧪 Testing es-419 (Spanish Latin America) - ALL Organizations");
  console.log("=".repeat(80));

  const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
  searchUrl.searchParams.set("lang", "es-419");
  searchUrl.searchParams.set("stage", "prod");
  searchUrl.searchParams.set("limit", "200"); // Increase limit to get more results
  // No owner parameter = search all organizations

  try {
    console.log(`\n📡 URL: ${searchUrl.toString()}\n`);

    const startTime = Date.now();
    const response = await fetch(searchUrl.toString(), {
      headers: { Accept: "application/json" },
    });
    const duration = Date.now() - startTime;

    console.log(`⏱️  Response in ${duration}ms`);
    console.log(`📊 Status: ${response.status}\n`);

    if (!response.ok) {
      console.log(`❌ Failed: ${response.statusText}`);
      return;
    }

    const data = await response.json();
    const items = data.data || [];

    console.log(`✅ Found ${items.length} resources for es-419\n`);

    if (items.length === 0) {
      console.log("❌ No resources found!");
      console.log("\n💡 Trying alternative approaches...\n");

      // Try without the hyphen
      const searchUrl2 = new URL(
        "https://git.door43.org/api/v1/catalog/search",
      );
      searchUrl2.searchParams.set("lang", "es");
      searchUrl2.searchParams.set("stage", "prod");
      searchUrl2.searchParams.set("limit", "200");

      console.log(`📡 Trying with 'es' instead: ${searchUrl2.toString()}\n`);
      const response2 = await fetch(searchUrl2.toString(), {
        headers: { Accept: "application/json" },
      });

      if (response2.ok) {
        const data2 = await response2.json();
        const items2 = data2.data || [];
        console.log(`✅ Found ${items2.length} resources for 'es'\n`);

        if (items2.length > 0) {
          // Check if any have es-419 in the name
          const es419Items = items2.filter(
            (item) =>
              item.name?.includes("es-419") ||
              item.language?.includes("es-419"),
          );
          console.log(
            `📋 Resources with 'es-419' in name: ${es419Items.length}`,
          );

          // Show all organizations for 'es'
          const byOrg = {};
          for (const item of items2) {
            const org = item.owner || "unknown";
            if (!byOrg[org]) {
              byOrg[org] = [];
            }
            byOrg[org].push({
              name: item.name,
              subject: item.subject,
              language: item.language,
            });
          }

          console.log(`\n🏢 Organizations with 'es' resources:\n`);
          for (const org of Object.keys(byOrg).sort()) {
            console.log(`**${org}**: ${byOrg[org].length} resources`);
            byOrg[org].slice(0, 3).forEach((res) => {
              console.log(`  - ${res.name} (${res.subject})`);
            });
            if (byOrg[org].length > 3) {
              console.log(`  ... and ${byOrg[org].length - 3} more`);
            }
            console.log();
          }
        }
      }

      return;
    }

    // Organize by organization AND subject
    const byOrg = {};
    for (const item of items) {
      const org = item.owner || "unknown";
      if (!byOrg[org]) {
        byOrg[org] = { count: 0, subjects: new Set(), resources: [] };
      }
      byOrg[org].count++;
      byOrg[org].subjects.add(item.subject || "Unknown");
      byOrg[org].resources.push({
        name: item.name,
        subject: item.subject,
        version: item.release?.tag_name || item.default_branch,
      });
    }

    const organizations = Object.keys(byOrg).sort();
    console.log(`🏢 Organizations found: ${organizations.length}`);
    console.log(`${"─".repeat(80)}\n`);

    for (const org of organizations) {
      const orgData = byOrg[org];
      console.log(`**${org}**: ${orgData.count} resources`);
      console.log(`   Subjects: ${Array.from(orgData.subjects).join(", ")}`);
      console.log(`   Resources:`);
      orgData.resources.slice(0, 5).forEach((res) => {
        console.log(`     - ${res.name} (${res.subject}) ${res.version || ""}`);
      });
      if (orgData.resources.length > 5) {
        console.log(`     ... and ${orgData.resources.length - 5} more`);
      }
      console.log();
    }

    console.log(`${"─".repeat(80)}`);
    console.log(`📊 Summary:`);
    console.log(`   Total resources: ${items.length}`);
    console.log(`   Organizations: ${organizations.join(", ")}`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("✅ Test complete!");
  console.log("=".repeat(80));
}

testSpanishLatinAmerica()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
