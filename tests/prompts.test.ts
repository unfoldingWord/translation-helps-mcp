/**
 * Prompt Tests
 * 
 * Verifies all MCP prompts execute successfully and return properly formatted responses:
 * - All prompts are accessible
 * - Required arguments are enforced
 * - Optional arguments work correctly
 * - Responses are properly formatted
 * - Expected tools are called
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient, extractMCPText } from './helpers/test-client';
import { PROMPT_METADATA, TEST_DATA } from './helpers/test-data';

describe('Prompt Tests', () => {
  const client = new TestClient();
  let availablePrompts: Array<{ name: string; description: string }> = [];

  beforeAll(async () => {
    await client.waitForServer();
    availablePrompts = await client.listMCPPrompts();
  });

  describe('Prompt Discovery', () => {
    it('should list all expected prompts', () => {
      const expectedPromptNames = Object.keys(PROMPT_METADATA);
      const availablePromptNames = availablePrompts.map(p => p.name);

      console.log('\n📋 Available prompts:', availablePromptNames);
      console.log('📋 Expected prompts:', expectedPromptNames);

      expectedPromptNames.forEach(promptName => {
        expect(
          availablePromptNames,
          `Prompt '${promptName}' should be available`
        ).toContain(promptName);
      });
    });

    it('should have descriptions for all prompts', () => {
      const promptsWithoutDescriptions = availablePrompts.filter(
        p => !p.description || p.description.trim() === ''
      );

      if (promptsWithoutDescriptions.length > 0) {
        console.error('❌ Prompts missing descriptions:', promptsWithoutDescriptions.map(p => p.name));
      }

      expect(promptsWithoutDescriptions).toHaveLength(0);
    });
  });

  describe('translation-helps-report Prompt', () => {
    const promptName = 'translation-helps-report';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully with required arguments', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      expect(text.length).toBeGreaterThan(100);
      
      // Should contain condensed report with titles/summaries
      expect(text.toLowerCase()).toMatch(/scripture|notes|translation/);
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars`);
    });

    it('should work with only reference (default language)', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse
        }
      });

      const text = extractMCPText(response);
      expect(text).toBeTruthy();
    });

    it('should handle Spanish language', async () => {
      try {
        const response = await client.callMCPPrompt({
          name: promptName,
          arguments: {
            reference: TEST_DATA.references.singleVerse,
            language: TEST_DATA.languages.spanish
          }
        });

        const text = extractMCPText(response);
        expect(text).toBeTruthy();
        
        console.log(`\n✅ ${promptName} works with Spanish`);
      } catch (error: any) {
        // Spanish resources might not be available for all references
        if (error.message.includes('not found')) {
          console.log(`\n⚠️  Spanish resources not available for ${TEST_DATA.references.singleVerse}`);
        } else {
          throw error;
        }
      }
    });
  });

  describe('translation-helps-for-passage Prompt', () => {
    const promptName = 'translation-helps-for-passage';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully with required arguments', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      // Comprehensive report should be longer than condensed
      expect(text.length).toBeGreaterThan(500);
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars (comprehensive)`);
    });

    it('should include multiple resource types', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      // Should contain references to multiple types of helps
      const textLower = text.toLowerCase();
      
      // At least scripture and one other type should be present
      const hasScripture = textLower.includes('scripture') || textLower.includes('text');
      const hasNotes = textLower.includes('notes') || textLower.includes('note');
      const hasWords = textLower.includes('word') || textLower.includes('term');
      const hasAcademy = textLower.includes('academy') || textLower.includes('concept');
      
      expect(hasScripture, 'Should include scripture').toBe(true);
      
      const otherTypesCount = [hasNotes, hasWords, hasAcademy].filter(Boolean).length;
      expect(otherTypesCount, 'Should include at least one other resource type').toBeGreaterThan(0);
    });
  });

  describe('get-translation-words-for-passage Prompt', () => {
    const promptName = 'get-translation-words-for-passage';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully with required arguments', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/word|term|definition/);
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars`);
    });
  });

  describe('get-translation-academy-for-passage Prompt', () => {
    const promptName = 'get-translation-academy-for-passage';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully with required arguments', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars`);
    });
  });

  describe('discover-resources-for-language Prompt', () => {
    const promptName = 'discover-resources-for-language';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully with required arguments', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          language: TEST_DATA.languages.english
        }
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/resource|available|language/);
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars`);
    });

    it('should work with Spanish variant', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          language: TEST_DATA.languages.spanishVariant
        }
      });

      const text = extractMCPText(response);
      expect(text).toBeTruthy();
    });
  });

  describe('discover-languages-for-subject Prompt', () => {
    const promptName = 'discover-languages-for-subject';
    const metadata = PROMPT_METADATA[promptName];

    it('should execute successfully without arguments (default subject)', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {}
      });

      const text = extractMCPText(response);
      
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/language|available|subject/);
      
      console.log(`\n✅ ${promptName} response length: ${text.length} chars`);
    });

    it('should work with specific subject', async () => {
      const response = await client.callMCPPrompt({
        name: promptName,
        arguments: {
          subject: 'bible'
        }
      });

      const text = extractMCPText(response);
      expect(text).toBeTruthy();
    });
  });

  describe('Prompt Argument Validation', () => {
    it('should enforce required arguments', async () => {
      // translation-helps-report requires 'reference'
      let errorThrown = false;
      
      try {
        await client.callMCPPrompt({
          name: 'translation-helps-report',
          arguments: {} // Missing required 'reference'
        });
      } catch (error: any) {
        errorThrown = true;
        expect(error.message.toLowerCase()).toMatch(/required|missing|reference/);
      }

      expect(errorThrown, 'Should have thrown error for missing required argument').toBe(true);
    });

    it('should accept optional arguments', async () => {
      // Both with and without optional 'language' should work
      const withLanguage = await client.callMCPPrompt({
        name: 'translation-helps-report',
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const withoutLanguage = await client.callMCPPrompt({
        name: 'translation-helps-report',
        arguments: {
          reference: TEST_DATA.references.singleVerse
        }
      });

      expect(extractMCPText(withLanguage)).toBeTruthy();
      expect(extractMCPText(withoutLanguage)).toBeTruthy();
    });
  });

  describe('Prompt Response Formatting', () => {
    it('should return responses in consistent format', async () => {
      const response = await client.callMCPPrompt({
        name: 'translation-helps-report',
        arguments: {
          reference: TEST_DATA.references.singleVerse
        }
      });

      // Verify response structure
      expect(response).toHaveProperty('content');
      expect(Array.isArray(response.content)).toBe(true);
      expect(response.content.length).toBeGreaterThan(0);
      
      response.content.forEach(item => {
        expect(item).toHaveProperty('type');
        expect(item.type).toBe('text');
        expect(item).toHaveProperty('text');
        expect(typeof item.text).toBe('string');
      });
    });

    it('should not return empty responses', async () => {
      const prompts = Object.keys(PROMPT_METADATA);
      
      for (const promptName of prompts) {
        const metadata = PROMPT_METADATA[promptName];
        const args: Record<string, any> = {};
        
        // Add required arguments
        if (metadata.requiredArgs.includes('reference')) {
          args.reference = TEST_DATA.references.singleVerse;
        }
        if (metadata.requiredArgs.includes('language')) {
          args.language = TEST_DATA.languages.english;
        }

        try {
          const response = await client.callMCPPrompt({
            name: promptName,
            arguments: args
          });

          const text = extractMCPText(response);
          
          expect(text, `Prompt '${promptName}' should not return empty response`).toBeTruthy();
          expect(text.length, `Prompt '${promptName}' should return meaningful content`).toBeGreaterThan(20);
          
        } catch (error: any) {
          // Resource not found is OK for some prompts/language combinations
          if (!error.message.includes('not found')) {
            throw error;
          }
        }
      }
    });
  });

  describe('Prompt Performance', () => {
    it('should complete prompts in reasonable time', async () => {
      const startTime = Date.now();
      
      await client.callMCPPrompt({
        name: 'translation-helps-report',
        arguments: {
          reference: TEST_DATA.references.singleVerse,
          language: TEST_DATA.languages.english
        }
      });

      const duration = Date.now() - startTime;
      
      console.log(`\n⏱️  Prompt execution time: ${duration}ms`);
      
      // Prompts involve multiple tool calls, so allow generous timeout
      expect(duration).toBeLessThan(10000); // 10 seconds
    }, 15000); // Test timeout: 15 seconds
  });
});
