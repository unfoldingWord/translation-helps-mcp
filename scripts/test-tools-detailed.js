/**
 * Detailed validation test for all tools
 * Checks that responses contain expected data structures
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8174";

const TEST_CONFIG = {
  organization: "unfoldingWord",
  language: "en",
  reference: "John 3:16",
  term: "grace",
  moduleId: "figs-metaphor",
};

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testTool(name, params, endpoint, validators) {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  const url = `${BASE_URL}${endpoint}?${queryParams.toString()}`;
  const response = await fetch(url);
  const data = await response.json();

  log(`\n🧪 ${name}`, "cyan");
  console.log(`   URL: ${url}`);
  console.log(`   Status: ${response.status}`);

  let allPassed = true;
  for (const [validatorName, validator] of Object.entries(validators)) {
    try {
      const result = validator(data);
      if (result.pass) {
        log(`   ✅ ${validatorName}: ${result.message || "OK"}`, "green");
      } else {
        log(`   ❌ ${validatorName}: ${result.message || "FAILED"}`, "red");
        allPassed = false;
      }
    } catch (error) {
      log(`   ❌ ${validatorName}: Error - ${error.message}`, "red");
      allPassed = false;
    }
  }

  return { name, passed: allPassed, data };
}

async function runTests() {
  console.log("=".repeat(80));
  log("DETAILED TOOL VALIDATION TEST", "cyan");
  console.log("=".repeat(80));

  const results = [];

  // 1. fetch_scripture
  results.push(
    await testTool(
      "fetch_scripture",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-scripture",
      {
        "Has scripture array": (data) => ({
          pass: Array.isArray(data.scripture) && data.scripture.length > 0,
          message: `Found ${data.scripture?.length || 0} translations`,
        }),
        "Scripture has text": (data) => ({
          pass: data.scripture?.some((s) => s.text && s.text.length > 0),
          message: "At least one translation has text",
        }),
        "Has reference": (data) => ({
          pass: data.reference === TEST_CONFIG.reference,
          message: `Reference matches: ${data.reference}`,
        }),
      },
    ),
  );

  // 2. fetch_translation_notes
  results.push(
    await testTool(
      "fetch_translation_notes",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-translation-notes",
      {
        "Has notes": (data) => ({
          pass:
            (data.items && data.items.length > 0) ||
            (data.notes && data.notes.length > 0) ||
            (data.verseNotes && data.verseNotes.length > 0),
          message: `Found ${(data.items || data.notes || data.verseNotes || []).length} notes`,
        }),
        "Notes have content": (data) => {
          const notes = data.items || data.notes || data.verseNotes || [];
          return {
            pass: notes.some((n) => n.Note || n.note || n.text || n.content),
            message: "At least one note has content",
          };
        },
      },
    ),
  );

  // 3. fetch_translation_questions
  results.push(
    await testTool(
      "fetch_translation_questions",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-translation-questions",
      {
        "Has questions": (data) => ({
          pass:
            (data.items && data.items.length > 0) ||
            (data.questions &&
              Array.isArray(data.questions) &&
              data.questions.length > 0),
          message: `Found ${(data.items || data.questions || []).length} questions`,
        }),
        "Questions have Q&A": (data) => {
          const questions = data.items || data.questions || [];
          return {
            pass: questions.some(
              (q) =>
                (q.Question || q.question) &&
                (q.Response || q.Answer || q.answer),
            ),
            message: "At least one question has both question and answer",
          };
        },
      },
    ),
  );

  // 4. fetch_translation_word_links
  results.push(
    await testTool(
      "fetch_translation_word_links",
      {
        reference: TEST_CONFIG.reference,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-translation-word-links",
      {
        "Has word links": (data) => ({
          pass:
            (data.items && data.items.length > 0) ||
            (data.links && data.links.length > 0) ||
            (data.wordLinks && data.wordLinks.length > 0) ||
            (Array.isArray(data) && data.length > 0),
          message: `Found ${(data.items || data.links || data.wordLinks || data || []).length} word links`,
        }),
        "Links have term info": (data) => {
          const links =
            data.items || data.links || data.wordLinks || data || [];
          return {
            pass:
              Array.isArray(links) &&
              links.some((l) => l.term || l.Term || l.word || l.Word),
            message: "At least one link has term information",
          };
        },
      },
    ),
  );

  // 5. fetch_translation_word
  results.push(
    await testTool(
      "fetch_translation_word",
      {
        term: TEST_CONFIG.term,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-translation-word",
      {
        "Has word data": (data) => ({
          pass:
            (data.words && data.words.length > 0) ||
            data.term ||
            data.title ||
            data.content,
          message: "Found word data",
        }),
        "Has definition or content": (data) => {
          const words = data.words || (data.term ? [data] : []);
          return {
            pass: words.some(
              (w) =>
                w.definition ||
                w.Definition ||
                w.content ||
                w.Content ||
                w.text,
            ),
            message: "At least one word has definition/content",
          };
        },
      },
    ),
  );

  // 6. fetch_translation_academy
  results.push(
    await testTool(
      "fetch_translation_academy",
      {
        moduleId: TEST_CONFIG.moduleId,
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
      },
      "/api/fetch-translation-academy",
      {
        "Has academy content": (data) => ({
          pass:
            data.content ||
            data.Content ||
            data.text ||
            data.Text ||
            data.markdown ||
            (data.articles && data.articles.length > 0),
          message: "Found academy content",
        }),
        "Has title or module info": (data) => ({
          pass:
            data.title ||
            data.Title ||
            data.moduleId ||
            data.module ||
            data.name,
          message: "Has title or module information",
        }),
      },
    ),
  );

  // 7. list_languages
  results.push(
    await testTool(
      "list_languages",
      { organization: TEST_CONFIG.organization, stage: "prod" },
      "/api/list-languages",
      {
        "Has languages array": (data) => ({
          pass: Array.isArray(data.languages) && data.languages.length > 0,
          message: `Found ${data.languages?.length || 0} languages`,
        }),
        "Languages have codes": (data) => ({
          pass: data.languages?.some((l) => l.code || l.Code || l.languageCode),
          message: "At least one language has a code",
        }),
      },
    ),
  );

  // 8. list_subjects
  results.push(
    await testTool(
      "list_subjects",
      {
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
        stage: "prod",
      },
      "/api/list-subjects",
      {
        "Has subjects array": (data) => ({
          pass: Array.isArray(data.subjects),
          message:
            data.subjects?.length > 0
              ? `Found ${data.subjects.length} subjects`
              : "Subjects array exists but is empty (may be expected with filters)",
        }),
        "Response structure valid": (data) => ({
          pass: typeof data === "object" && "subjects" in data,
          message: "Response has valid structure with subjects field",
        }),
      },
    ),
  );

  // 9. list_resources_for_language
  results.push(
    await testTool(
      "list_resources_for_language",
      {
        language: TEST_CONFIG.language,
        organization: TEST_CONFIG.organization,
        stage: "prod",
        topic: "tc-ready",
      },
      "/api/list-resources-for-language",
      {
        "Has resources data": (data) => ({
          pass:
            data.resources ||
            (typeof data === "object" && Object.keys(data).length > 0),
          message: "Found resources data",
        }),
        "Has organized structure": (data) => {
          const resources = data.resources || data;
          return {
            pass:
              typeof resources === "object" &&
              (Array.isArray(resources) || Object.keys(resources).length > 0),
            message: "Resources are organized (array or object)",
          };
        },
      },
    ),
  );

  // Summary
  console.log("\n" + "=".repeat(80));
  log("TEST SUMMARY", "cyan");
  console.log("=".repeat(80));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  log(`\nTotal: ${results.length}`, "cyan");
  log(`Passed: ${passed}`, "green");
  if (failed > 0) {
    log(`Failed: ${failed}`, "red");
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        log(`  - ${r.name}`, "red");
      });
  }

  console.log("\n" + "=".repeat(80));
  if (failed === 0) {
    log("✅ ALL TESTS PASSED!", "green");
  } else {
    log(`⚠️  ${failed} TEST(S) FAILED`, "yellow");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
