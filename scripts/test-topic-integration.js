/**
 * Test topic parameter integration with our tools
 * Run with: node scripts/test-topic-integration.js
 */

const DEFAULT_SUBJECTS = [
  "Bible",
  "Aligned Bible",
  "Translation Words",
  "Translation Academy",
  "TSV Translation Notes",
  "TSV Translation Questions",
  "TSV Translation Words Links",
];

async function testTopicIntegration() {
  console.log("=".repeat(80));
  console.log("🏷️  Testing Topic Parameter Integration");
  console.log("=".repeat(80));

  // Test Case 1: list-resources-by-language WITH topic filter
  console.log("\n📋 TEST 1: list-resources-by-language WITH topic=tc-ready");
  console.log("─".repeat(80));

  let allResourcesWithTopic = [];
  for (const subject of DEFAULT_SUBJECTS) {
    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("subject", subject);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "100");
    searchUrl.searchParams.set("topic", "tc-ready");

    try {
      const response = await fetch(searchUrl.toString());
      if (response.ok) {
        const data = await response.json();
        const items = data.data || [];

        for (const item of items) {
          const langMatch = item.name?.match(/^([^_]+)_/);
          if (langMatch) {
            allResourcesWithTopic.push({
              name: item.name,
              subject: subject,
              language: langMatch[1],
              organization: item.owner,
              topics: item.repo?.topics || [],
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  const langsByTopic = {};
  allResourcesWithTopic.forEach((r) => {
    if (!langsByTopic[r.language]) {
      langsByTopic[r.language] = {
        count: 0,
        subjects: new Set(),
        orgs: new Set(),
      };
    }
    langsByTopic[r.language].count++;
    langsByTopic[r.language].subjects.add(r.subject);
    langsByTopic[r.language].orgs.add(r.organization);
  });

  console.log(`✅ Found ${allResourcesWithTopic.length} tc-ready resources`);
  console.log(`   Languages: ${Object.keys(langsByTopic).length}`);
  console.log(`   Top languages with tc-ready resources:`);
  Object.entries(langsByTopic)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .forEach(([lang, data]) => {
      console.log(
        `     ${lang}: ${data.count} resources from ${data.orgs.size} orgs`,
      );
    });

  // Test Case 2: list-resources-by-language WITHOUT topic filter
  console.log("\n📋 TEST 2: list-resources-by-language WITHOUT topic filter");
  console.log("─".repeat(80));

  let allResourcesNoTopic = [];
  for (const subject of DEFAULT_SUBJECTS.slice(0, 3)) {
    // Just test first 3 for speed
    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("subject", subject);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "100");
    // No topic parameter

    try {
      const response = await fetch(searchUrl.toString());
      if (response.ok) {
        const data = await response.json();
        const items = data.data || [];

        for (const item of items) {
          const langMatch = item.name?.match(/^([^_]+)_/);
          if (langMatch) {
            allResourcesNoTopic.push({
              name: item.name,
              language: langMatch[1],
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }
  }

  console.log(
    `✅ Found ${allResourcesNoTopic.length} total resources (first 3 subjects)`,
  );
  console.log(`   (More resources when not filtering by topic)`);

  // Test Case 3: list-resources-for-language WITH topic
  console.log("\n📋 TEST 3: list-resources-for-language WITH topic=tc-ready");
  console.log("─".repeat(80));

  const testLanguages = ["en", "ar", "es-419"];

  for (const lang of testLanguages) {
    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("lang", lang);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "200");
    searchUrl.searchParams.set("topic", "tc-ready");

    try {
      const response = await fetch(searchUrl.toString());
      if (response.ok) {
        const data = await response.json();
        const items = data.data || [];

        const bySubject = {};
        items.forEach((item) => {
          const subject = item.subject || "Unknown";
          bySubject[subject] = (bySubject[subject] || 0) + 1;
        });

        console.log(
          `\n  ${lang.toUpperCase()}: ${items.length} tc-ready resources`,
        );
        console.log(`  Subjects: ${Object.keys(bySubject).join(", ")}`);
      }
    } catch (error) {
      console.error(`  Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Topic Parameter Integration Complete!");
  console.log("=".repeat(80));
  console.log("\n💡 Usage:");
  console.log("  • Add topic=tc-ready to get only production-ready resources");
  console.log("  • Omit topic to get all resources regardless of readiness");
  console.log("  • Useful for filtering quality-controlled content");
}

testTopicIntegration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
