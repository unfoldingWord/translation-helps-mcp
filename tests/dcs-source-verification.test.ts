/**
 * DCS Source of Truth Verification Tests
 * 
 * These tests verify that our API responses match the actual data
 * available in the Door43 Content Service (DCS) catalog.
 * 
 * This ensures we're not:
 * - Returning resources that don't exist in DCS
 * - Failing to find resources that DO exist in DCS
 * - Returning incorrect metadata (language, organization)
 * - Auto-discovering variants that don't exist in DCS
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient } from './helpers/test-client';
import {
  dcsResourceExists,
  dcsScriptureExists,
  dcsAcademyExists,
  dcsWordExists,
  dcsGetLanguages,
  dcsGetLanguageVariants,
  comparewithDCS,
} from './helpers/dcs-client';

const client = new TestClient();

describe('DCS Source of Truth Verification', () => {
  beforeAll(async () => {
    await client.waitForServer();
  });

  describe('Language Discovery Validation', () => {
    it('should only list languages that exist in DCS catalog', async () => {
      // Get languages from our API
      const ourResponse = await client.callREST('/api/list-languages');
      expect(ourResponse.statusCode).toBe(200);
      expect(ourResponse.body.languages).toBeDefined();

      // Get languages from DCS
      const dcsLanguages = await dcsGetLanguages();

      // Every language we return should exist in DCS
      const ourLanguages = ourResponse.body.languages.map((l: any) => l.code);
      const missingInDCS = ourLanguages.filter((code: string) => 
        !dcsLanguages.includes(code)
      );

      expect(missingInDCS).toEqual([]);
    });

    it('should discover language variants that actually exist in DCS', async () => {
      // Test Spanish variant discovery
      const dcsSpanishVariants = await dcsGetLanguageVariants('es');
      
      // Try fetching with base language 'es'
      const ourResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'John 1:1',
        language: 'es',
        organization: 'unfoldingWord',
      });

      if (ourResponse.statusCode === 200) {
        const actualLanguage = ourResponse.body.metadata?.language;
        
        // If we found it, the language should be in DCS variants
        expect(dcsSpanishVariants).toContain(actualLanguage);
      } else if (ourResponse.statusCode === 404) {
        // If we didn't find it, DCS shouldn't have Spanish variants for this org
        const dcsHasSpanish = await dcsScriptureExists({
          language: 'es',
          organization: 'unfoldingWord'
        });

        const dcsHasSpanishVariants = await Promise.all(
          dcsSpanishVariants.map(variant => 
            dcsScriptureExists({ language: variant, organization: 'unfoldingWord' })
          )
        );

        const anySpanishExists = dcsHasSpanish.exists || 
          dcsHasSpanishVariants.some(r => r.exists);

        if (anySpanishExists) {
          throw new Error(
            'We returned 404 but DCS has Spanish scripture for unfoldingWord'
          );
        }
      }
    });
  });

  describe('Scripture Resource Validation', () => {
    it('should find scripture that exists in DCS', async () => {
      // English scripture definitely exists in DCS
      const dcsResult = await dcsScriptureExists({
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(dcsResult.exists).toBe(true);

      // Now check if we can fetch it
      const ourResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'John 3:16',
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(ourResponse.statusCode).toBe(200);
      expect(ourResponse.body.verses).toBeDefined();
      expect(ourResponse.body.verses.length).toBeGreaterThan(0);
    });

    it('should return 404 for scripture that does NOT exist in DCS', async () => {
      // Made-up language code
      const dcsResult = await dcsScriptureExists({
        language: 'xyz123',
        organization: 'unfoldingWord',
      });

      expect(dcsResult.exists).toBe(false);

      // We should also return 404
      const ourResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'John 3:16',
        language: 'xyz123',
        organization: 'unfoldingWord',
      });

      expect(ourResponse.statusCode).toBe(404);
    });

    it('should return metadata matching DCS for scripture', async () => {
      // Fetch scripture
      const ourResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'Genesis 1:1',
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(ourResponse.statusCode).toBe(200);

      // Get DCS data
      const dcsResult = await dcsScriptureExists({
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(dcsResult.exists).toBe(true);

      // Compare metadata
      if (ourResponse.body.metadata) {
        expect(ourResponse.body.metadata.language).toBe(dcsResult.actualLanguage);
        expect(ourResponse.body.metadata.organization).toBe(dcsResult.actualOrganization);
      }
    });
  });

  describe('Translation Academy Validation', () => {
    it('should find Translation Academy articles that exist in DCS', async () => {
      const dcsResult = await dcsAcademyExists({
        path: 'translate/figs-metaphor',
        language: 'en',
        organization: 'unfoldingWord',
      });

      // Check if TA exists at all for this language
      if (!dcsResult.exists) {
        console.warn('DCS does not have en_ta for unfoldingWord, skipping test');
        return;
      }

      // Try fetching from our API
      const ourResponse = await client.callREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(ourResponse.statusCode).toBe(200);
      expect(ourResponse.body.content).toBeDefined();
    });

    it('should return metadata matching DCS for Translation Academy', async () => {
      const ourResponse = await client.callREST('/api/fetch-translation-academy', {
        path: 'translate/translate-unknown',
        language: 'en',
        organization: 'unfoldingWord',
      });

      if (ourResponse.statusCode === 200) {
        const dcsResult = await dcsAcademyExists({
          path: 'translate/translate-unknown',
          language: 'en',
          organization: 'unfoldingWord',
        });

        expect(dcsResult.exists).toBe(true);

        // Metadata should match DCS
        if (ourResponse.body.metadata) {
          expect(ourResponse.body.metadata.language).toBe(dcsResult.actualLanguage);
          expect(ourResponse.body.metadata.organization).toBe(dcsResult.actualOrganization);
        } else {
          throw new Error('Response missing metadata object');
        }
      }
    });
  });

  describe('Translation Word Validation', () => {
    it('should find Translation Words that exist in DCS', async () => {
      const dcsResult = await dcsWordExists({
        path: 'kt/god',
        language: 'en',
        organization: 'unfoldingWord',
      });

      // Check if TW exists at all for this language
      if (!dcsResult.exists) {
        console.warn('DCS does not have en_tw for unfoldingWord, skipping test');
        return;
      }

      // Try fetching from our API
      const ourResponse = await client.callREST('/api/fetch-translation-word', {
        path: 'kt/god',
        language: 'en',
        organization: 'unfoldingWord',
      });

      expect(ourResponse.statusCode).toBe(200);
      expect(ourResponse.body.content).toBeDefined();
    });

    it('should return metadata matching DCS for Translation Word', async () => {
      const ourResponse = await client.callREST('/api/fetch-translation-word', {
        path: 'kt/jesus',
        language: 'en',
        organization: 'unfoldingWord',
      });

      if (ourResponse.statusCode === 200) {
        const dcsResult = await dcsWordExists({
          path: 'kt/jesus',
          language: 'en',
          organization: 'unfoldingWord',
        });

        expect(dcsResult.exists).toBe(true);

        // Metadata should match DCS
        if (ourResponse.body.metadata) {
          expect(ourResponse.body.metadata.language).toBe(dcsResult.actualLanguage);
          expect(ourResponse.body.metadata.organization).toBe(dcsResult.actualOrganization);
        } else {
          throw new Error('Response missing metadata object');
        }
      }
    });
  });

  describe('Organization Parameter Validation', () => {
    it('should respect organization filter and match DCS results', async () => {
      // Try with specific organization
      const withOrgResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'John 3:16',
        language: 'en',
        organization: 'unfoldingWord',
      });

      // Check DCS
      const dcsWithOrg = await dcsScriptureExists({
        language: 'en',
        organization: 'unfoldingWord',
      });

      if (dcsWithOrg.exists) {
        expect(withOrgResponse.statusCode).toBe(200);
        expect(withOrgResponse.body.metadata?.organization).toBe('unfoldingWord');
      } else {
        expect(withOrgResponse.statusCode).toBe(404);
      }
    });

    it('should search all organizations when parameter empty/missing (matching DCS behavior)', async () => {
      // Try without organization (should search all)
      const withoutOrgResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'John 3:16',
        language: 'en',
      });

      // Check DCS without org filter
      const dcsWithoutOrg = await dcsScriptureExists({
        language: 'en',
        // No organization specified
      });

      if (dcsWithoutOrg.exists) {
        expect(withoutOrgResponse.statusCode).toBe(200);
        // Should return SOME organization from DCS
        expect(withoutOrgResponse.body.metadata?.organization).toBeDefined();
        expect(withoutOrgResponse.body.metadata.organization).toBe(dcsWithoutOrg.actualOrganization);
      } else {
        expect(withoutOrgResponse.statusCode).toBe(404);
      }
    });
  });

  describe('Comprehensive Source Comparison', () => {
    it('should match DCS for English ULT scripture', async () => {
      const ourResponse = await client.callREST('/api/fetch-scripture', {
        reference: 'Matthew 1:1',
        language: 'en',
        organization: 'unfoldingWord',
      });

      const comparison = await comparewithDCS({
        endpoint: '/api/fetch-scripture',
        language: 'en',
        organization: 'unfoldingWord',
        subject: 'Bible',
        ourResponse: ourResponse.body,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });

    it('should match DCS for Translation Academy', async () => {
      const ourResponse = await client.callREST('/api/fetch-translation-academy', {
        path: 'translate/figs-idiom',
        language: 'en',
        organization: 'unfoldingWord',
      });

      const comparison = await comparewithDCS({
        endpoint: '/api/fetch-translation-academy',
        language: 'en',
        organization: 'unfoldingWord',
        subject: 'Translation Academy',
        ourResponse: ourResponse.body,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });

    it('should match DCS for Translation Words', async () => {
      const ourResponse = await client.callREST('/api/fetch-translation-word', {
        path: 'kt/faith',
        language: 'en',
        organization: 'unfoldingWord',
      });

      const comparison = await comparewithDCS({
        endpoint: '/api/fetch-translation-word',
        language: 'en',
        organization: 'unfoldingWord',
        subject: 'Translation Words',
        ourResponse: ourResponse.body,
      });

      expect(comparison.matches).toBe(true);
      expect(comparison.differences).toEqual([]);
    });
  });

  describe('Edge Cases & Data Consistency', () => {
    it('should not hallucinate resources (return data DCS does not have)', async () => {
      // Try fetching resources for a language/org combination that definitely doesn't exist
      const testCases = [
        {
          endpoint: '/api/fetch-scripture',
          params: { reference: 'John 1:1', language: 'zz', organization: 'nonexistent' },
          subject: 'Bible',
        },
        {
          endpoint: '/api/fetch-translation-academy',
          params: { path: 'translate/test', language: 'zz', organization: 'nonexistent' },
          subject: 'Translation Academy',
        },
        {
          endpoint: '/api/fetch-translation-word',
          params: { path: 'kt/test', language: 'zz', organization: 'nonexistent' },
          subject: 'Translation Words',
        },
      ];

      for (const testCase of testCases) {
        const ourResponse = await client.callREST(testCase.endpoint, testCase.params);
        
        const dcsExists = await dcsResourceExists({
          language: testCase.params.language,
          organization: testCase.params.organization,
          subject: testCase.subject,
        });

        if (!dcsExists.exists) {
          // We should return 404
          expect(ourResponse.statusCode).toBe(404);
        }
      }
    });

    it('should not miss resources (fail to find data DCS does have)', async () => {
      // Test with known good resources
      const testCases = [
        {
          endpoint: '/api/fetch-scripture',
          params: { reference: 'Genesis 1:1', language: 'en', organization: 'unfoldingWord' },
          subject: 'Bible',
        },
        {
          endpoint: '/api/fetch-translation-academy',
          params: { path: 'translate/translate-names', language: 'en', organization: 'unfoldingWord' },
          subject: 'Translation Academy',
        },
        {
          endpoint: '/api/fetch-translation-word',
          params: { path: 'kt/grace', language: 'en', organization: 'unfoldingWord' },
          subject: 'Translation Words',
        },
      ];

      for (const testCase of testCases) {
        const dcsExists = await dcsResourceExists({
          language: testCase.params.language,
          organization: testCase.params.organization,
          subject: testCase.subject,
        });

        if (dcsExists.exists) {
          const ourResponse = await client.callREST(testCase.endpoint, testCase.params);
          
          // We should find it
          expect(ourResponse.statusCode).toBe(200);
          expect(ourResponse.body).toBeDefined();
        }
      }
    });
  });
});
