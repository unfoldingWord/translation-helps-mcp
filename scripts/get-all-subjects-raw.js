/**
 * Fetch ALL subjects and show raw response
 * Run with: node scripts/get-all-subjects-raw.js
 */

async function getAllSubjectsRaw() {
  console.log("=".repeat(80));
  console.log("📚 Fetching ALL Subjects - RAW Response");
  console.log("=".repeat(80));

  const url = new URL("https://git.door43.org/api/v1/catalog/list/subjects");
  url.searchParams.set("stage", "prod");

  try {
    console.log(`\n📡 URL: ${url.toString()}\n`);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    console.log(`📊 Status: ${response.status}\n`);

    if (!response.ok) {
      console.log(`❌ Failed: ${response.statusText}`);
      return;
    }

    const data = await response.json();

    console.log("RAW RESPONSE:");
    console.log("─".repeat(80));
    console.log(JSON.stringify(data, null, 2));
    console.log("─".repeat(80));

    // Try to extract subjects from different possible structures
    console.log("\n📊 ANALYSIS:");
    console.log("─".repeat(80));
    console.log("Response keys:", Object.keys(data));
    console.log("Has 'data' field:", !!data.data);
    console.log("Has 'subjects' field:", !!data.subjects);

    if (data.data) {
      console.log(
        "data.data type:",
        Array.isArray(data.data) ? "array" : typeof data.data,
      );
      console.log("data.data length:", data.data?.length);
      if (data.data.length > 0) {
        console.log("\nFirst item structure:");
        console.log(JSON.stringify(data.data[0], null, 2));
      }
    }

    // Extract and list all unique subject names
    if (data.data && Array.isArray(data.data)) {
      const subjectNames = data.data
        .map((item) => {
          // Try different possible field names
          return (
            item.name || item.subject || item.title || item.id || String(item)
          );
        })
        .filter((name) => name && name !== "Unknown");

      console.log("\n" + "=".repeat(80));
      console.log("📋 EXTRACTED SUBJECT NAMES:");
      console.log("=".repeat(80));

      const uniqueNames = [...new Set(subjectNames)].sort();
      uniqueNames.forEach((name, i) => {
        const item = data.data.find(
          (d) =>
            d.name === name ||
            d.subject === name ||
            d.title === name ||
            d.id === name,
        );
        const count = item?.count || 0;
        console.log(
          `${(i + 1).toString().padStart(3)}. ${name.padEnd(50)} (${count} resources)`,
        );
      });

      console.log("\n" + "=".repeat(80));
      console.log("📋 COPY-PASTE LIST:");
      console.log("=".repeat(80));
      uniqueNames.forEach((name) => {
        console.log(`  "${name}",`);
      });
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  }
}

getAllSubjectsRaw()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
