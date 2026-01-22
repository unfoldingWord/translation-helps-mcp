#!/usr/bin/env node
/**
 * Compare MCP Server Tools with Python SDK Methods
 * Identifies missing methods, deprecated tools, and parameter mismatches
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MCP Server Tools (from tools-registry.ts)
const MCP_TOOLS = [
  "fetch_scripture",
  "fetch_translation_notes",
  "fetch_translation_questions",
  "fetch_translation_word_links",
  "fetch_translation_word",
  "fetch_translation_academy",
  "list_languages",
  "list_subjects",
  "list_resources_for_language",
];

// Python SDK Methods - Read from actual file
const pythonClientPath = path.join(
  __dirname,
  "../packages/python-sdk/translation_helps/client.py",
);
let PYTHON_METHODS = [];
if (fs.existsSync(pythonClientPath)) {
  const pythonContent = fs.readFileSync(pythonClientPath, "utf-8");
  // Extract async def method names
  const methodMatches = pythonContent.matchAll(/async def (\w+)\(/g);
  for (const match of methodMatches) {
    // Filter out private methods and internal methods
    const methodName = match[1];
    if (
      !methodName.startsWith("_") &&
      methodName !== "connect" &&
      methodName !== "close" &&
      methodName !== "__aenter__" &&
      methodName !== "__aexit__" &&
      methodName !== "call_tool" &&
      methodName !== "get_prompt" &&
      methodName !== "list_tools" &&
      methodName !== "list_prompts" &&
      methodName !== "check_prompts_support" &&
      methodName !== "get_capabilities" &&
      methodName !== "is_connected"
    ) {
      PYTHON_METHODS.push(methodName);
    }
  }
} else {
  // Fallback if file doesn't exist
  PYTHON_METHODS = [
    "fetch_scripture",
    "fetch_translation_notes",
    "fetch_translation_questions",
    "fetch_translation_word_links",
    "fetch_translation_word",
    "fetch_translation_academy",
    "list_languages",
    "list_subjects",
    "list_resources_for_language",
  ];
}

console.log("=".repeat(80));
console.log("MCP SERVER vs PYTHON SDK COMPARISON");
console.log("=".repeat(80));

// 1. Check for methods calling non-existent tools
console.log("\n❌ ISSUES FOUND:\n");

const issues = [];

// Check for deprecated methods
const deprecatedMethods = ["get_languages", "get_system_prompt"];
deprecatedMethods.forEach((method) => {
  if (PYTHON_METHODS.includes(method)) {
    issues.push({
      type: "DEPRECATED_METHOD",
      method: `${method}()`,
      tool: method,
      issue: `Python SDK has ${method}() but MCP server does not register ${method} tool`,
      fix: `Remove ${method}() method from Python SDK`,
    });
  }
});

// Check for missing methods
const missingMethods = MCP_TOOLS.filter((tool) => {
  // Check if any Python method matches the tool name
  return !PYTHON_METHODS.some((m) => m.includes(tool.replace(/_/g, "_")));
});

if (missingMethods.length > 0) {
  issues.push({
    type: "MISSING_METHOD",
    methods: missingMethods,
    issue:
      "MCP server has tools but Python SDK is missing corresponding methods",
    fix: "Add methods to Python SDK",
  });
}

// Display issues
issues.forEach((issue, idx) => {
  console.log(
    `${idx + 1}. ${issue.type}: ${issue.method || issue.methods?.join(", ")}`,
  );
  console.log(`   Tool: ${issue.tool || "N/A"}`);
  console.log(`   Issue: ${issue.issue}`);
  console.log(`   Fix: ${issue.fix}`);
  console.log("");
});

// 2. Parameter comparison
console.log("\n📋 PARAMETER SCHEMA COMPARISON:\n");

// Read actual tool files to check parameters
const toolFiles = {
  fetch_scripture: "src/tools/fetchScripture.ts",
  list_languages: "src/tools/listLanguages.ts",
  list_resources_for_language: "src/tools/listResourcesForLanguage.ts",
};

const pythonTypes = {
  fetch_scripture: "FetchScriptureOptions",
  list_languages: "ListLanguagesOptions",
  list_resources_for_language: "ListResourcesForLanguageOptions",
};

Object.entries(toolFiles).forEach(([toolName, filePath]) => {
  const fullPath = path.join(process.cwd(), filePath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf-8");

    // Extract Zod schema
    const schemaMatch = content.match(
      /export const \w+Args = z\.object\(\{([^}]+)\}\)/s,
    );
    if (schemaMatch) {
      const schemaContent = schemaMatch[1];

      // Extract parameter names
      const params = [];
      const paramMatches = schemaContent.matchAll(/(\w+):\s*[^,}]+/g);
      for (const match of paramMatches) {
        params.push(match[1]);
      }

      console.log(`${toolName}:`);
      console.log(`  MCP Server params: ${params.join(", ")}`);
      console.log(`  Python SDK type: ${pythonTypes[toolName]}`);
      console.log("");
    }
  }
});

// 3. Summary
console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));
console.log(`MCP Server Tools: ${MCP_TOOLS.length}`);
console.log(`Python SDK Methods: ${PYTHON_METHODS.length}`);
console.log(`Issues Found: ${issues.length}`);

if (issues.length === 0) {
  console.log("\n✅ No issues found! Python SDK is up to date.");
} else {
  console.log("\n⚠️  Action required: Fix the issues above.");
  process.exit(1);
}
