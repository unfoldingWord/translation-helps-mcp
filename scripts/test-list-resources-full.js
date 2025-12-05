/**
 * Full test with all subjects and higher limit
 * Run with: node scripts/test-list-resources-full.js
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

async function searchResourcesBySubject(
  subject,
  organization,
  stage = "prod",
  limit = 100,
) {
  const resources = [];
  const organizations =
    organization === undefined
      ? [undefined]
      : typeof organization === "string"
        ? [organization]
        : organization;

  for (const org of organizations) {
    try {
      const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
      searchUrl.searchParams.set("subject", subject);
      searchUrl.searchParams.set("stage", stage);
      searchUrl.searchParams.set("limit", limit.toString());

      if (org) {
        searchUrl.searchParams.set("owner", org);
      }

      console.log(`Fetching ${subject}...`);
      const response = await fetch(searchUrl.toString(), {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.error(`  ❌ ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const items = data.data || [];
      console.log(`  ✅ Found ${items.length} items`);

      for (const item of items) {
        const repoName = item.name || "";
        const langMatch = repoName.match(/^([^_]+)_/);
        const language = langMatch ? langMatch[1] : "";

        if (language) {
          const isDuplicate = resources.some(
            (r) =>
              r.name === item.name &&
              r.organization === (item.owner || org || "unknown"),
          );

          if (!isDuplicate) {
            resources.push({
              name: item.name,
              subject: subject,
              language: language,
              organization: item.owner || org || "unknown",
              version:
                item.release?.tag_name || item.default_branch || "master",
            });
          }
        }
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  return resources;
}

async function testFull() {
  console.log("🧪 Testing with ALL subjects (limit: 50 per subject)\n");

  const allResources = [];

  for (const subject of DEFAULT_DISCOVERY_SUBJECTS) {
    const resources = await searchResourcesBySubject(
      subject,
      "unfoldingWord",
      "prod",
      50,
    );
    allResources.push(...resources);
  }

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

    if (!langData.subjects.includes(resource.subject)) {
      langData.subjects.push(resource.subject);
    }

    langData.resources.push(resource);
    langData.resourceCount = langData.resources.length;
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 RESULTS:`);
  console.log(`   Total Resources: ${allResources.length}`);
  console.log(`   Languages: ${resourcesByLanguage.size}`);
  console.log(`${"=".repeat(80)}\n`);

  const sortedLanguages = Array.from(resourcesByLanguage.values())
    .sort((a, b) => b.resourceCount - a.resourceCount)
    .slice(0, 20); // Top 20 languages

  for (const lang of sortedLanguages) {
    console.log(
      `${lang.language.toUpperCase()}: ${lang.resourceCount} resources, ${lang.subjects.length} subjects`,
    );
    console.log(`  ${lang.subjects.join(", ")}`);
  }

  return {
    totalResources: allResources.length,
    totalLanguages: resourcesByLanguage.size,
    languages: sortedLanguages,
  };
}

testFull()
  .then((result) => {
    console.log(
      `\n✅ Found ${result.totalResources} resources across ${result.totalLanguages} languages`,
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n❌ ERROR: ${error.message}`);
    process.exit(1);
  });
