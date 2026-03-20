#!/usr/bin/env node
/**
 * Compare MCP Tool Parameters vs REST API Endpoint Parameters
 * Ensures consistency across both interfaces
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Tool to Endpoint mappings
const TOOL_ENDPOINT_MAP = {
  fetchScripture: 'fetch-scripture',
  fetchTranslationNotes: 'fetch-translation-notes',
  fetchTranslationQuestions: 'fetch-translation-questions',
  fetchTranslationWordLinks: 'fetch-translation-word-links',
  getTranslationWord: 'fetch-translation-word',
  fetchTranslationAcademy: 'fetch-translation-academy',
  listLanguages: 'list-languages',
  listSubjects: 'list-subjects',
  listResourcesForLanguage: 'list-resources-for-language',
};

async function extractMCPToolParams(toolName) {
  const toolPath = path.join(rootDir, 'src', 'tools', `${toolName}.ts`);
  try {
    const content = await fs.readFile(toolPath, 'utf-8');
    
    // Extract parameters from Zod schema
    const schemaMatch = content.match(/export const \w+Args = z\.object\({([^}]+)}\);/s);
    if (!schemaMatch) {
      return null;
    }
    
    const paramsBlock = schemaMatch[1];
    const params = [];
    
    // Match each parameter line
    const paramMatches = paramsBlock.matchAll(/(\w+):\s*(\w+)/g);
    for (const match of paramMatches) {
      params.push({
        name: match[1],
        type: match[2],
      });
    }
    
    return params;
  } catch (error) {
    return null;
  }
}

async function extractEndpointParams(endpointName) {
  // Check common params first
  const commonParamsPath = path.join(rootDir, 'ui', 'src', 'lib', 'commonValidators.ts');
  const endpointsPath = path.join(rootDir, 'src', 'config', 'endpoints');
  
  try {
    // Try to find in endpoint configs
    const files = await fs.readdir(endpointsPath);
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      
      const content = await fs.readFile(path.join(endpointsPath, file), 'utf-8');
      
      // Look for this endpoint's config
      const configPattern = new RegExp(`name:\\s*["']${endpointName}["']`, 'g');
      if (!configPattern.test(content)) continue;
      
      // Extract params from config or REFERENCE_PARAMS/TERM_PARAMS
      const params = [];
      
      // Look for params object
      const paramsMatch = content.match(/params:\s*{([^}]+)}/s) || content.match(/params:\s*(\w+_PARAMS)/);
      if (paramsMatch) {
        if (paramsMatch[1].includes(':')) {
          // Inline params
          const paramLines = paramsMatch[1].split(',');
          for (const line of paramLines) {
            const nameMatch = line.match(/(\w+):/);
            if (nameMatch) {
              params.push({ name: nameMatch[1] });
            }
          }
        } else {
          // Reference to shared params (e.g., REFERENCE_PARAMS)
          const sharedParamsName = paramsMatch[1];
          const sharedMatch = content.match(new RegExp(`const ${sharedParamsName} = {([^}]+)}`, 's'));
          if (sharedMatch) {
            const paramLines = sharedMatch[1].split(',');
            for (const line of paramLines) {
              const nameMatch = line.match(/(\w+):/);
              if (nameMatch) {
                params.push({ name: nameMatch[1] });
              }
            }
          }
        }
      }
      
      return params;
    }
    
    return null;
  } catch (error) {
    console.error(`Error extracting endpoint params for ${endpointName}:`, error.message);
    return null;
  }
}

async function compareParameters() {
  console.log('🔍 Comparing MCP Tool Parameters vs REST API Endpoint Parameters\n');
  console.log('=' .repeat(80));
  
  let mismatches = 0;
  let matches = 0;
  
  for (const [toolName, endpointName] of Object.entries(TOOL_ENDPOINT_MAP)) {
    console.log(`\n📋 ${toolName} ↔️  ${endpointName}`);
    console.log('-'.repeat(80));
    
    const mcpParams = await extractMCPToolParams(toolName);
    const restParams = await extractEndpointParams(endpointName);
    
    if (!mcpParams) {
      console.log(`  ⚠️  Could not extract MCP tool params`);
      continue;
    }
    
    if (!restParams) {
      console.log(`  ⚠️  Could not extract REST endpoint params`);
      continue;
    }
    
    // Compare parameters
    const mcpParamNames = new Set(mcpParams.map(p => p.name));
    const restParamNames = new Set(restParams.map(p => p.name));
    
    const onlyInMCP = [...mcpParamNames].filter(n => !restParamNames.has(n));
    const onlyInREST = [...restParamNames].filter(n => !mcpParamNames.has(n));
    
    if (onlyInMCP.length === 0 && onlyInREST.length === 0) {
      console.log(`  ✅ Parameters match (${mcpParamNames.size} params)`);
      console.log(`     ${[...mcpParamNames].join(', ')}`);
      matches++;
    } else {
      console.log(`  ❌ Parameter mismatch detected!`);
      
      if (onlyInMCP.length > 0) {
        console.log(`     🔴 Only in MCP: ${onlyInMCP.join(', ')}`);
      }
      
      if (onlyInREST.length > 0) {
        console.log(`     🔵 Only in REST: ${onlyInREST.join(', ')}`);
      }
      
      console.log(`     MCP params:  ${[...mcpParamNames].join(', ')}`);
      console.log(`     REST params: ${[...restParamNames].join(', ')}`);
      mismatches++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Matching: ${matches}`);
  console.log(`   ❌ Mismatches: ${mismatches}`);
  
  if (mismatches > 0) {
    console.log(`\n⚠️  Found ${mismatches} mismatches. Please update the endpoint configs.`);
    process.exit(1);
  } else {
    console.log(`\n✨ All MCP tools and REST endpoints have matching parameters!`);
    process.exit(0);
  }
}

compareParameters().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
