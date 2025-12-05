/**
 * Test parallel vs sequential API calls for performance comparison
 * Run with: node scripts/test-parallel-performance.js
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

async function fetchSubject(subject, organization, stage, limit, topic) {
  const searchUrl = new URL("https://git.door43.org/api/v1/catalog/search");
  searchUrl.searchParams.set("subject", subject);
  searchUrl.searchParams.set("stage", stage);
  searchUrl.searchParams.set("limit", limit.toString());

  if (organization) {
    searchUrl.searchParams.set("owner", organization);
  }

  if (topic) {
    searchUrl.searchParams.set("topic", topic);
  }

  const response = await fetch(searchUrl.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${subject}: ${response.status}`);
  }

  const data = await response.json();
  const items = data.data || [];

  return {
    subject,
    count: items.length,
    items,
  };
}

async function testSequential() {
  console.log("=".repeat(80));
  console.log("🐌 SEQUENTIAL API Calls (OLD APPROACH)");
  console.log("=".repeat(80));

  const startTime = Date.now();
  const results = [];

  for (const subject of DEFAULT_SUBJECTS) {
    const subjectStart = Date.now();
    const result = await fetchSubject(
      subject,
      undefined,
      "prod",
      100,
      undefined,
    );
    const duration = Date.now() - subjectStart;

    console.log(
      `  ${subject.padEnd(35)} ${result.count} items in ${duration}ms`,
    );
    results.push(result);
  }

  const totalDuration = Date.now() - startTime;
  const totalItems = results.reduce((sum, r) => sum + r.count, 0);

  console.log("\n📊 Sequential Results:");
  console.log(
    `  Total Time: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`,
  );
  console.log(`  Total Items: ${totalItems}`);
  console.log(
    `  Average per subject: ${(totalDuration / DEFAULT_SUBJECTS.length).toFixed(0)}ms`,
  );

  return { duration: totalDuration, items: totalItems };
}

async function testParallel() {
  console.log("\n" + "=".repeat(80));
  console.log("⚡ PARALLEL API Calls (NEW APPROACH)");
  console.log("=".repeat(80));

  const startTime = Date.now();

  // Fetch all subjects in parallel
  const promises = DEFAULT_SUBJECTS.map((subject) =>
    fetchSubject(subject, undefined, "prod", 100, undefined)
      .then((result) => {
        return result;
      })
      .catch((error) => {
        console.error(`  ❌ Error fetching ${subject}: ${error.message}`);
        return { subject, count: 0, items: [] };
      }),
  );

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;

  results.forEach((result) => {
    console.log(`  ${result.subject.padEnd(35)} ${result.count} items`);
  });

  const totalItems = results.reduce((sum, r) => sum + r.count, 0);

  console.log("\n📊 Parallel Results:");
  console.log(
    `  Total Time: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`,
  );
  console.log(`  Total Items: ${totalItems}`);
  console.log(`  All requests executed simultaneously!`);

  return { duration: totalDuration, items: totalItems };
}

async function runPerformanceComparison() {
  console.log("=".repeat(80));
  console.log("⚡ PERFORMANCE COMPARISON TEST");
  console.log("=".repeat(80));
  console.log(`Testing ${DEFAULT_SUBJECTS.length} subject searches\n`);

  const sequential = await testSequential();
  const parallel = await testParallel();

  const improvement = (
    ((sequential.duration - parallel.duration) / sequential.duration) *
    100
  ).toFixed(1);
  const speedup = (sequential.duration / parallel.duration).toFixed(1);

  console.log("\n" + "=".repeat(80));
  console.log("📊 PERFORMANCE COMPARISON");
  console.log("=".repeat(80));
  console.log(
    `Sequential: ${sequential.duration}ms (${(sequential.duration / 1000).toFixed(2)}s)`,
  );
  console.log(
    `Parallel:   ${parallel.duration}ms (${(parallel.duration / 1000).toFixed(2)}s)`,
  );
  console.log(`\n🚀 Improvement: ${improvement}% faster`);
  console.log(`⚡ Speedup: ${speedup}x`);

  if (parallel.duration < 5000) {
    console.log("\n✅ EXCELLENT: Under 5 seconds!");
  } else if (parallel.duration < 10000) {
    console.log("\n✅ GOOD: Under 10 seconds");
  } else {
    console.log("\n⚠️  SLOW: Still over 10 seconds (consider UX improvements)");
  }

  console.log("\n💡 Recommendation:");
  if (parallel.duration > 5000) {
    console.log(
      "  Consider guiding users to use list-resources-for-language instead",
    );
    console.log(
      "  That tool makes only 1 API call and returns results in ~1-2 seconds",
    );
  } else {
    console.log(
      "  Parallel execution makes this tool fast enough for direct use!",
    );
  }
}

runPerformanceComparison()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Failed:", error);
    process.exit(1);
  });
