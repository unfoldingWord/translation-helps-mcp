#!/usr/bin/env node
/**
 * Compare MCP Server Tools with TypeScript/JavaScript SDK Methods
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

// TypeScript SDK Methods - Read from actual file
const jsClientPath = path.join(__dirname, "../packages/js-sdk/src/client.ts");
let JS_METHODS = [];
if (fs.existsSync(jsClientPath)) {
  const jsContent = fs.readFileSync(jsClientPath, "utf-8");
  // Extract async method names (convenience methods)
  const methodMatches = jsContent.matchAll(/async (\w+)\(/g);
  for (const match of methodMatches) {
    // Filter out private methods and internal methods
    const methodName = match[1];
    if (
      !methodName.startsWith("_") &&
      methodName !== "connect" &&
      methodName !== "sendRequest" &&
      methodName !== "refreshTools" &&
      methodName !== "refreshPrompts" &&
      methodName !== "ensureInitialized" &&
      methodName !== "callTool" &&
      methodName !== "getPrompt" &&
      methodName !== "listTools" &&
      methodName !== "listPrompts" &&
      methodName !== "isConnected"
    ) {
      JS_METHODS.push(methodName);
    }
  }
} else {
  // Fallback if file doesn't exist
  JS_METHODS = [
    "fetchScripture",
    "fetchTranslationNotes",
    "fetchTranslationQuestions",
    "fetchTranslationWordLinks",
    "fetchTranslationWord",
    "fetchTranslationAcademy",
    "getLanguages",
    "listLanguages",
    "listSubjects",
    "listResourcesForLanguage",
    "getSystemPrompt",
  ];
}

console.log("=".repeat(80));
console.log("MCP SERVER vs TYPESCRIPT SDK COMPARISON");
console.log("=".repeat(80));

// 1. Check for methods calling non-existent tools
console.log("\n❌ ISSUES FOUND:\n");

const issues = [];

// Map JS method names to MCP tool names
const methodToTool = {
  fetchScripture: "fetch_scripture",
  fetchTranslationNotes: "fetch_translation_notes",
  fetchTranslationQuestions: "fetch_translation_questions",
  fetchTranslationWordLinks: "fetch_translation_word_links",
  fetchTranslationWord: "fetch_translation_word",
  fetchTranslationAcademy: "fetch_translation_academy",
  getLanguages: "get_languages",
  listLanguages: "list_languages",
  listSubjects: "list_subjects",
  listResourcesForLanguage: "list_resources_for_language",
  getSystemPrompt: "get_system_prompt",
};

// Check for deprecated methods
const deprecatedMethods = ["getLanguages", "getSystemPrompt"];
deprecatedMethods.forEach((method) => {
  if (JS_METHODS.includes(method)) {
    const toolName = methodToTool[method];
    if (!MCP_TOOLS.includes(toolName)) {
      issues.push({
        type: "DEPRECATED_METHOD",
        method: `${method}()`,
        tool: toolName,
        issue: `TypeScript SDK has ${method}() but MCP server does not register ${toolName} tool`,
        fix: `Remove ${method}() method from TypeScript SDK`,
      });
    }
  }
});

// Check for missing methods
const expectedMethods = [
  "fetchScripture",
  "fetchTranslationNotes",
  "fetchTranslationQuestions",
  "fetchTranslationWordLinks",
  "fetchTranslationWord",
  "fetchTranslationAcademy",
  "listLanguages",
  "listSubjects",
  "listResourcesForLanguage",
];

const missingMethods = expectedMethods.filter(
  (method) => !JS_METHODS.includes(method),
);
if (missingMethods.length > 0) {
  issues.push({
    type: "MISSING_METHOD",
    methods: missingMethods,
    issue:
      "MCP server has tools but TypeScript SDK is missing corresponding methods",
    fix: "Add methods to TypeScript SDK",
  });
}

// Display issues
if (issues.length > 0) {
  issues.forEach((issue, idx) => {
    console.log(
      `${idx + 1}. ${issue.type}: ${issue.method || issue.methods?.join(", ")}`,
    );
    if (issue.tool) console.log(`   Tool: ${issue.tool}`);
    console.log(`   Issue: ${issue.issue}`);
    console.log(`   Fix: ${issue.fix}`);
    console.log("");
  });
} else {
  console.log("   ✅ No issues found!\n");
}

// 2. Parameter comparison
console.log("\n📋 PARAMETER SCHEMA COMPARISON:\n");

// Check FetchScriptureOptions
const jsTypesPath = path.join(__dirname, "../packages/js-sdk/src/types.ts");
if (fs.existsSync(jsTypesPath)) {
  const typesContent = fs.readFileSync(jsTypesPath, "utf-8");

  // Check fetch_scripture parameters
  const fetchScriptureMatch = typesContent.match(
    /export interface FetchScriptureOptions \{([^}]+)\}/s,
  );
  if (fetchScriptureMatch) {
    const params = fetchScriptureMatch[1];
    const hasResource = params.includes("resource");
    const hasIncludeAlignment = params.includes("includeAlignment");

    console.log("fetch_scripture:");
    console.log(
      `  MCP Server params: reference, language, organization, includeVerseNumbers, format, resource, includeAlignment`,
    );
    console.log(
      `  TypeScript SDK has 'resource': ${hasResource ? "✅" : "❌"}`,
    );
    console.log(
      `  TypeScript SDK has 'includeAlignment': ${hasIncludeAlignment ? "✅" : "❌"}`,
    );
    console.log("");
  }
}

// 3. Summary
console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));
console.log(`MCP Server Tools: ${MCP_TOOLS.length}`);
console.log(`TypeScript SDK Methods: ${JS_METHODS.length}`);
console.log(`Issues Found: ${issues.length}`);

if (issues.length === 0) {
  console.log("\n✅ No issues found! TypeScript SDK is up to date.");
} else {
  console.log("\n⚠️  Action required: Fix the issues above.");
  process.exit(1);
}
