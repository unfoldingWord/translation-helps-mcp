/**
 * Global Test Setup
 *
 * Conditionally checks for Wrangler - only required for tests that need KV/R2.
 * API endpoint tests (ui/tests/api) don't require Wrangler and will skip this check.
 */

export async function setup() {
  // Check if we're running API tests that don't need Wrangler
  const allArgs = process.argv.join(" ");
  const isApiTest =
    allArgs.includes("ui/tests/api") ||
    allArgs.includes("tests/api") ||
    process.env.VITEST_FILE_PATTERN?.includes("api");

  // Skip Wrangler check for API tests
  if (isApiTest) {
    console.log("\n✅ Running API tests - Wrangler not required\n");
    return;
  }

  // For other tests, check if Wrangler is needed
  // Only enforce if TEST_BASE_URL is set to Wrangler port
  const testBaseUrl = process.env.TEST_BASE_URL || "http://localhost:8174";
  const needsWrangler = testBaseUrl.includes(":8787");

  if (!needsWrangler) {
    console.log("\n✅ Using dev server - Wrangler not required\n");
    return;
  }

  console.log("\n🔧 Checking Wrangler dev server...\n");

  const WRANGLER_PORT = 8787;
  const url = `http://localhost:${WRANGLER_PORT}`;

  try {
    // Try to hit the dev server
    const response = await fetch(`${url}/api/health`).catch(() => null);

    if (!response) {
      throw new Error("Cannot connect to Wrangler");
    }

    console.log(`✅ Wrangler dev server is running on port ${WRANGLER_PORT}\n`);
  } catch (_error) {
    console.error(`❌ Wrangler dev server is NOT running!\n`);
    console.error(`Please start it with:`);
    console.error(
      `cd ui && npx wrangler pages dev .svelte-kit/cloudflare --port ${WRANGLER_PORT}\n`,
    );
    console.error(`This is REQUIRED to test KV/R2 functionality!\n`);

    // Exit with error
    process.exit(1);
  }
}

export async function teardown() {
  // Nothing to tear down - leave Wrangler running
}
