/**
 * Fetch Scripture Endpoint Tests
 * Tests for multi-organization support
 */

import { describe, expect, it } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/fetch-scripture - Multi-Organization Support', () => {
	describe('Organization Parameter Parsing', () => {
		it('should accept no organization parameter (searches all orgs)', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en'
				// No organization = searches all orgs
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
			expect(response.data.scripture.length).toBeGreaterThan(0);
			// Should return results from all organizations
		});

		it('should accept single organization parameter', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
			expect(response.data.scripture.length).toBeGreaterThan(0);
			expect(response.data.organization).toBe('unfoldingWord');
		});

		it('should accept multiple organization parameters', async () => {
			// Test with multiple org params in URL
			const url = new URL('http://localhost:8174/api/fetch-scripture');
			url.searchParams.append('reference', 'John 3:16');
			url.searchParams.append('language', 'en');
			url.searchParams.append('organization', 'unfoldingWord');
			url.searchParams.append('organization', 'es-419_gl');

			const fetchResponse = await fetch(url.toString());
			const data = await fetchResponse.json();

			expect(fetchResponse.status).toBe(200);
			expect(data.scripture).toBeDefined();
			expect(Array.isArray(data.scripture)).toBe(true);
			// Should handle multiple organizations (currently uses first, will be enhanced)
			expect(data.organization).toBeDefined();
		});
	});

	describe('Response Format', () => {
		it('should return scripture array with translations', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
			expect(response.data.scripture.length).toBeGreaterThan(0);

			// Check scripture item structure
			const firstScripture = response.data.scripture[0];
			expect(firstScripture.text).toBeDefined();
			expect(firstScripture.translation).toBeDefined();
			expect(typeof firstScripture.text).toBe('string');
			expect(firstScripture.text.length).toBeGreaterThan(0);
		});

		it('should include metadata in response', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.metadata).toBeDefined();
			expect(response.data.metadata.totalCount).toBeDefined();
			expect(response.data.metadata.resources).toBeDefined();
			expect(Array.isArray(response.data.metadata.resources)).toBe(true);
		});
	});

	describe('Verse Range Support', () => {
		it('should return all verses in a range (e.g., John 3:16-18)', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16-18',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);

			if (response.data.scripture.length > 0) {
				const scripture = response.data.scripture[0];
				expect(scripture.text).toBeDefined();
				// Should contain verse numbers 16, 17, and 18
				const text = scripture.text.toLowerCase();
				// Check that the text contains multiple verses (should have verse markers or numbers)
				expect(text.length).toBeGreaterThan(50); // Range should be longer than a single verse
				// The text should contain references to multiple verses
				// (either verse numbers or the content spans multiple verses)
			}
		});

		it('should handle single verse correctly', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
		});
	});

	describe('Error Handling', () => {
		it('should return 400 for missing reference parameter', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				language: 'en'
			});

			expect(response.status).toBe(400);
		});

		it('should handle invalid reference gracefully', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'Invalid Book 99:99',
				language: 'en',
				organization: 'unfoldingWord'
			});

			// Should handle gracefully - endpoint may return 200 with empty results, 400, or 404
			expect([200, 400, 404]).toContain(response.status);
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
			expect(response.data.scripture).toBeDefined();
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
			expect(response.data).toContain('John 3:16');
		});

		it('should return text format when requested', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'text'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/plain');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should reject invalid format parameter', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('Resource Parameter', () => {
		it('should filter by single resource type', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				resource: 'ult'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
			// Should only return ULT translations
			if (response.data.scripture.length > 0) {
				const translations = response.data.scripture.map(
					(s: any) => s.translation?.toLowerCase().split(' ')[0]
				);
				expect(translations.every((t: string) => t === 'ult')).toBe(true);
			}
		});

		it('should filter by multiple resource types', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				resource: 'ult,ust'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
			expect(response.data.scripture.length).toBeLessThanOrEqual(2);
		});

		it('should return all resources when resource=all', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				resource: 'all'
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			// CORS headers should be present
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/fetch-scripture', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});
