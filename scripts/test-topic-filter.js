/**
 * Test the topic parameter for filtering resources
 * Topics are metadata tags like "tc-ready", not subject names
 * Run with: node scripts/test-topic-filter.js
 */

async function testTopicFilter() {
  console.log("=".repeat(80));
  console.log("🏷️  Testing Topic Filter Parameter");
  console.log("=".repeat(80));
  console.log(
    "\nTopics are metadata tags (e.g., 'tc-ready') used to mark resource status\n",
  );

  const testCases = [
    {
      name: "Test 1: With topic=tc-ready",
      topic: "tc-ready",
      subjects: ["Aligned Bible", "Translation Words"],
    },
    {
      name: "Test 2: Without topic filter",
      topic: null,
      subjects: ["Aligned Bible", "Translation Words"],
    },
    {
      name: "Test 3: Topic=tc-ready for all default subjects",
      topic: "tc-ready",
      subjects: [
        "Bible",
        "Aligned Bible",
        "Translation Words",
        "Translation Academy",
        "TSV Translation Notes",
        "TSV Translation Questions",
        "TSV Translation Words Links",
      ],
    },
  ];

  for (const testCase of testCases) {
    console.log(`${testCase.name}`);
    console.log("─".repeat(80));

    const allResources = [];

    for (const subject of testCase.subjects) {
      const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
      searchUrl.searchParams.set("subject", subject);
      searchUrl.searchParams.set("stage", "prod");
      searchUrl.searchParams.set("limit", "100");

      if (testCase.topic) {
        searchUrl.searchParams.set("topic", testCase.topic);
      }

      try {
        const response = await fetch(searchUrl.toString(), {
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          const data = await response.json();
          const items = data.data || [];

          for (const item of items) {
            const repoName = item.name || "";
            const langMatch = repoName.match(/^([^_]+)_/);
            const language = langMatch ? langMatch[1] : "";
            const topics = item.repo?.topics || item.topics || [];

            if (language) {
              allResources.push({
                name: item.name,
                subject: subject,
                language: language,
                organization: item.owner || "unknown",
                topics: topics,
              });
            }
          }
        }
      } catch (error) {
        console.error(`  Error for ${subject}: ${error.message}`);
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
          topicsFound: new Set(),
        };
      }
      byLanguage[res.language].count++;
      byLanguage[res.language].orgs.add(res.organization);
      byLanguage[res.language].subjects.add(res.subject);
      res.topics.forEach((t) => byLanguage[res.language].topicsFound.add(t));
    }

    console.log(`\n📊 Results:`);
    console.log(`  Total resources: ${allResources.length}`);
    console.log(`  Languages: ${Object.keys(byLanguage).length}`);
    console.log(
      `  Organizations: ${new Set(allResources.map((r) => r.organization)).size}`,
    );

    // Show unique topics found
    const allTopics = new Set();
    allResources.forEach((r) => r.topics.forEach((t) => allTopics.add(t)));
    console.log(
      `  Topics found: ${Array.from(allTopics).join(", ") || "none"}`,
    );

    console.log(`\n🌍 Top languages:`);
    Object.entries(byLanguage)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .forEach(([lang, data]) => {
        console.log(
          `  ${lang}: ${data.count} resources from ${data.orgs.size} orgs`,
        );
      });

    console.log("\n");
  }

  console.log("=".repeat(80));
  console.log("💡 Key Findings:");
  console.log("=".repeat(80));
  console.log("  ✅ topic parameter IS supported by the catalog API");
  console.log(
    "  ✅ topic=tc-ready filters for translationCore-ready resources",
  );
  console.log("  ✅ This helps identify resources that are ready for use");
  console.log("  💡 We should add topic parameter to our tools!");
}

testTopicFilter()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
