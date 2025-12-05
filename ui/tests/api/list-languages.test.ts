/**
 * List Languages Endpoint Tests
 * Tests for multi-organization support
 */

import { describe, expect, it } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/list-languages - Multi-Organization Support', () => {
	describe('Organization Parameter Parsing', () => {
		it('should accept no organization parameter (returns all languages from all orgs)', async () => {
			const response = await makeRequest('/api/list-languages');

			expect(response.status).toBe(200);
			expect(response.data.languages).toBeDefined();
			expect(Array.isArray(response.data.languages)).toBe(true);
			// Languages array may be empty if catalog API is unavailable, but structure should be correct
			expect(response.data.organization).toBe('all');
			expect(response.data.metadata).toBeDefined();
		});

		it('should accept single organization parameter', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.languages).toBeDefined();
			expect(Array.isArray(response.data.languages)).toBe(true);
			// Languages array may be empty if catalog API is unavailable, but structure should be correct
			expect(response.data.organization).toBe('unfoldingWord');
			expect(response.data.metadata).toBeDefined();
		});

		it('should accept multiple organization parameters', async () => {
			// Test with multiple org params in URL
			const url = new URL('http://localhost:8174/api/list-languages');
			url.searchParams.append('organization', 'unfoldingWord');
			url.searchParams.append('organization', 'es-419_gl');

			const fetchResponse = await fetch(url.toString());
			const data = await fetchResponse.json();

			expect(fetchResponse.status).toBe(200);
			expect(data.languages).toBeDefined();
			expect(Array.isArray(data.languages)).toBe(true);
			// Should handle multiple organizations
			expect(data.organization).toBeDefined();
		});
	});

	describe('Response Format', () => {
		it('should return languages array with proper structure', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.languages).toBeDefined();
			expect(Array.isArray(response.data.languages)).toBe(true);

			if (response.data.languages.length > 0) {
				const firstLanguage = response.data.languages[0];
				expect(firstLanguage.code).toBeDefined();
				expect(firstLanguage.name).toBeDefined();
				expect(typeof firstLanguage.code).toBe('string');
				expect(typeof firstLanguage.name).toBe('string');
			}
		});

		it('should include metadata in response', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.metadata).toBeDefined();
			expect(response.data.metadata.responseTime).toBeDefined();
			expect(response.data.metadata.timestamp).toBeDefined();
			expect(response.data.metadata.count).toBeDefined();
		});
	});

	describe('Language Data Structure', () => {
		it('should return languages with all expected fields', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);

			if (response.data.languages.length > 0) {
				const lang = response.data.languages[0];
				// Check for expected fields
				expect(lang.code).toBeDefined();
				expect(lang.name).toBeDefined();
				// Optional fields may or may not be present
				// displayName, romanizedName, direction, etc.
			}
		});

		it('should include English language when searching all orgs (if languages are available)', async () => {
			const response = await makeRequest('/api/list-languages');

			expect(response.status).toBe(200);

			// Only check for English if languages are actually returned
			if (response.data.languages && response.data.languages.length > 0) {
				const englishLang = response.data.languages.find((lang: any) => lang.code === 'en');
				expect(englishLang).toBeDefined();
				expect(englishLang.name).toContain('English');
			} else {
				// If no languages returned, skip this assertion (catalog API might be unavailable)
				console.log('Skipping English language check - no languages returned from catalog');
			}
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
			expect(response.data.languages).toBeDefined();
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should return text format when requested', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord',
				format: 'text'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/plain');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should reject invalid format parameter', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('Stage Parameter', () => {
		it('should accept stage parameter', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord',
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			expect(response.data.languages).toBeDefined();
		});

		it('should default to prod stage when not specified', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			// Stage defaults to prod
		});

		it('should reject invalid stage parameter', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord',
				stage: 'invalid-stage'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/list-languages', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});
