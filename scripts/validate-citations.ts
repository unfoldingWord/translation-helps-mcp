/**
 * Citation Validation Script
 * 
 * Tests that all MCP responses include proper citation metadata
 */

import { fetchScripture } from '../src/functions/scripture-service.js';
import { fetchTranslationNotes } from '../src/functions/translation-notes-service.js';
import { fetchTranslationQuestions } from '../src/functions/translation-questions-service.js';
import { fetchResources } from '../src/functions/resources-service.js';

interface ValidationResult {
  test: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: ValidationResult[] = [];

function validateCitation(citation: any, context: string): boolean {
  if (!citation) {
    results.push({
      test: context,
      passed: false,
      message: 'Citation is missing',
    });
    return false;
  }

  const requiredFields = ['resource', 'organization', 'language', 'version', 'url'];
  const missingFields = requiredFields.filter(field => !citation[field]);

  if (missingFields.length > 0) {
    results.push({
      test: context,
      passed: false,
      message: `Citation missing fields: ${missingFields.join(', ')}`,
      details: citation,
    });
    return false;
  }

  results.push({
    test: context,
    passed: true,
    message: 'Citation is valid',
    details: citation,
  });
  return true;
}

async function testScriptureCitations() {
  console.log('\n🔍 Testing Scripture Citations...\n');

  try {
    const result = await fetchScripture({
      reference: 'John 3:16',
      language: 'en',
      organization: 'unfoldingWord',
    });

    // Test single scripture format
    if (result.scripture) {
      validateCitation(
        result.scripture.citation,
        'Scripture (single) - inline citation'
      );
    }

    // Test multiple scriptures format
    if (result.scriptures && Array.isArray(result.scriptures)) {
      result.scriptures.forEach((scripture, idx) => {
        validateCitation(
          scripture.citation,
          `Scripture array item ${idx + 1} - inline citation`
        );
      });
    }
  } catch (error) {
    results.push({
      test: 'Scripture fetch',
      passed: false,
      message: `Error: ${error.message}`,
    });
  }
}

async function testTranslationQuestionsCitations() {
  console.log('\n🔍 Testing Translation Questions Citations...\n');

  try {
    const result = await fetchTranslationQuestions({
      reference: 'Titus 3:11-15',
      language: 'es-419',
      organization: 'all',
    });

    // Test top-level citations array
    if (result.citations && Array.isArray(result.citations)) {
      results.push({
        test: 'Translation Questions - top-level citations array',
        passed: result.citations.length > 0,
        message: `Found ${result.citations.length} top-level citations`,
      });
    }

    // Test individual question citations
    if (result.translationQuestions && Array.isArray(result.translationQuestions)) {
      result.translationQuestions.forEach((question, idx) => {
        validateCitation(
          question.citation,
          `Translation Question ${idx + 1} - inline citation`
        );
      });
    }
  } catch (error) {
    results.push({
      test: 'Translation Questions fetch',
      passed: false,
      message: `Error: ${error.message}`,
    });
  }
}

async function testTranslationNotesCitations() {
  console.log('\n🔍 Testing Translation Notes Citations...\n');

  try {
    const result = await fetchTranslationNotes({
      reference: 'John 3:16',
      language: 'en',
      organization: 'unfoldingWord',
      includeContext: true,
      includeIntro: true,
    });

    // Test top-level citations array
    if (result.citations && Array.isArray(result.citations)) {
      results.push({
        test: 'Translation Notes - top-level citations array',
        passed: result.citations.length > 0,
        message: `Found ${result.citations.length} top-level citations`,
      });
    }

    // Test individual verse note citations
    if (result.verseNotes && Array.isArray(result.verseNotes)) {
      result.verseNotes.forEach((note, idx) => {
        validateCitation(
          note.citation,
          `Verse Note ${idx + 1} - inline citation`
        );
      });
    }

    // Test individual context note citations
    if (result.contextNotes && Array.isArray(result.contextNotes)) {
      result.contextNotes.forEach((note, idx) => {
        validateCitation(
          note.citation,
          `Context Note ${idx + 1} - inline citation`
        );
      });
    }
  } catch (error) {
    results.push({
      test: 'Translation Notes fetch',
      passed: false,
      message: `Error: ${error.message}`,
    });
  }
}

async function testResourcesAggregation() {
  console.log('\n🔍 Testing Multi-Resource Aggregation...\n');

  try {
    const result = await fetchResources({
      reference: 'John 3:16',
      language: 'en',
      organization: 'unfoldingWord',
      resources: ['scripture', 'notes', 'questions'],
    });

    // Test top-level citations array
    if (result.citations && Array.isArray(result.citations)) {
      results.push({
        test: 'Resources Aggregation - top-level citations array',
        passed: result.citations.length > 0,
        message: `Found ${result.citations.length} top-level citations`,
      });
    }

    // Test scripture citations
    if (result.scripture) {
      if (Array.isArray(result.scripture)) {
        result.scripture.forEach((scripture: any, idx: number) => {
          validateCitation(
            scripture.citation,
            `Aggregated Scripture ${idx + 1} - inline citation`
          );
        });
      } else {
        validateCitation(
          (result.scripture as any).citation,
          'Aggregated Scripture (single) - inline citation'
        );
      }
    }

    // Test notes citations
    if (result.translationNotes && Array.isArray(result.translationNotes)) {
      const note = result.translationNotes[0];
      if (note) {
        validateCitation(
          note.citation,
          'Aggregated Translation Note - inline citation (sample)'
        );
      }
    }

    // Test questions citations
    if (result.translationQuestions && Array.isArray(result.translationQuestions)) {
      const question = result.translationQuestions[0];
      if (question) {
        validateCitation(
          question.citation,
          'Aggregated Translation Question - inline citation (sample)'
        );
      }
    }
  } catch (error) {
    results.push({
      test: 'Resources Aggregation',
      passed: false,
      message: `Error: ${error.message}`,
    });
  }
}

async function runAllTests() {
  console.log('🧪 Citation Validation Tests\n');
  console.log('=' .repeat(60));

  await testScriptureCitations();
  await testTranslationQuestionsCitations();
  await testTranslationNotesCitations();
  await testResourcesAggregation();

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Results Summary:\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${failed}/${total}`);
  console.log(`📈 Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log('❌ Failed Tests:\n');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  • ${r.test}`);
        console.log(`    ${r.message}`);
        if (r.details) {
          console.log(`    Details:`, JSON.stringify(r.details, null, 2));
        }
        console.log();
      });
  }

  console.log('✅ Passed Tests:\n');
  results
    .filter(r => r.passed)
    .forEach(r => {
      console.log(`  • ${r.test}`);
      console.log(`    ${r.message}\n`);
    });

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
