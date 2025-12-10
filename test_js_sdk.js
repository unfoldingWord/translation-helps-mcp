#!/usr/bin/env node
/**
 * Comprehensive test script for the JavaScript SDK
 * Tests all available tools to ensure they work correctly.
 */

// Use local SDK for testing
import { TranslationHelpsClient } from "./packages/js-sdk/dist/index.js";

const SERVER_URL = "https://tc-helps.mcp.servant.bible/api/mcp";

async function testAllTools() {
  console.log("=".repeat(80));
  console.log("JavaScript SDK Comprehensive Test Suite");
  console.log("=".repeat(80));
  console.log();

  // Initialize client
  console.log("1. Initializing client...");
  const client = new TranslationHelpsClient({
    serverUrl: SERVER_URL,
  });

  try {
    await client.connect();
    console.log("   [OK] Client connected successfully");
    console.log();
  } catch (error) {
    console.log(`   [FAIL] Failed to connect: ${error.message}`);
    return false;
  }

  // Test results
  const results = {
    passed: [],
    failed: [],
  };

  // Test 1: List Tools
  console.log("2. Testing listTools()...");
  try {
    const tools = await client.listTools();
    if (!Array.isArray(tools)) throw new Error("Tools should be an array");
    if (tools.length === 0) throw new Error("Should have at least one tool");
    console.log(`   [OK] Found ${tools.length} tools`);
    results.passed.push("listTools");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["listTools", error.message]);
  }
  console.log();

  // Test 2: List Languages
  console.log("3. Testing listLanguages()...");
  try {
    const languages = await client.listLanguages();
    if (typeof languages !== "object")
      throw new Error("Languages should be an object");
    console.log("   [OK] Retrieved languages data");
    results.passed.push("listLanguages");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["listLanguages", error.message]);
  }
  console.log();

  // Test 3: List Subjects
  console.log("4. Testing listSubjects()...");
  try {
    const subjects = await client.listSubjects();
    if (typeof subjects !== "object")
      throw new Error("Subjects should be an object");
    console.log("   [OK] Retrieved subjects data");
    results.passed.push("listSubjects");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["listSubjects", error.message]);
  }
  console.log();

  // Test 4: List Resources for Language (with default topic)
  console.log(
    "5. Testing listResourcesForLanguage() (default topic='tc-ready')...",
  );
  try {
    const resources = await client.listResourcesForLanguage({
      language: "en",
    });
    if (typeof resources !== "object")
      throw new Error("Resources should be an object");
    console.log("   [OK] Retrieved resources for language 'en'");
    if (resources.totalResources) {
      console.log(`      Total resources: ${resources.totalResources}`);
    }
    results.passed.push("listResourcesForLanguage");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["listResourcesForLanguage", error.message]);
  }
  console.log();

  // Test 5: Fetch Scripture
  console.log("6. Testing fetchScripture()...");
  try {
    const scripture = await client.fetchScripture({
      reference: "John 3:16",
      language: "en",
    });
    if (typeof scripture !== "string")
      throw new Error("Scripture should be a string");
    if (scripture.length === 0)
      throw new Error("Scripture should not be empty");
    console.log(
      `   [OK] Retrieved scripture (length: ${scripture.length} chars)`,
    );
    results.passed.push("fetchScripture");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchScripture", error.message]);
  }
  console.log();

  // Test 6: Fetch Translation Notes
  console.log("7. Testing fetchTranslationNotes()...");
  try {
    const notes = await client.fetchTranslationNotes({
      reference: "John 3:16",
      language: "en",
    });
    if (typeof notes !== "object") throw new Error("Notes should be an object");
    console.log("   [OK] Retrieved translation notes");
    results.passed.push("fetchTranslationNotes");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchTranslationNotes", error.message]);
  }
  console.log();

  // Test 7: Fetch Translation Questions
  console.log("8. Testing fetchTranslationQuestions()...");
  try {
    const questions = await client.fetchTranslationQuestions({
      reference: "John 3:16",
      language: "en",
    });
    if (typeof questions !== "object")
      throw new Error("Questions should be an object");
    console.log("   [OK] Retrieved translation questions");
    results.passed.push("fetchTranslationQuestions");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchTranslationQuestions", error.message]);
  }
  console.log();

  // Test 8: Fetch Translation Word (by term)
  console.log("9. Testing fetchTranslationWord() (by term)...");
  try {
    const word = await client.fetchTranslationWord({
      term: "grace",
      language: "en",
    });
    if (typeof word !== "object")
      throw new Error("Translation word should be an object");
    console.log("   [OK] Retrieved translation word for 'grace'");
    results.passed.push("fetchTranslationWord");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchTranslationWord", error.message]);
  }
  console.log();

  // Test 9: Fetch Translation Word Links
  console.log("10. Testing fetchTranslationWordLinks()...");
  try {
    const links = await client.fetchTranslationWordLinks({
      reference: "John 3:16",
      language: "en",
    });
    if (typeof links !== "object")
      throw new Error("Word links should be an object");
    console.log("   [OK] Retrieved translation word links");
    results.passed.push("fetchTranslationWordLinks");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchTranslationWordLinks", error.message]);
  }
  console.log();

  // Test 10: Fetch Translation Academy
  console.log("11. Testing fetchTranslationAcademy()...");
  try {
    const academy = await client.fetchTranslationAcademy({
      moduleId: "figs-metaphor",
      language: "en",
    });
    if (typeof academy !== "object")
      throw new Error("Academy content should be an object");
    console.log("   [OK] Retrieved translation academy content");
    results.passed.push("fetchTranslationAcademy");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["fetchTranslationAcademy", error.message]);
  }
  console.log();

  // Test 11: Get System Prompt
  console.log("12. Testing getSystemPrompt()...");
  try {
    const prompt = await client.getSystemPrompt();
    if (typeof prompt !== "string")
      throw new Error("System prompt should be a string");
    if (prompt.length === 0)
      throw new Error("System prompt should not be empty");
    console.log(
      `   [OK] Retrieved system prompt (length: ${prompt.length} chars)`,
    );
    results.passed.push("getSystemPrompt");
  } catch (error) {
    console.log(`   [FAIL] Failed: ${error.message}`);
    results.failed.push(["getSystemPrompt", error.message]);
  }
  console.log();

  // Summary
  console.log("=".repeat(80));
  console.log("Test Summary");
  console.log("=".repeat(80));
  console.log(
    `[OK] Passed: ${results.passed.length}/${results.passed.length + results.failed.length}`,
  );
  console.log(
    `[FAIL] Failed: ${results.failed.length}/${results.passed.length + results.failed.length}`,
  );
  console.log();

  if (results.passed.length > 0) {
    console.log("Passed tests:");
    for (const test of results.passed) {
      console.log(`  [OK] ${test}`);
    }
    console.log();
  }

  if (results.failed.length > 0) {
    console.log("Failed tests:");
    for (const [test, error] of results.failed) {
      console.log(`  [FAIL] ${test}: ${error}`);
    }
    console.log();
    return false;
  }

  console.log("[SUCCESS] All tests passed!");
  return true;
}

// Run tests
testAllTools()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
