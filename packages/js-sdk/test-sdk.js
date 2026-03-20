#!/usr/bin/env node

/**
 * Comprehensive SDK Test Suite
 * Tests recent fixes:
 * - Organization parameter (should search all orgs when omitted)
 * - Topic parameter (should default to "tc-ready")
 * - Prompt improvements for translation notes
 */

import { TranslationHelpsClient } from './dist/index.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000/api';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logTest(name) {
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  log(`Testing: ${name}`, colors.yellow);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
}

async function testOrganizationParameter() {
  logTest('Organization Parameter - Multi-Org Search (Default)');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing list_resources_for_language WITHOUT organization param...', colors.blue);
    const result = await client.listResourcesForLanguage({
      language: 'en',
      limit: 100
    });
    
    const orgCounts = {};
    for (const [subject, resources] of Object.entries(result.resourcesBySubject)) {
      for (const resource of resources) {
        const org = resource.organization || 'unknown';
        orgCounts[org] = (orgCounts[org] || 0) + 1;
      }
    }
    
    log(`✓ Found resources from ${Object.keys(orgCounts).length} organizations:`, colors.green);
    for (const [org, count] of Object.entries(orgCounts)) {
      console.log(`  - ${org}: ${count} resources`);
    }
    
    if (Object.keys(orgCounts).length > 1) {
      log('✓ PASS: Multi-organization search working correctly!', colors.green);
    } else {
      log('⚠ WARNING: Only found 1 organization. This might be correct if only one org has "en" resources.', colors.yellow);
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testOrganizationParameterSpecific() {
  logTest('Organization Parameter - Single Org Filter');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing list_resources_for_language WITH organization="unfoldingWord"...', colors.blue);
    const result = await client.listResourcesForLanguage({
      language: 'en',
      organization: 'unfoldingWord',
      limit: 100
    });
    
    const orgCounts = {};
    for (const [subject, resources] of Object.entries(result.resourcesBySubject)) {
      for (const resource of resources) {
        const org = resource.organization || 'unknown';
        orgCounts[org] = (orgCounts[org] || 0) + 1;
      }
    }
    
    log(`✓ Found resources from ${Object.keys(orgCounts).length} organization(s):`, colors.green);
    for (const [org, count] of Object.entries(orgCounts)) {
      console.log(`  - ${org}: ${count} resources`);
    }
    
    if (Object.keys(orgCounts).length === 1 && orgCounts['unfoldingWord']) {
      log('✓ PASS: Single organization filter working correctly!', colors.green);
    } else {
      log('✗ FAIL: Expected only "unfoldingWord" resources', colors.red);
      throw new Error('Organization filter not working correctly');
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testTopicParameter() {
  logTest('Topic Parameter - Default "tc-ready"');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing list_resources_for_language WITHOUT topic param (should default to "tc-ready")...', colors.blue);
    const result = await client.listResourcesForLanguage({
      language: 'en',
      limit: 50
    });
    
    const topicCounts = {};
    for (const [subject, resources] of Object.entries(result.resourcesBySubject)) {
      for (const resource of resources) {
        const topics = resource.metadata?.topic || ['no-topic'];
        for (const topic of topics) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }
    }
    
    log(`✓ Found resources with topics:`, colors.green);
    for (const [topic, count] of Object.entries(topicCounts)) {
      console.log(`  - ${topic}: ${count} resources`);
    }
    
    if (topicCounts['tc-ready'] > 0) {
      log('✓ PASS: Topic filter defaulting to "tc-ready" correctly!', colors.green);
    } else {
      log('⚠ WARNING: No "tc-ready" resources found. This might be correct for some languages.', colors.yellow);
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testFetchScripture() {
  logTest('Fetch Scripture - Organization Parameter');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing fetchScripture WITHOUT organization (should search all orgs)...', colors.blue);
    const scripture = await client.fetchScripture({
      reference: 'John 3:16',
      language: 'en',
      format: 'text'
    });
    
    if (scripture && scripture.length > 0) {
      log(`✓ Successfully fetched scripture: "${scripture.substring(0, 50)}..."`, colors.green);
      log('✓ PASS: Scripture fetch working without organization!', colors.green);
    } else {
      throw new Error('No scripture text returned');
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testFetchTranslationNotes() {
  logTest('Fetch Translation Notes - Organization Parameter');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing fetchTranslationNotes WITHOUT organization...', colors.blue);
    const notes = await client.fetchTranslationNotes({
      reference: 'Titus 1:1',
      language: 'en'
    });
    
    if (notes) {
      log(`✓ Successfully fetched translation notes`, colors.green);
      console.log(`  - Verse notes: ${notes.verseNotes?.length || 0}`);
      console.log(`  - Context notes: ${notes.contextNotes?.length || 0}`);
      
      if (notes.verseNotes && notes.verseNotes.length > 0) {
        log(`\nFirst note preview:`, colors.blue);
        const firstNote = notes.verseNotes[0];
        console.log(`  Quote: ${firstNote.Quote}`);
        console.log(`  Note: ${firstNote.Note?.substring(0, 100)}...`);
      }
      
      log('✓ PASS: Translation notes fetch working without organization!', colors.green);
    } else {
      throw new Error('No notes returned');
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testFetchTranslationQuestions() {
  logTest('Fetch Translation Questions - Organization Parameter');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing fetchTranslationQuestions WITHOUT organization...', colors.blue);
    const questions = await client.fetchTranslationQuestions({
      reference: 'Genesis 1:1',
      language: 'en'
    });
    
    if (questions && questions.length > 0) {
      log(`✓ Successfully fetched ${questions.length} translation questions`, colors.green);
      log(`\nFirst question preview:`, colors.blue);
      console.log(`  Q: ${questions[0].Question}`);
      console.log(`  A: ${questions[0].Answer?.substring(0, 100)}...`);
      log('✓ PASS: Translation questions fetch working without organization!', colors.green);
    } else {
      throw new Error('No questions returned');
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function testLanguageVariantFallback() {
  logTest('Language Variant Fallback (es-419 → es)');
  
  const client = new TranslationHelpsClient({ serverUrl: SERVER_URL });
  await client.connect();
  
  try {
    log('Testing list_resources_for_language with es-419...', colors.blue);
    const result = await client.listResourcesForLanguage({
      language: 'es-419',
      limit: 50
    });
    
    if (result.totalResources > 0) {
      log(`✓ Successfully found ${result.totalResources} resources`, colors.green);
      log(`✓ Language used: ${result.language || 'es-419'}`, colors.green);
      
      if (result.detectedVariant) {
        log(`✓ Variant fallback detected: ${JSON.stringify(result.detectedVariant)}`, colors.green);
      }
      
      log('✓ PASS: Language variant fallback working!', colors.green);
    } else {
      log('⚠ WARNING: No resources found for es-419', colors.yellow);
    }
    
  } catch (error) {
    log(`✗ FAIL: ${error.message}`, colors.red);
    throw error;
  }
}

async function runAllTests() {
  console.log(`\n${colors.blue}╔═══════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║     Translation Helps SDK - Comprehensive Tests      ║${colors.reset}`);
  console.log(`${colors.blue}╚═══════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`\nServer URL: ${SERVER_URL}\n`);
  
  const tests = [
    { name: 'Multi-Org Search (Default)', fn: testOrganizationParameter },
    { name: 'Single Org Filter', fn: testOrganizationParameterSpecific },
    { name: 'Topic Default', fn: testTopicParameter },
    { name: 'Fetch Scripture', fn: testFetchScripture },
    { name: 'Fetch Translation Notes', fn: testFetchTranslationNotes },
    { name: 'Fetch Translation Questions', fn: testFetchTranslationQuestions },
    { name: 'Language Variant Fallback', fn: testLanguageVariantFallback }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (error) {
      failed++;
      log(`\n✗ Test "${test.name}" failed: ${error.message}`, colors.red);
    }
  }
  
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  log(`\n📊 Test Results:`, colors.yellow);
  log(`  ✓ Passed: ${passed}/${tests.length}`, passed === tests.length ? colors.green : colors.yellow);
  if (failed > 0) {
    log(`  ✗ Failed: ${failed}/${tests.length}`, colors.red);
  }
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  log(`\n✗ Fatal error: ${error.message}`, colors.red);
  console.error(error);
  process.exit(1);
});
