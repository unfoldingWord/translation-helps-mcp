/**
 * Test the new focused default subject list (7 subjects)
 * Run with: node scripts/test-new-defaults.js
 */

const NEW_DEFAULT_SUBJECTS = [
  "Bible",
  "Aligned Bible",
  "Translation Words",
  "Translation Academy",
  "TSV Translation Notes",
  "TSV Translation Questions",
  "TSV Translation Words Links",
];

async function testNewDefaults() {
  console.log("=".repeat(80));
  console.log("🧪 Testing NEW Default Subjects List (7 subjects)");
  console.log("=".repeat(80));
  console.log("\nDefault subjects:");
  NEW_DEFAULT_SUBJECTS.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log();

  const allResources = [];

  for (const subject of NEW_DEFAULT_SUBJECTS) {
    console.log(`\n🔍 Searching: ${subject}`);

    const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
    searchUrl.searchParams.set("subject", subject);
    searchUrl.searchParams.set("stage", "prod");
    searchUrl.searchParams.set("limit", "100");
    // No owner = all organizations

    try {
      const response = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.log(`  ❌ Failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const items = data.data || [];
      console.log(`  ✅ Found ${items.length} resources`);

      for (const item of items) {
        const repoName = item.name || "";
        const langMatch = repoName.match(/^([^_]+)_/);
        const language = langMatch ? langMatch[1] : "";

        if (language) {
          allResources.push({
            name: item.name,
            subject: subject,
            language: language,
            organization: item.owner || "unknown",
          });
        }
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  // Organize by language
  const byLanguage = {};
  for (const res of allResources) {
    if (!byLanguage[res.language]) {
      byLanguage[res.language] = {
        count: 0,
        orgs: new Set(),
        subjects: new Set(),
      };
    }
    byLanguage[res.language].count++;
    byLanguage[res.language].orgs.add(res.organization);
    byLanguage[res.language].subjects.add(res.subject);
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 RESULTS:");
  console.log("=".repeat(80));
  console.log(`Total resources found: ${allResources.length}`);
  console.log(`Languages found: ${Object.keys(byLanguage).length}`);
  console.log();

  // Show top 10 languages by resource count
  const sortedLanguages = Object.entries(byLanguage)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10);

  console.log("Top 10 languages:");
  console.log("─".repeat(80));
  sortedLanguages.forEach(([lang, data]) => {
    console.log(
      `${lang.toUpperCase()}: ${data.count} resources from ${data.orgs.size} orgs`,
    );
    console.log(`  Subjects: ${Array.from(data.subjects).join(", ")}`);
  });

  // Show organization breakdown
  const byOrg = {};
  for (const res of allResources) {
    byOrg[res.organization] = (byOrg[res.organization] || 0) + 1;
  }

  console.log("\n" + "=".repeat(80));
  console.log("🏢 Organizations:");
  console.log("─".repeat(80));
  Object.entries(byOrg)
    .sort(([, a], [, b]) => b - a)
    .forEach(([org, count]) => {
      console.log(`  ${org}: ${count} resources`);
    });

  console.log("\n" + "=".repeat(80));
  console.log("✅ Default subjects now focused on core translation resources!");
  console.log("=".repeat(80));
}

testNewDefaults()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
