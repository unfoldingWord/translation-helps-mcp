import { describe, it, expect } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/fetch-translation-word-links', () => {
	describe('Basic Functionality', () => {
		it('should return translation word links for a valid reference', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should handle references with no word links gracefully', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'Invalid Book 99:99',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect([200, 404]).toContain(response.status);
		});
	});

	describe('Multi-Organization Support', () => {
		it('should search all organizations when organization is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en'
			});

			expect(response.status).toBe(200);
		});

		it('should accept single organization', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept multiple organizations', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Parameter Validation', () => {
		it('should return 400 for missing reference parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				language: 'en'
			});

			expect(response.status).toBe(400);
		});

		it('should return 400 for invalid reference format', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'invalid',
				language: 'en'
			});

			expect(response.status).toBe(400);
		});

		it('should default to English when language is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
		});

		it('should return TSV format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'tsv'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/plain'); // TSV is text/plain
			expect(typeof response.data).toBe('string');
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
		});

		it('should accept markdown alias format', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'markdown'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
		});

		it('should reject invalid format parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});

		it('should reject text format (not supported)', async () => {
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
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
			const response = await makeRequest('/api/fetch-translation-word-links', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/fetch-translation-word-links', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});








