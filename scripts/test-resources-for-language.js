/**
 * Test the new list_resources_for_language workflow
 * Run with: node scripts/test-resources-for-language.js
 */

async function testWorkflow() {
  console.log("=".repeat(80));
  console.log("🧪 Testing the new list_resources_for_language workflow");
  console.log("=".repeat(80));

  // Test different languages
  const testLanguages = ["en", "fr", "es", "es-419"];

  for (const language of testLanguages) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🌍 Testing language: ${language.toUpperCase()}`);
    console.log("=".repeat(80));

    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("lang", language);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "100");
    searchUrl.searchParams.set("owner", "unfoldingWord");

    try {
      console.log(`📡 Fetching: ${searchUrl.toString()}\n`);
      const startTime = Date.now();
      const response = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });
      const duration = Date.now() - startTime;

      console.log(`⏱️  Response in ${duration}ms`);
      console.log(`📊 Status: ${response.status}`);

      if (!response.ok) {
        console.log(`❌ Failed: ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const items = data.data || [];

      console.log(`✅ Found ${items.length} resources\n`);

      // Organize by subject
      const bySubject = {};
      for (const item of items) {
        const subject = item.subject || "Unknown";
        if (!bySubject[subject]) {
          bySubject[subject] = [];
        }
        bySubject[subject].push({
          name: item.name,
          organization: item.owner || "unknown",
          version: item.release?.tag_name || item.default_branch || "master",
        });
      }

      const subjects = Object.keys(bySubject).sort();
      console.log(`📚 Subjects found: ${subjects.length}`);
      console.log(`${"─".repeat(80)}\n`);

      for (const subject of subjects) {
        const resources = bySubject[subject];
        console.log(
          `**${subject}** (${resources.length} resource${resources.length !== 1 ? "s" : ""})`,
        );
        resources.slice(0, 3).forEach((res) => {
          console.log(`  - ${res.name} (${res.organization}) ${res.version}`);
        });
        if (resources.length > 3) {
          console.log(`  ... and ${resources.length - 3} more`);
        }
        console.log();
      }

      // Summary
      console.log(`${"─".repeat(80)}`);
      console.log(`📊 Summary for ${language.toUpperCase()}:`);
      console.log(`   Total resources: ${items.length}`);
      console.log(`   Subjects: ${subjects.join(", ")}`);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("✅ Test complete!");
  console.log("=".repeat(80));

  console.log("\n📋 Recommended Workflow:");
  console.log("  1️⃣  Call list_languages to discover available languages");
  console.log("  2️⃣  Choose a language from the list");
  console.log("  3️⃣  Call list_resources_for_language with that language");
  console.log("  4️⃣  See what resource types (subjects) are available");
  console.log("  5️⃣  Use specific fetch tools to get the actual content");
  console.log(
    "\n💡 This is much more efficient than list_resources_by_language!",
  );
}

testWorkflow()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
