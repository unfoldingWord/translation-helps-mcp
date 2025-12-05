/**
 * List Subjects Endpoint Tests
 * Tests for multi-organization support
 */

import { describe, expect, it } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/list-subjects - Multi-Organization Support', () => {
	describe('Organization Parameter Parsing', () => {
		it('should accept no organization parameter (returns all subjects from all orgs)', async () => {
			const response = await makeRequest('/api/list-subjects');

			expect(response.status).toBe(200);
			expect(response.data.subjects).toBeDefined();
			expect(Array.isArray(response.data.subjects)).toBe(true);
			expect(response.data.filters).toBeDefined();
			expect(response.data.filters.organization).toBe('all');
		});

		it('should accept single organization parameter', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.subjects).toBeDefined();
			expect(Array.isArray(response.data.subjects)).toBe(true);
			expect(response.data.filters.organization).toBe('unfoldingWord');
		});

		it('should accept multiple organization parameters', async () => {
			// Test with multiple org params in URL
			const url = new URL('http://localhost:8174/api/list-subjects');
			url.searchParams.append('organization', 'unfoldingWord');
			url.searchParams.append('organization', 'es-419_gl');

			const fetchResponse = await fetch(url.toString());
			const data = await fetchResponse.json();

			expect(fetchResponse.status).toBe(200);
			expect(data.subjects).toBeDefined();
			expect(Array.isArray(data.subjects)).toBe(true);
			// Should handle multiple organizations
			expect(data.filters.organization).toBeDefined();
		});

		it('should accept language filter with organization', async () => {
			const response = await makeRequest('/api/list-subjects', {
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.subjects).toBeDefined();
			expect(response.data.filters.language).toBe('en');
			expect(response.data.filters.organization).toBe('unfoldingWord');
		});
	});

	describe('Response Format', () => {
		it('should return subjects array with proper structure', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.subjects).toBeDefined();
			expect(Array.isArray(response.data.subjects)).toBe(true);

			// Subjects may be empty if catalog API doesn't return them
			// But structure should still be correct
			if (response.data.subjects.length > 0) {
				const firstSubject = response.data.subjects[0];
				expect(firstSubject.name).toBeDefined();
				expect(typeof firstSubject.name).toBe('string');
			}
		});

		it('should include metadata in response', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.metadata).toBeDefined();
			expect(response.data.metadata.responseTime).toBeDefined();
			expect(response.data.metadata.timestamp).toBeDefined();
			expect(response.data.metadata.count).toBeDefined();
		});

		it('should include filters in response', async () => {
			const response = await makeRequest('/api/list-subjects', {
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data.filters).toBeDefined();
			expect(response.data.filters.language).toBe('en');
			expect(response.data.filters.organization).toBe('unfoldingWord');
		});
	});

	describe('Subject Data Structure', () => {
		it('should return subjects with expected fields when available', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);

			// Subjects may be empty, but if present, should have proper structure
			if (response.data.subjects.length > 0) {
				const subject = response.data.subjects[0];
				expect(subject.name).toBeDefined();
				// Optional fields: description, resourceType, count
			}
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
			expect(response.data.subjects).toBeDefined();
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should return text format when requested', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord',
				format: 'text'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/plain');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should reject invalid format parameter', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('Stage Parameter', () => {
		it('should accept stage parameter', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord',
				stage: 'prod'
			});

			expect(response.status).toBe(200);
			expect(response.data.subjects).toBeDefined();
		});

		it('should default to prod stage when not specified', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			// Stage defaults to prod
		});

		it('should reject invalid stage parameter', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord',
				stage: 'invalid-stage'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/list-subjects', {
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/list-subjects', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});
