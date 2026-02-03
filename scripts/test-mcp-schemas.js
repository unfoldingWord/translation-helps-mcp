#!/usr/bin/env node
/**
 * Quick MCP Schema Validation Script
 * Tests that tools/list returns complete schemas (not empty)
 *
 * Usage: node scripts/test-mcp-schemas.js
 */

import { getMCPToolsList } from "../ui/src/lib/mcp/tools-list.js";

console.log("🔍 MCP Schema Validation Test\n");
console.log("Testing that Zod v3 alignment fix worked...\n");

const tools = getMCPToolsList();

console.log(`✅ Found ${tools.length} tools\n`);
console.log("─".repeat(80));

let hasEmptySchemas = false;
let totalProperties = 0;

for (const tool of tools) {
  const schemaKeys = Object.keys(tool.inputSchema);
  const isEmpty = schemaKeys.length === 1 && schemaKeys[0] === "$schema";

  if (isEmpty) {
    console.log(`❌ ${tool.name}`);
    console.log(`   EMPTY SCHEMA - Only has: ${schemaKeys.join(", ")}`);
    hasEmptySchemas = true;
  } else {
    console.log(`✅ ${tool.name}`);

    if (tool.inputSchema.properties) {
      const propCount = Object.keys(tool.inputSchema.properties).length;
      totalProperties += propCount;
      console.log(`   Has ${propCount} properties`);

      // Show first few properties as examples
      const propNames = Object.keys(tool.inputSchema.properties).slice(0, 3);
      console.log(
        `   Parameters: ${propNames.join(", ")}${propCount > 3 ? "..." : ""}`,
      );
    } else if (tool.inputSchema.anyOf || tool.inputSchema.allOf) {
      console.log(`   Has complex schema (anyOf/allOf)`);
    } else {
      console.log(`   Schema type: ${tool.inputSchema.type || "unknown"}`);
    }
  }

  console.log("");
}

console.log("─".repeat(80));
console.log("\n📊 Summary:");
console.log(`   Total tools: ${tools.length}`);
console.log(`   Total parameters across all tools: ${totalProperties}`);

if (hasEmptySchemas) {
  console.log("\n❌ FAILURE: Found tools with empty schemas!");
  console.log("   This indicates the Zod version mismatch is still present.");
  console.log("   Run: cd ui && rm -rf node_modules && npm install");
  process.exit(1);
} else {
  console.log("\n✅ SUCCESS: All tools have complete schemas!");
  console.log("   The Zod v3 alignment fix is working correctly.");
  process.exit(0);
}
