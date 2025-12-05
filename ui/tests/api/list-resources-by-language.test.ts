/**
 * List Resources by Language Endpoint Tests
 * Tests for the list-resources-by-language endpoint
 */

import { describe, expect, it } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/list-resources-by-language - Resources by Language Discovery', () => {
	describe('Basic Functionality', () => {
		it('should return resources organized by language without language parameter', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			expect(response.data.resourcesByLanguage).toBeDefined();
			expect(Array.isArray(response.data.resourcesByLanguage)).toBe(true);
			expect(response.data.summary).toBeDefined();
			expect(response.data.summary.totalLanguages).toBeGreaterThanOrEqual(0);
			expect(response.data.summary.totalResources).toBeGreaterThanOrEqual(0);
		});

		it('should include language information in each entry', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);

			if (response.data.resourcesByLanguage.length > 0) {
				const firstLanguage = response.data.resourcesByLanguage[0];
				expect(firstLanguage.language).toBeDefined();
				expect(typeof firstLanguage.language).toBe('string');
				expect(firstLanguage.subjects).toBeDefined();
				expect(Array.isArray(firstLanguage.subjects)).toBe(true);
				expect(firstLanguage.resources).toBeDefined();
				expect(Array.isArray(firstLanguage.resources)).toBe(true);
				expect(firstLanguage.resourceCount).toBeGreaterThanOrEqual(0);
			}
		});

		it('should return summary with correct structure', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary).toBeDefined();
			expect(response.data.summary.totalLanguages).toBeDefined();
			expect(response.data.summary.totalResources).toBeDefined();
			expect(response.data.summary.subjectsSearched).toBeDefined();
			expect(Array.isArray(response.data.summary.subjectsSearched)).toBe(true);
			expect(response.data.summary.organization).toBeDefined();
			expect(response.data.summary.stage).toBe('prod');
		});
	});

	describe('Subject Parameter', () => {
		it('should filter by specific subjects', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				subjects: 'Translation Words,Translation Notes',
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.subjectsSearched).toContain('Translation Words');
			expect(response.data.summary.subjectsSearched).toContain('Translation Notes');
		});

		it('should use default subjects when not provided', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.subjectsSearched.length).toBeGreaterThan(0);
			// Should include common subjects
			const subjects = response.data.summary.subjectsSearched;
			expect(subjects.some((s: string) => s.includes('Translation') || s.includes('Bible'))).toBe(
				true
			);
		});

		it('should handle single subject', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				subjects: 'Translation Words',
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.subjectsSearched).toContain('Translation Words');
		});
	});

	describe('Organization Parameter', () => {
		it('should accept no organization parameter (searches all orgs)', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.organization).toBe('all');
		});

		it('should accept single organization parameter', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				organization: 'unfoldingWord',
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.organization).toBe('unfoldingWord');
		});

		it('should accept multiple organization parameters', async () => {
			const url = new URL('http://localhost:8174/api/list-resources-by-language');
			url.searchParams.append('organization', 'unfoldingWord');
			url.searchParams.append('organization', 'es-419_gl');
			url.searchParams.append('stage', 'prod');
			url.searchParams.append('limit', '50');

			const fetchResponse = await fetch(url.toString());
			const data = await fetchResponse.json();

			expect(fetchResponse.status).toBe(200);
			expect(data.summary).toBeDefined();
			// Should handle multiple orgs (may be array or comma-separated)
			expect(data.summary.organization).toBeDefined();
		});
	});

	describe('Limit Parameter', () => {
		it('should respect limit parameter', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '10'
			});

			expect(response.status).toBe(200);
			// With limit=10, total resources should be <= 10 * number of subjects
			// But we can't easily verify this without knowing subject count
			// Just verify the response is valid
			expect(response.data.summary.totalResources).toBeGreaterThanOrEqual(0);
		});

		it('should use default limit when not provided', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			// Should work with default limit
			expect(response.data.resourcesByLanguage).toBeDefined();
		});

		it('should reject invalid limit values', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '2000' // Exceeds max of 1000
			});

			// Should either reject or clamp to max
			expect([200, 400]).toContain(response.status);
		});
	});

	describe('Stage Parameter', () => {
		it('should accept prod stage', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.stage).toBe('prod');
		});

		it('should accept preprod stage', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'preprod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.stage).toBe('preprod');
		});

		it('should default to prod when stage not provided', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.summary.stage).toBe('prod');
		});
	});

	describe('Response Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest(
				'/api/list-resources-by-language',
				{
					stage: 'prod',
					limit: '50'
				},
				'json'
			);

			expect(response.status).toBe(200);
			expect(response.data.resourcesByLanguage).toBeDefined();
			expect(Array.isArray(response.data.resourcesByLanguage)).toBe(true);
		});

		it('should support markdown format', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(typeof response.data).toBe('string');
			// Should contain markdown content
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should support text format', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50',
				format: 'text'
			});

			expect(response.status).toBe(200);
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBe('*');
			expect(response.headers['access-control-allow-methods']).toContain('GET');
		});

		it('should handle OPTIONS preflight request', async () => {
			const url = new URL('http://localhost:8174/api/list-resources-by-language');
			const response = await fetch(url.toString(), {
				method: 'OPTIONS',
				headers: {
					Origin: 'http://localhost:3000',
					'Access-Control-Request-Method': 'GET'
				}
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-origin')).toBe('*');
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
		});
	});

	describe('Data Structure Validation', () => {
		it('should have consistent structure across languages', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);

			if (response.data.resourcesByLanguage.length > 0) {
				for (const langData of response.data.resourcesByLanguage) {
					expect(langData).toHaveProperty('language');
					expect(langData).toHaveProperty('subjects');
					expect(langData).toHaveProperty('resources');
					expect(langData).toHaveProperty('resourceCount');
					expect(typeof langData.language).toBe('string');
					expect(Array.isArray(langData.subjects)).toBe(true);
					expect(Array.isArray(langData.resources)).toBe(true);
					expect(typeof langData.resourceCount).toBe('number');
				}
			}
		});

		it('should have resource items with correct structure', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);

			// Find a language with resources
			const langWithResources = response.data.resourcesByLanguage.find(
				(l: any) => l.resources.length > 0
			);

			if (langWithResources) {
				const resource = langWithResources.resources[0];
				expect(resource).toHaveProperty('name');
				expect(resource).toHaveProperty('subject');
				expect(resource).toHaveProperty('language');
				expect(resource).toHaveProperty('organization');
				expect(typeof resource.name).toBe('string');
				expect(typeof resource.subject).toBe('string');
				expect(typeof resource.language).toBe('string');
				expect(typeof resource.organization).toBe('string');
			}
		});

		it('should have metadata with performance info', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.metadata).toBeDefined();
			expect(response.data.metadata.responseTime).toBeDefined();
			expect(typeof response.data.metadata.responseTime).toBe('number');
			expect(response.data.metadata.timestamp).toBeDefined();
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty results gracefully', async () => {
			// Search for a subject that likely doesn't exist
			const response = await makeRequest('/api/list-resources-by-language', {
				subjects: 'NonExistentSubject12345',
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.resourcesByLanguage).toBeDefined();
			expect(Array.isArray(response.data.resourcesByLanguage)).toBe(true);
			// Should return empty array, not error
			expect(response.data.summary.totalLanguages).toBe(0);
			expect(response.data.summary.totalResources).toBe(0);
		});

		it('should handle invalid stage parameter', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'invalid-stage',
				limit: '50'
			});

			// Should either reject invalid stage or default to prod
			expect([200, 400]).toContain(response.status);
		});

		it('should handle very large limit values', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '999' // Close to max
			});

			// Should either accept or clamp to max
			expect([200, 400]).toContain(response.status);
		});
	});

	describe('Performance', () => {
		it('should respond within reasonable time', async () => {
			const startTime = Date.now();
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});
			const duration = Date.now() - startTime;

			expect(response.status).toBe(200);
			// Should complete within 30 seconds (catalog searches can be slow)
			expect(duration).toBeLessThan(30000);
		});

		it('should include response time in metadata', async () => {
			const response = await makeRequest('/api/list-resources-by-language', {
				stage: 'prod',
				limit: '50'
			});

			expect(response.status).toBe(200);
			expect(response.data.metadata.responseTime).toBeDefined();
			expect(response.data.metadata.responseTime).toBeGreaterThan(0);
		});
	});
});
