/**
 * Fetch ALL available subjects from Door43 catalog
 * Run with: node scripts/get-all-subjects.js
 */

async function getAllSubjects() {
  console.log("=".repeat(80));
  console.log("📚 Fetching ALL Subjects from Door43 Catalog");
  console.log("=".repeat(80));

  const url = new URL("https://git.door43.org/api/v1/catalog/list/subjects");
  url.searchParams.set("stage", "prod");
  // Don't filter by language or organization to get ALL subjects

  try {
    console.log(`\n📡 URL: ${url.toString()}\n`);

    const startTime = Date.now();
    const response = await fetch(url.toString(), {
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
    const subjects = data.data || [];

    console.log(`✅ Found ${subjects.length} total subjects\n`);
    console.log("=".repeat(80));
    console.log("📋 COMPLETE SUBJECT LIST:");
    console.log("=".repeat(80));

    // Sort alphabetically for easier review
    const sortedSubjects = subjects
      .map((s) => ({
        name: s.name || "Unknown",
        count: s.count || 0,
        description: s.description || "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Group by category for better organization
    const categories = {
      bible: [],
      translation: [],
      obs: [],
      study: [],
      original: [],
      other: [],
    };

    for (const subject of sortedSubjects) {
      const nameLower = subject.name.toLowerCase();

      if (nameLower.includes("bible")) {
        categories.bible.push(subject);
      } else if (nameLower.includes("translation")) {
        categories.translation.push(subject);
      } else if (nameLower.includes("obs")) {
        categories.obs.push(subject);
      } else if (nameLower.includes("study")) {
        categories.study.push(subject);
      } else if (
        nameLower.includes("greek") ||
        nameLower.includes("hebrew") ||
        nameLower.includes("aramaic") ||
        nameLower.includes("lexicon")
      ) {
        categories.original.push(subject);
      } else {
        categories.other.push(subject);
      }
    }

    console.log("\n📖 BIBLE & SCRIPTURE RESOURCES:");
    console.log("─".repeat(80));
    categories.bible.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n📝 TRANSLATION HELPS:");
    console.log("─".repeat(80));
    categories.translation.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n📚 OPEN BIBLE STORIES (OBS):");
    console.log("─".repeat(80));
    categories.obs.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n📖 STUDY RESOURCES:");
    console.log("─".repeat(80));
    categories.study.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n🔤 ORIGINAL LANGUAGE RESOURCES:");
    console.log("─".repeat(80));
    categories.original.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n🔧 OTHER RESOURCES:");
    console.log("─".repeat(80));
    categories.other.forEach((s) => {
      console.log(`  ✓ ${s.name.padEnd(40)} (${s.count} resources)`);
    });

    console.log("\n" + "=".repeat(80));
    console.log("📊 COMPLETE LIST (Alphabetical):");
    console.log("=".repeat(80));
    sortedSubjects.forEach((s, i) => {
      console.log(
        `${(i + 1).toString().padStart(3)}. ${s.name.padEnd(45)} (${s.count} resources)`,
      );
    });

    console.log("\n" + "=".repeat(80));
    console.log(`✅ Total: ${subjects.length} unique subjects`);
    console.log("=".repeat(80));

    // Export as JSON for easy copy-paste
    console.log("\n📋 JSON Format (for code):");
    console.log("─".repeat(80));
    const subjectNames = sortedSubjects.map((s) => s.name);
    console.log(JSON.stringify(subjectNames, null, 2));

    return sortedSubjects;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  }
}

getAllSubjects()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
