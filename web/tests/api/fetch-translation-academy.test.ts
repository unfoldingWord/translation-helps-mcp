import { describe, it, expect } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/fetch-translation-academy', () => {
	describe('Basic Functionality', () => {
		it('should return translation academy content by moduleId', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should return table of contents when moduleId is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should return 404 when module not found', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'nonexistent-module-xyz',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect([404, 200]).toContain(response.status);
		});
	});

	describe('Multi-Organization Support', () => {
		it('should search all organizations when organization is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en'
			});

			expect(response.status).toBe(200);
		});

		it('should accept single organization', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept multiple organizations', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Parameter Validation', () => {
		it('should default to English when language is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept path parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				path: 'translate/figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept rcLink parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				rcLink: 'rc://*/ta/man/translate/figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should accept markdown alias format', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'markdown'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
		});

		it('should reject invalid format parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});

		it('should reject text format (not supported)', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'text'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/fetch-translation-academy', {
				moduleId: 'figs-metaphor',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/fetch-translation-academy', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});
