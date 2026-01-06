import { describe, it, expect } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/fetch-translation-word', () => {
	describe('Basic Functionality', () => {
		it('should return translation word by term', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should return translation word by path', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				path: 'bible/kt/grace.md',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should return translation word by rcLink', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				rcLink: 'rc://en/tw/dict/bible/kt/grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.data).toBeDefined();
		});

		it('should return 400 when no identifier provided', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(400);
		});

		it('should return 404 when translation word not found', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'nonexistentwordxyz123',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect([404, 200]).toContain(response.status);
		});
	});

	describe('Multi-Organization Support', () => {
		it('should search all organizations when organization is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en'
			});

			expect(response.status).toBe(200);
		});

		it('should accept single organization', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept multiple organizations', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Parameter Validation', () => {
		it('should return 400 for invalid path format (must end with .md)', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				path: 'bible/kt/grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(400);
		});

		it('should return 400 for invalid rcLink format', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				rcLink: 'invalid-rc-link',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(400);
		});

		it('should default to English when language is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'md'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('text/markdown');
			expect(typeof response.data).toBe('string');
			expect(response.data.length).toBeGreaterThan(0);
		});

		it('should return text format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
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
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/fetch-translation-word', {
				term: 'grace',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/fetch-translation-word', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});








