/**
 * Test script for list-resources-by-language fetching logic
 * Run with: node scripts/test-list-resources-by-language.js
 */

const DEFAULT_DISCOVERY_SUBJECTS = [
  "Bible",
  "Translation Notes",
  "Translation Words",
  "Translation Questions",
  "Translation Academy",
  "Open Bible Stories",
  "OBS Translation Notes",
  "OBS Translation Questions",
  "OBS Study Notes",
  "OBS Study Questions",
];

/**
 * Search catalog for resources by subject
 */
async function searchResourcesBySubject(
  subject,
  organization,
  stage = "prod",
  limit = 100,
) {
  console.log(`\n🔍 Searching for subject: "${subject}"`);
  console.log(`   Organization: ${organization || "all"}`);
  console.log(`   Stage: ${stage}`);
  console.log(`   Limit: ${limit}`);

  const resources = [];

  // Handle multiple organizations
  const organizations =
    organization === undefined
      ? [undefined] // Search all orgs
      : typeof organization === "string"
        ? [organization]
        : organization;

  // Search for each organization
  for (const org of organizations) {
    try {
      const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
      searchUrl.searchParams.set("subject", subject);
      searchUrl.searchParams.set("stage", stage);
      searchUrl.searchParams.set("limit", limit.toString());

      if (org) {
        searchUrl.searchParams.set("owner", org);
      }

      console.log(`   📡 Fetching: ${searchUrl.toString()}`);
      const searchStart = Date.now();

      const response = await fetch(searchUrl.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      const duration = Date.now() - searchStart;
      console.log(
        `   ⏱️  Response in ${duration}ms - Status: ${response.status}`,
      );

      if (!response.ok) {
        console.error(
          `   ❌ Failed: ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = await response.json();
      const items = data.data || [];
      console.log(`   ✅ Found ${items.length} items`);

      for (const item of items) {
        // Extract language from repo name (format: {language}_{resource})
        const repoName = item.name || "";
        const langMatch = repoName.match(/^([^_]+)_/);
        const language = langMatch ? langMatch[1] : "";

        if (language) {
          // Check for duplicates
          const isDuplicate = resources.some(
            (r) =>
              r.name === item.name &&
              r.organization === (item.owner || org || "unknown"),
          );

          if (!isDuplicate) {
            resources.push({
              name: item.name || "",
              subject: subject,
              language: language,
              organization: item.owner || org || "unknown",
              version:
                item.release?.tag_name || item.default_branch || "master",
            });
          }
        }
      }

      console.log(`   📦 Added ${resources.length} unique resources so far`);
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  return resources;
}

/**
 * Main test function
 */
async function testListResourcesByLanguage() {
  console.log("=".repeat(80));
  console.log("🧪 Testing list-resources-by-language fetching logic");
  console.log("=".repeat(80));

  // Test parameters
  const subjects = ["Translation Words", "Translation Notes"]; // Test with 2 subjects
  const organization = "unfoldingWord";
  const stage = "prod";
  const limit = 10; // Keep it small for testing

  console.log("\n📋 Test Parameters:");
  console.log(`   Subjects: ${subjects.join(", ")}`);
  console.log(`   Organization: ${organization}`);
  console.log(`   Stage: ${stage}`);
  console.log(`   Limit per subject: ${limit}`);

  // Fetch resources for each subject
  const allResources = [];

  for (const subject of subjects) {
    const resources = await searchResourcesBySubject(
      subject,
      organization,
      stage,
      limit,
    );
    allResources.push(...resources);
  }

  console.log("\n" + "=".repeat(80));
  console.log(`📊 Total Resources Found: ${allResources.length}`);
  console.log("=".repeat(80));

  // Organize by language
  const resourcesByLanguage = new Map();

  for (const resource of allResources) {
    if (!resourcesByLanguage.has(resource.language)) {
      resourcesByLanguage.set(resource.language, {
        language: resource.language,
        subjects: [],
        resources: [],
        resourceCount: 0,
      });
    }

    const langData = resourcesByLanguage.get(resource.language);

    // Add subject if not already present
    if (!langData.subjects.includes(resource.subject)) {
      langData.subjects.push(resource.subject);
    }

    // Add resource
    langData.resources.push(resource);
    langData.resourceCount = langData.resources.length;
  }

  // Display results
  console.log(`\n🌍 Languages Found: ${resourcesByLanguage.size}`);
  console.log("=".repeat(80));

  const sortedLanguages = Array.from(resourcesByLanguage.values()).sort(
    (a, b) => b.resourceCount - a.resourceCount,
  );

  for (const lang of sortedLanguages) {
    console.log(`\n${lang.language.toUpperCase()}`);
    console.log(`  📦 ${lang.resourceCount} resource(s)`);
    console.log(`  📚 Subjects: ${lang.subjects.join(", ")}`);
    console.log(`  📋 Resources:`);
    for (const res of lang.resources.slice(0, 3)) {
      // Show first 3
      console.log(`     - ${res.name} (${res.organization})`);
    }
    if (lang.resources.length > 3) {
      console.log(`     ... and ${lang.resources.length - 3} more`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Test Complete!");
  console.log("=".repeat(80));

  // Return structured data for verification
  return {
    totalResources: allResources.length,
    languages: sortedLanguages,
    success: allResources.length > 0,
  };
}

// Run the test
testListResourcesByLanguage()
  .then((result) => {
    if (result.success) {
      console.log("\n✅ SUCCESS: Fetching logic is working!");
      process.exit(0);
    } else {
      console.log("\n❌ FAILED: No resources found!");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  });
