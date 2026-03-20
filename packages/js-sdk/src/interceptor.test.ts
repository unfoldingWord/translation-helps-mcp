/**
 * Comprehensive test suite for State Injection Interceptor
 * 
 * Run with: npm test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './ContextManager';
import { StateInjectionInterceptor } from './StateInjectionInterceptor';
import {
	languageCodeValidator,
	organizationValidator,
	referenceValidator,
	booleanValidator
} from './validators';

describe('ContextManager', () => {
	let contextManager: ContextManager;

	beforeEach(() => {
		contextManager = new ContextManager();
	});

	describe('Basic Operations', () => {
		it('should set and get values', () => {
			contextManager.set('language', 'en');
			expect(contextManager.get('language')).toBe('en');
		});

		it('should check if key exists', () => {
			contextManager.set('language', 'en');
			expect(contextManager.has('language')).toBe(true);
			expect(contextManager.has('nonexistent')).toBe(false);
		});

		it('should delete values', () => {
			contextManager.set('language', 'en');
			expect(contextManager.delete('language')).toBe(true);
			expect(contextManager.has('language')).toBe(false);
		});

		it('should clear all values', () => {
			contextManager.set('language', 'en');
			contextManager.set('organization', 'unfoldingWord');
			contextManager.clear();
			expect(contextManager.has('language')).toBe(false);
			expect(contextManager.has('organization')).toBe(false);
		});

		it('should get all values', () => {
			contextManager.set('language', 'en');
			contextManager.set('organization', 'unfoldingWord');
			const all = contextManager.getAll();
			expect(all).toEqual({
				language: 'en',
				organization: 'unfoldingWord'
			});
		});

		it('should batch set multiple values', () => {
			const results = contextManager.setMany({
				language: 'en',
				organization: 'unfoldingWord',
				stage: 'prod'
			});
			expect(results.language).toBe(true);
			expect(results.organization).toBe(true);
			expect(results.stage).toBe(true);
			expect(contextManager.get('language')).toBe('en');
			expect(contextManager.get('organization')).toBe('unfoldingWord');
		});
	});

	describe('Validation', () => {
		beforeEach(() => {
			contextManager.addValidationRule('language', languageCodeValidator);
		});

		it('should accept valid language codes', () => {
			expect(contextManager.set('language', 'en')).toBe(true);
			expect(contextManager.set('language', 'en-US')).toBe(true);
			expect(contextManager.set('language', 'es-419')).toBe(true);
			expect(contextManager.set('language', 'zh-Hans-CN')).toBe(true);
		});

		it('should reject invalid language codes', () => {
			expect(contextManager.set('language', 'invalid!!!')).toBe(false);
			expect(contextManager.set('language', '123')).toBe(false);
			expect(contextManager.set('language', 'en-TOOLONG')).toBe(false);
			expect(contextManager.get('language')).toBeUndefined();
		});

		it('should accept values for keys without validation rules', () => {
			expect(contextManager.set('customKey', 'anyValue')).toBe(true);
			expect(contextManager.get('customKey')).toBe('anyValue');
		});

		it('should remove validation rules', () => {
			contextManager.removeValidationRule('language');
			expect(contextManager.set('language', 'invalid')).toBe(true);
		});
	});
});

describe('StateInjectionInterceptor', () => {
	let contextManager: ContextManager;
	let interceptor: StateInjectionInterceptor;

	beforeEach(() => {
		contextManager = new ContextManager();
		interceptor = new StateInjectionInterceptor(
			contextManager,
			{
				'fetch_scripture': ['language', 'organization', 'stage'],
				'fetch_translation_notes': ['language', 'organization'],
				'list_languages': []
			},
			{ debug: false }
		);
	});

	describe('Context Injection', () => {
		it('should inject missing parameters from context', () => {
			contextManager.set('language', 'en');
			contextManager.set('organization', 'unfoldingWord');

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16'
			});

			expect(result.modified).toBe(true);
			expect(result.arguments).toEqual({
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});
			expect(result.injected).toEqual({
				language: 'en',
				organization: 'unfoldingWord'
			});
		});

		it('should not inject when parameters are already provided', () => {
			contextManager.set('language', 'en');

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: 'es-419' // Explicitly provided
			});

			expect(result.arguments.language).toBe('es-419'); // Should keep explicit value
			expect(result.injected).toEqual({}); // Nothing injected
		});

		it('should handle tools with no context requirements', () => {
			contextManager.set('language', 'en');

			const result = interceptor.intercept('list_languages', {});

			expect(result.modified).toBe(false);
			expect(result.injected).toEqual({});
		});

		it('should handle unknown tools gracefully', () => {
			contextManager.set('language', 'en');

			const result = interceptor.intercept('unknown_tool', {
				someArg: 'value'
			});

			expect(result.modified).toBe(false);
			expect(result.arguments).toEqual({ someArg: 'value' });
		});
	});

	describe('Context Synchronization', () => {
		it('should sync explicitly-provided parameters to context', () => {
			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: 'es-419',
				organization: 'door43'
			});

			expect(result.modified).toBe(true);
			expect(result.synced).toEqual({
				language: 'es-419',
				organization: 'door43'
			});
			expect(contextManager.get('language')).toBe('es-419');
			expect(contextManager.get('organization')).toBe('door43');
		});

		it('should sync and inject in the same call', () => {
			contextManager.set('organization', 'unfoldingWord');

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: 'en' // New language to sync
				// organization missing - will be injected
			});

			expect(result.synced).toEqual({ language: 'en' });
			expect(result.injected).toEqual({ organization: 'unfoldingWord' });
			expect(result.arguments).toEqual({
				reference: 'John 3:16',
				language: 'en',
				organization: 'unfoldingWord'
			});
		});

		it('should handle validation failure during sync', () => {
			contextManager.addValidationRule('language', languageCodeValidator);

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: 'invalid!!!' // Invalid language code
			});

			// Sync should fail, parameter stays in arguments but not in context
			expect(result.synced).toEqual({});
			expect(contextManager.get('language')).toBeUndefined();
		});
	});

	describe('Configuration Management', () => {
		it('should add tool requirements dynamically', () => {
			interceptor.addToolRequirements('custom_tool', ['language', 'customParam']);
			contextManager.set('language', 'en');
			contextManager.set('customParam', 'value');

			const result = interceptor.intercept('custom_tool', { arg: 'test' });

			expect(result.injected).toEqual({
				language: 'en',
				customParam: 'value'
			});
		});

		it('should update tool configuration', () => {
			interceptor.updateToolConfig({
				'new_tool': ['language']
			});

			const config = interceptor.getToolConfig();
			expect(config['new_tool']).toEqual(['language']);
		});

		it('should remove tool requirements', () => {
			interceptor.removeToolRequirements('fetch_scripture');

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16'
			});

			expect(result.modified).toBe(false);
		});
	});

	describe('Event Callbacks', () => {
		it('should call onContextInjected when context is injected', () => {
			let callbackInvoked = false;
			let callbackData: any = null;

			const customInterceptor = new StateInjectionInterceptor(
				contextManager,
				{ 'fetch_scripture': ['language'] },
				{
					onContextInjected: (toolName, injectedParams) => {
						callbackInvoked = true;
						callbackData = { toolName, injectedParams };
					}
				}
			);

			contextManager.set('language', 'en');
			customInterceptor.intercept('fetch_scripture', { reference: 'John 3:16' });

			expect(callbackInvoked).toBe(true);
			expect(callbackData.toolName).toBe('fetch_scripture');
			expect(callbackData.injectedParams).toEqual({ language: 'en' });
		});

		it('should call onContextSynced when context is synced', () => {
			let callbackInvoked = false;
			let callbackData: any = null;

			const customInterceptor = new StateInjectionInterceptor(
				contextManager,
				{ 'fetch_scripture': ['language'] },
				{
					onContextSynced: (toolName, syncedParams) => {
						callbackInvoked = true;
						callbackData = { toolName, syncedParams };
					}
				}
			);

			customInterceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: 'es-419'
			});

			expect(callbackInvoked).toBe(true);
			expect(callbackData.toolName).toBe('fetch_scripture');
			expect(callbackData.syncedParams).toEqual({ language: 'es-419' });
		});

		it('should call onMissingRequiredParam when parameter is missing', () => {
			let callbackInvoked = false;
			let callbackData: any = null;

			const customInterceptor = new StateInjectionInterceptor(
				contextManager,
				{ 'fetch_scripture': ['language', 'organization'] },
				{
					onMissingRequiredParam: (toolName, paramKey) => {
						callbackInvoked = true;
						callbackData = { toolName, paramKey };
					}
				}
			);

			customInterceptor.intercept('fetch_scripture', { reference: 'John 3:16' });

			expect(callbackInvoked).toBe(true);
			expect(callbackData.toolName).toBe('fetch_scripture');
			expect(['language', 'organization']).toContain(callbackData.paramKey);
		});
	});

	describe('Edge Cases', () => {
		it('should handle undefined argument values', () => {
			contextManager.set('language', 'en');

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16',
				language: undefined // Explicitly undefined
			});

			// Undefined is treated as missing, should be injected
			expect(result.arguments.language).toBe('en');
		});

		it('should handle null context values', () => {
			contextManager.set('language', null);

			const result = interceptor.intercept('fetch_scripture', {
				reference: 'John 3:16'
			});

			// Null should be injected
			expect(result.arguments.language).toBe(null);
		});

		it('should handle empty arguments object', () => {
			contextManager.set('language', 'en');

			const result = interceptor.intercept('fetch_scripture', {});

			expect(result.injected).toEqual({ language: 'en' });
		});

		it('should not modify original arguments object', () => {
			contextManager.set('language', 'en');

			const originalArgs = { reference: 'John 3:16' };
			const result = interceptor.intercept('fetch_scripture', originalArgs);

			expect(originalArgs).toEqual({ reference: 'John 3:16' }); // Unchanged
			expect(result.arguments).not.toBe(originalArgs); // New object
		});
	});
});

describe('Validators', () => {
	describe('languageCodeValidator', () => {
		it('should accept valid ISO 639 codes', () => {
			expect(languageCodeValidator.validate('en')).toBe(true);
			expect(languageCodeValidator.validate('en-US')).toBe(true);
			expect(languageCodeValidator.validate('es-419')).toBe(true);
			expect(languageCodeValidator.validate('zh-Hans')).toBe(true);
			expect(languageCodeValidator.validate('zh-Hans-CN')).toBe(true);
		});

		it('should reject invalid codes', () => {
			expect(languageCodeValidator.validate('invalid')).toBe(false);
			expect(languageCodeValidator.validate('en-TOOLONGREGION')).toBe(false);
			expect(languageCodeValidator.validate('123')).toBe(false);
			expect(languageCodeValidator.validate('')).toBe(false);
		});
	});

	describe('organizationValidator', () => {
		it('should accept valid organization names', () => {
			expect(organizationValidator.validate('unfoldingWord')).toBe(true);
			expect(organizationValidator.validate('door43')).toBe(true);
			expect(organizationValidator.validate('my-org')).toBe(true);
			expect(organizationValidator.validate('org_name')).toBe(true);
		});

		it('should reject invalid names', () => {
			expect(organizationValidator.validate('invalid space')).toBe(false);
			expect(organizationValidator.validate('invalid@char')).toBe(false);
			expect(organizationValidator.validate('')).toBe(false);
		});
	});

	describe('referenceValidator', () => {
		it('should accept valid Bible references', () => {
			expect(referenceValidator.validate('John 3:16')).toBe(true);
			expect(referenceValidator.validate('Romans 1:1')).toBe(true);
			expect(referenceValidator.validate('Romans 1:1-7')).toBe(true);
			expect(referenceValidator.validate('1 John 2:3')).toBe(true);
			expect(referenceValidator.validate('3 John 1:1')).toBe(true);
		});

		it('should reject invalid references', () => {
			expect(referenceValidator.validate('Invalid')).toBe(false);
			expect(referenceValidator.validate('John 3')).toBe(false);
			expect(referenceValidator.validate('3:16')).toBe(false);
		});
	});

	describe('booleanValidator', () => {
		it('should accept boolean values', () => {
			expect(booleanValidator.validate(true)).toBe(true);
			expect(booleanValidator.validate(false)).toBe(true);
			expect(booleanValidator.validate('true')).toBe(true);
			expect(booleanValidator.validate('false')).toBe(true);
		});

		it('should reject non-boolean values', () => {
			expect(booleanValidator.validate('yes')).toBe(false);
			expect(booleanValidator.validate(1)).toBe(false);
			expect(booleanValidator.validate(null)).toBe(false);
		});
	});
});
