/**
 * Automatic Retry Mechanism Tests
 * 
 * Tests the internal server-side automatic retry functionality for:
 * 1. Language variant discovery and retry
 * 2. Available books discovery when book not found
 * 3. Error handling and recovery data propagation
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8174';

describe('Automatic Retry Mechanism', () => {
	beforeAll(() => {
		console.log('Testing against:', BASE_URL);
	});

	describe('Language Variant Auto-Retry', () => {
		it('should auto-retry es → es-419 and return scripture for available book (Jonah)', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JON+1:1&language=es&format=json`
			);
			
			expect(response.ok).toBe(true);
			const data = await response.json();
			
			// Should succeed (internal retry happened transparently)
			expect(data).toHaveProperty('scripture');
			expect(data.scripture).toBeInstanceOf(Array);
			expect(data.scripture.length).toBeGreaterThan(0);
			
			// Language should be es-419 (after retry)
			const firstScripture = data.scripture[0];
			expect(firstScripture.citation.language).toBe('es-419');
			
			// Should have Spanish text
			expect(firstScripture.text).toContain('Jonás');
			
			// Response should include retry headers
			expect(response.headers.get('X-Retry')).toBe('true');
			expect(response.headers.get('X-Original-Language')).toBe('es');
			expect(response.headers.get('X-Retry-Language')).toBe('es-419');
		});

		it('should auto-retry es → es-419 and return availableBooks for unavailable book (John)', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=es&format=json`
			);
			
			expect(response.ok).toBe(false);
			expect(response.status).toBe(500);
			
			const data = await response.json();
			
			// Should have error with availableBooks
			expect(data).toHaveProperty('error');
			expect(data).toHaveProperty('details');
			expect(data.details).toHaveProperty('availableBooks');
			expect(data.details).toHaveProperty('requestedBook');
			expect(data.details).toHaveProperty('language');
			
			// Check availableBooks structure
			const availableBooks = data.details.availableBooks;
			expect(availableBooks).toBeInstanceOf(Array);
			expect(availableBooks.length).toBeGreaterThan(0);
			
			// Each book should have code and name
			availableBooks.forEach((book: any) => {
				expect(book).toHaveProperty('code');
				expect(book).toHaveProperty('name');
				expect(typeof book.code).toBe('string');
				expect(typeof book.name).toBe('string');
			});
			
			// Should include books like Jonah, Ruth, Titus, 3 John
			const bookNames = availableBooks.map((b: any) => b.name);
			expect(bookNames).toContain('Jonah');
			expect(bookNames).toContain('Ruth');
			expect(bookNames).toContain('Titus');
			
			// Language should be es-419 (after auto-retry)
			expect(data.details.language).toBe('es-419');
			expect(data.details.requestedBook).toBe('John');
		});

		it('should return languageVariants when language has no resources at all', async () => {
			// Test with a language that doesn't exist
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=xyz&format=json`
			);
			
			expect(response.ok).toBe(false);
			const data = await response.json();
			
			// Should have error (no retry possible)
			expect(data).toHaveProperty('error');
			expect(data).toHaveProperty('details');
			
			// Should NOT have availableBooks (language itself is invalid)
			expect(data.details.availableBooks).toBeUndefined();
		});
	});

	describe('Book Code Validation', () => {
		it('should handle completely invalid book codes', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=NOTABOOK+1:1&language=en&format=json`
			);
			
			expect(response.ok).toBe(false);
			const data = await response.json();
			
			// Should have error message about invalid reference
			expect(data).toHaveProperty('error');
			expect(data.error).toContain('Invalid reference');
		});

		it('should work with standard 3-letter book codes', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=GEN+1:1&language=en&format=json`
			);
			
			expect(response.ok).toBe(true);
			const data = await response.json();
			
			expect(data).toHaveProperty('scripture');
			expect(data.scripture.length).toBeGreaterThan(0);
			expect(data.scripture[0].text).toContain('beginning');
		});

		it('should work with full book names', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=Genesis+1:1&language=en&format=json`
			);
			
			expect(response.ok).toBe(true);
			const data = await response.json();
			
			expect(data).toHaveProperty('scripture');
			expect(data.scripture.length).toBeGreaterThan(0);
		});
	});

	describe('Resource Filtering (resource="all")', () => {
		it('should return all available translations when resource="all"', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=en&resource=all&format=json`
			);
			
			expect(response.ok).toBe(true);
			const data = await response.json();
			
			// Should have multiple translations (ULT, UST, T4T, BSB, etc.)
			expect(data.scripture.length).toBeGreaterThan(1);
			expect(data.counts.totalCount).toBeGreaterThan(1);
			
			// Should include common translations
			const translations = data.scripture.map((s: any) => s.translation);
			expect(translations.some((t: string) => t.includes('ULT'))).toBe(true);
			expect(translations.some((t: string) => t.includes('UST'))).toBe(true);
		});

		it('should filter to specific translation when requested', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=en&resource=ult&format=json`
			);
			
			expect(response.ok).toBe(true);
			const data = await response.json();
			
			// Should only have ULT/GLT translations
			expect(data.scripture.length).toBeGreaterThanOrEqual(1);
			const translation = data.scripture[0].translation;
			expect(translation).toMatch(/ULT|GLT/);
		});
	});

	describe('MCP Protocol Integration', () => {
		it('should return availableBooks in MCP JSON-RPC 2.0 format', async () => {
			const response = await fetch(`${BASE_URL}/api/mcp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'fetch_scripture',
						arguments: {
							reference: 'JHN 3:16',
							language: 'es',
							format: 'json'
						}
					},
					id: 1
				})
			});
			
			const data = await response.json();
			
			// Should have JSON-RPC error format
			expect(data).toHaveProperty('jsonrpc', '2.0');
			expect(data).toHaveProperty('error');
			expect(data).toHaveProperty('id', 1);
			
			// Error should have availableBooks in data field
			expect(data.error).toHaveProperty('data');
			expect(data.error.data).toHaveProperty('availableBooks');
			expect(data.error.data).toHaveProperty('requestedBook', 'John');
			expect(data.error.data).toHaveProperty('language', 'es-419');
			
			// AvailableBooks should be array of {code, name}
			const books = data.error.data.availableBooks;
			expect(Array.isArray(books)).toBe(true);
			expect(books.length).toBeGreaterThan(0);
			expect(books[0]).toHaveProperty('code');
			expect(books[0]).toHaveProperty('name');
		});

		it('should succeed for available book in MCP format', async () => {
			const response = await fetch(`${BASE_URL}/api/mcp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'fetch_scripture',
						arguments: {
							reference: 'JON 1:1',
							language: 'es',
							format: 'json'
						}
					},
					id: 1
				})
			});
			
			const data = await response.json();
			
			// Should succeed (auto-retry happened internally)
			expect(data).toHaveProperty('jsonrpc', '2.0');
			expect(data).toHaveProperty('result');
			expect(data.result).toHaveProperty('content');
			
			// Parse MCP response content
			const content = JSON.parse(data.result.content[0].text);
			expect(content).toHaveProperty('scripture');
			expect(content.scripture[0].citation.language).toBe('es-419');
		});
	});

	describe('Error Message Quality', () => {
		it('should provide helpful error message for unavailable book', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=es&format=json`
			);
			
			const data = await response.json();
			const errorMsg = data.error;
			
			// Error message should mention the book and language
			expect(errorMsg).toContain('John');
			expect(errorMsg).toContain('es-419');
			expect(errorMsg).toContain('not available');
			
			// Should list some available books
			expect(errorMsg).toContain('Jonah');
			expect(errorMsg).toContain('Ruth');
		});

		it('should deduplicate available books list', async () => {
			const response = await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JHN+3:16&language=es&format=json`
			);
			
			const data = await response.json();
			const books = data.details.availableBooks;
			
			// Check for duplicates
			const bookCodes = books.map((b: any) => b.code);
			const uniqueCodes = [...new Set(bookCodes)];
			
			// Should be deduplicated
			expect(bookCodes.length).toBe(uniqueCodes.length);
		});
	});

	describe('Performance', () => {
		it('should complete auto-retry within reasonable time', async () => {
			const start = Date.now();
			
			await fetch(
				`${BASE_URL}/api/fetch-scripture?reference=JON+1:1&language=es&format=json`
			);
			
			const duration = Date.now() - start;
			
			// Should complete within 15 seconds (includes retry)
			expect(duration).toBeLessThan(15000);
			console.log(`Auto-retry completed in ${duration}ms`);
		});
	});
});
