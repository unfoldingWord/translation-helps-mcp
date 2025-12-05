/**
 * External API Contract Tests
 *
 * These tests verify that the git.door43.org API endpoints we depend on
 * maintain their expected contracts. This helps detect breaking changes
 * in the external API before they cause production issues.
 *
 * These are NOT integration tests - they're contract verification tests
 * that can be run periodically to ensure API compatibility.
 */

import { describe, it, expect } from 'vitest';

const DCS_BASE_URL = 'https://git.door43.org/api/v1';

describe('Door43 Catalog API Contracts', () => {
	describe('/catalog/list/languages', () => {
		it('should return expected response structure', async () => {
			const response = await fetch(`${DCS_BASE_URL}/catalog/list/languages?stage=prod`);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify response structure
			expect(data).toHaveProperty('data');
			expect(Array.isArray(data.data)).toBe(true);

			// If languages are returned, verify structure of first item
			if (data.data.length > 0) {
				const lang = data.data[0];
				// Common fields (some may be optional)
				expect(lang).toHaveProperty('lc'); // language code
				// Other fields may be optional: ln, ang, ld, lr, hc, cc, alt, gw
			}
		});

		it('should accept stage parameter', async () => {
			const response = await fetch(`${DCS_BASE_URL}/catalog/list/languages?stage=prod`);
			expect(response.status).toBe(200);
		});

		it('should accept owner parameter', async () => {
			const response = await fetch(
				`${DCS_BASE_URL}/catalog/list/languages?stage=prod&owner=unfoldingWord`
			);
			expect(response.status).toBe(200);
		});
	});

	describe('/catalog/list/subjects', () => {
		it('should return expected response structure', async () => {
			const response = await fetch(`${DCS_BASE_URL}/catalog/list/subjects?stage=prod`);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify response structure
			expect(data).toHaveProperty('data');
			expect(Array.isArray(data.data)).toBe(true);

			// If subjects are returned, verify structure
			if (data.data.length > 0) {
				const subject = data.data[0];
				expect(subject).toHaveProperty('name');
				// Optional fields: description, count
			}
		});

		it('should accept language filter', async () => {
			const response = await fetch(`${DCS_BASE_URL}/catalog/list/subjects?stage=prod&lang=en`);
			expect(response.status).toBe(200);
		});

		it('should accept owner parameter', async () => {
			const response = await fetch(
				`${DCS_BASE_URL}/catalog/list/subjects?stage=prod&owner=unfoldingWord`
			);
			expect(response.status).toBe(200);
		});
	});

	describe('/catalog/search', () => {
		it('should return expected response structure', async () => {
			const response = await fetch(
				`${DCS_BASE_URL}/catalog/search?stage=prod&lang=en&owner=unfoldingWord&subject=Bible&limit=10`
			);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify response structure
			expect(data).toHaveProperty('data');
			expect(Array.isArray(data.data)).toBe(true);

			// If results are returned, verify structure
			if (data.data.length > 0) {
				const resource = data.data[0];
				expect(resource).toHaveProperty('name');
				expect(resource).toHaveProperty('owner');
				// Optional fields: catalog, subject, ingredients, etc.
			}
		});

		it('should accept multiple query parameters', async () => {
			const params = new URLSearchParams({
				stage: 'prod',
				lang: 'en',
				owner: 'unfoldingWord',
				subject: 'Bible',
				limit: '5'
			});

			const response = await fetch(`${DCS_BASE_URL}/catalog/search?${params}`);
			expect(response.status).toBe(200);
		});

		it('should handle metadataType parameter', async () => {
			const response = await fetch(
				`${DCS_BASE_URL}/catalog/search?stage=prod&metadataType=rc&lang=en&owner=unfoldingWord`
			);
			expect(response.status).toBe(200);
		});
	});

	describe('/catalog/list/owners', () => {
		it('should return expected response structure', async () => {
			const response = await fetch(`${DCS_BASE_URL}/catalog/list/owners?stage=prod`);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify response structure
			expect(data).toHaveProperty('data');
			expect(Array.isArray(data.data)).toBe(true);

			// If owners are returned, verify structure
			if (data.data.length > 0) {
				const owner = data.data[0];
				expect(typeof owner).toBe('string'); // Owners are typically strings
			}
		});
	});

	describe('ZIP Archive Endpoints', () => {
		it('should serve ZIP archives for valid repositories', async () => {
			// Test with a known repository
			const zipUrl = 'https://git.door43.org/unfoldingWord/en_ult/archive/master.zip';
			const response = await fetch(zipUrl);

			// Should return 200 or 302 (redirect) or 404 if repo doesn't exist
			expect([200, 302, 404]).toContain(response.status);

			if (response.ok || response.status === 302) {
				// If successful, verify it's a ZIP file
				const contentType = response.headers.get('content-type');
				if (contentType) {
					expect(contentType).toMatch(/zip|octet-stream/);
				}
			}
		});
	});

	describe('Raw File Endpoints', () => {
		it('should serve raw files for valid paths', async () => {
			// Test with a known file path
			const rawUrl = 'https://git.door43.org/unfoldingWord/en_ult/raw/branch/master/57-TIT.usfm';
			const response = await fetch(rawUrl);

			// Should return 200 or 404 if file doesn't exist
			expect([200, 404]).toContain(response.status);

			if (response.ok) {
				const text = await response.text();
				expect(text.length).toBeGreaterThan(0);
			}
		});
	});

	describe('API Health', () => {
		it('should respond to version endpoint', async () => {
			const response = await fetch('https://git.door43.org/api/v1/version');

			expect(response.status).toBe(200);
			const data = await response.json();

			// Version endpoint should return version info
			expect(data).toBeDefined();
		});
	});
});
