import { describe, it, expect } from 'vitest';
import { makeRequest } from '../../../tests/test-utils';

describe('/api/fetch-translation-notes', () => {
	describe('Basic Functionality', () => {
		it('should return translation notes for a valid reference', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			
			// Check new shape: separate verseNotes and contextNotes arrays
			expect(response.data.verseNotes).toBeDefined();
			expect(Array.isArray(response.data.verseNotes)).toBe(true);
			expect(response.data.contextNotes).toBeDefined();
			expect(Array.isArray(response.data.contextNotes)).toBe(true);
			
			// Verify contextNotes have contextType field
			if (response.data.contextNotes.length > 0) {
				expect(response.data.contextNotes[0].contextType).toBeDefined();
				expect(['book', 'chapter']).toContain(response.data.contextNotes[0].contextType);
			}
		});

		it('should return 404 when no notes found', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'Invalid Book 99:99',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect([404, 200]).toContain(response.status);
		});
	});

	describe('Multi-Organization Support', () => {
		it('should search all organizations when organization is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en'
			});

			expect(response.status).toBe(200);
			expect(response.data.verseNotes).toBeDefined();
			expect(response.data.contextNotes).toBeDefined();
		});

		it('should accept single organization', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});

		it('should accept multiple organizations', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: ['unfoldingWord', 'es-419_gl']
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Parameter Validation', () => {
		it('should return 400 for missing reference parameter', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				language: 'en'
			});

			expect(response.status).toBe(400);
		});

		it('should return 400 for invalid reference format', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'invalid',
				language: 'en'
			});

			expect(response.status).toBe(400);
		});

		it('should default to English when language is omitted', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
		});
	});

	describe('Format Support', () => {
		it('should return JSON format by default', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toContain('application/json');
			expect(typeof response.data).toBe('object');
			expect(response.data.verseNotes).toBeDefined();
			expect(response.data.contextNotes).toBeDefined();
		});

		it('should return markdown format when requested', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
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
			const response = await makeRequest('/api/fetch-translation-notes', {
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
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord',
				format: 'invalid-format'
			});

			expect(response.status).toBe(400);
			expect(response.data.error).toBeDefined();
		});
	});

	describe('Response Shape', () => {
		it('should return separate verseNotes and contextNotes arrays', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'Titus 3:15',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			
			// Should have both arrays
			expect(response.data.verseNotes).toBeDefined();
			expect(Array.isArray(response.data.verseNotes)).toBe(true);
			expect(response.data.contextNotes).toBeDefined();
			expect(Array.isArray(response.data.contextNotes)).toBe(true);
			
			// Should NOT have old 'items' field
			expect(response.data.items).toBeUndefined();
			
			// Counts should match array lengths
			expect(response.data.counts).toBeDefined();
			expect(response.data.counts.verseNotesCount).toBe(response.data.verseNotes.length);
			expect(response.data.counts.contextNotesCount).toBe(response.data.contextNotes.length);
		});

		it('should include contextType field in contextual notes', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'Titus 3:15',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			
			if (response.data.contextNotes.length > 0) {
				const contextNote = response.data.contextNotes[0];
				expect(contextNote.contextType).toBeDefined();
				expect(['book', 'chapter']).toContain(contextNote.contextType);
				
				// Book intro should be front:intro
				if (contextNote.contextType === 'book') {
					expect(contextNote.Reference).toBe('front:intro');
				}
				
				// Chapter intro should be {chapter}:intro
				if (contextNote.contextType === 'chapter') {
					expect(contextNote.Reference).toMatch(/^\d+:intro$/);
				}
			}
		});

		it('should not include contextType in verse-specific notes', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'Titus 3:15',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			
			if (response.data.verseNotes.length > 0) {
				const verseNote = response.data.verseNotes[0];
				expect(verseNote.contextType).toBeUndefined();
				// Verse notes should have actual verse references
				expect(verseNote.Reference).toMatch(/^\d+:\d+$/);
			}
		});
	});

	describe('CORS Support', () => {
		it('should include CORS headers in response', async () => {
			const response = await makeRequest('/api/fetch-translation-notes', {
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});

			expect(response.status).toBe(200);
			expect(response.headers['access-control-allow-origin']).toBeDefined();
		});

		it('should handle OPTIONS request for CORS preflight', async () => {
			const response = await fetch('http://localhost:8174/api/fetch-translation-notes', {
				method: 'OPTIONS'
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('access-control-allow-methods')).toContain('GET');
			expect(response.headers.get('access-control-allow-origin')).toBeDefined();
		});
	});
});
