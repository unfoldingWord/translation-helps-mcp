/**
 * Multi-Organization Integration Tests
 * Tests cross-endpoint behavior with different organization parameter combinations
 */

import { describe, expect, it } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8174';

// Helper for multiple organization parameters
async function apiGetWithMultipleOrgs(
	endpoint: string,
	params: Record<string, string | string[] | undefined> = {}
) {
	const url = new URL(`${BASE_URL}${endpoint}`);

	// Handle organization parameter specially (can be array)
	if (params.organization !== undefined) {
		if (Array.isArray(params.organization)) {
			params.organization.forEach((org) => {
				url.searchParams.append('organization', org);
			});
		} else {
			url.searchParams.append('organization', params.organization);
		}
		delete params.organization;
	}

	// Add other params
	Object.entries(params).forEach(([key, value]) => {
		if (value !== undefined) {
			url.searchParams.append(key, String(value));
		}
	});

	const response = await fetch(url.toString());
	const data = await response.json();
	return { status: response.status, data };
}

describe('Multi-Organization Integration Tests', () => {
	describe('Cross-Endpoint Consistency', () => {
		it('should return consistent organization info across endpoints', async () => {
			// Test that organization parameter is handled consistently
			const [scripture, languages, subjects] = await Promise.all([
				makeRequest('/api/fetch-scripture', {
					reference: 'John 3:16',
					language: 'en',
					organization: 'unfoldingWord'
				}),
				makeRequest('/api/list-languages', {
					organization: 'unfoldingWord'
				}),
				makeRequest('/api/list-subjects', {
					language: 'en',
					organization: 'unfoldingWord'
				})
			]);

			expect(scripture.status).toBe(200);
			expect(languages.status).toBe(200);
			expect(subjects.status).toBe(200);

			// All should reference the same organization
			expect(scripture.data.organization).toBe('unfoldingWord');
			expect(languages.data.organization).toBe('unfoldingWord');
			expect(subjects.data.filters.organization).toBe('unfoldingWord');
		});

		it('should handle "all organizations" consistently', async () => {
			const [scripture, languages, subjects] = await Promise.all([
				makeRequest('/api/fetch-scripture', {
					reference: 'John 3:16',
					language: 'en'
					// No organization = all orgs
				}),
				makeRequest('/api/list-languages'),
				makeRequest('/api/list-subjects', {
					language: 'en'
				})
			]);

			expect(scripture.status).toBe(200);
			expect(languages.status).toBe(200);
			expect(subjects.status).toBe(200);

			// All should indicate "all" organizations
			expect(['all', 'unfoldingWord']).toContain(scripture.data.organization);
			expect(languages.data.organization).toBe('all');
			expect(subjects.data.filters.organization).toBe('all');
		});
	});

	describe('Multiple Organizations Parameter', () => {
		it('should parse multiple organization parameters correctly', async () => {
			const response = await apiGetWithMultipleOrgs('/api/list-languages', {
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
			expect(response.data.organization).toBeDefined();
			// Should be array or handle multiple orgs
			expect(
				Array.isArray(response.data.organization) || typeof response.data.organization === 'string'
			).toBe(true);
		});

		it('should handle multiple organizations in fetch-scripture', async () => {
			const response = await apiGetWithMultipleOrgs('/api/fetch-scripture', {
				reference: 'John 3:16',
				language: 'en',
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
			expect(response.data.scripture).toBeDefined();
			expect(Array.isArray(response.data.scripture)).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		it('should handle invalid organization names', async () => {
			const response = await makeRequest('/api/list-languages', {
				organization: 'invalid-org-name-12345'
			});

			// Should either return empty results or handle gracefully
			expect([200, 400, 404]).toContain(response.status);
		});

		it('should handle very long organization names', async () => {
			const longOrgName = 'a'.repeat(200);
			const response = await makeRequest('/api/list-languages', {
				organization: longOrgName
			});

			// Should validate and reject if too long
			expect([200, 400]).toContain(response.status);
		});
	});

	describe('Performance', () => {
		it('should respond quickly for single organization', async () => {
			const start = Date.now();
			const response = await makeRequest('/api/list-languages', {
				organization: 'unfoldingWord'
			});
			const duration = Date.now() - start;

			expect(response.status).toBe(200);
			expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
		});

		it('should handle multiple organizations efficiently', async () => {
			const start = Date.now();
			const response = await apiGetWithMultipleOrgs('/api/list-languages', {
				organization: ['unfoldingWord', 'es-419_gl']
			});
			const duration = Date.now() - start;

			expect(response.status).toBe(200);
			// Multiple orgs might take longer, but should still be reasonable
			expect(duration).toBeLessThan(10000);
		});
	});
});
