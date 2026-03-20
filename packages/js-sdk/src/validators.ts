/**
 * Built-in validation rules for common context parameters
 * 
 * These validators prevent the LLM from hallucinating invalid parameter values
 */

import type { ValidationRule } from './ContextManager';

/**
 * Validates that a language code is a valid ISO 639 format
 * Accepts formats: "en", "en-US", "es-419", "zh-CN"
 */
export const languageCodeValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		// ISO 639-1 (2-letter) or ISO 639-1 with region/script
		// Examples: "en", "en-US", "es-419", "zh-Hans", "zh-Hans-CN"
		const iso639Pattern = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-[0-9]{3})?$/;
		
		return iso639Pattern.test(value) && value.length <= 15;
	},
	errorMessage: 'Language code must be a valid ISO 639 format (e.g., "en", "en-US", "es-419")'
};

/**
 * Validates organization name (alphanumeric with hyphens/underscores)
 * Examples: "unfoldingWord", "door43", "my-org", "org_name"
 */
export const organizationValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		// Allow alphanumeric, hyphens, underscores, 1-50 characters
		const orgPattern = /^[a-zA-Z0-9_-]{1,50}$/;
		
		return orgPattern.test(value);
	},
	errorMessage: 'Organization must be alphanumeric with hyphens/underscores (1-50 chars)'
};

/**
 * Validates resource type (alphanumeric with underscores)
 * Examples: "ult", "ust", "tn", "tw", "tq", "ta"
 */
export const resourceTypeValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		// Allow lowercase alphanumeric with underscores, 1-20 characters
		const resourcePattern = /^[a-z0-9_]{1,20}$/;
		
		return resourcePattern.test(value);
	},
	errorMessage: 'Resource type must be lowercase alphanumeric with underscores (1-20 chars)'
};

/**
 * Validates Bible reference format
 * Examples: "John 3:16", "Genesis 1:1", "Romans 1:1-7", "1 John 2:3"
 */
export const referenceValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		// Basic pattern: Book Chapter:Verse or Book Chapter:Verse-Verse
		// Allows: "John 3:16", "1 John 2:3", "Romans 1:1-7"
		const refPattern = /^[1-3]?\s?[A-Za-z]+\s+\d+:\d+(-\d+)?$/;
		
		return refPattern.test(value) && value.length <= 50;
	},
	errorMessage: 'Reference must be valid Bible format (e.g., "John 3:16", "Romans 1:1-7")'
};

/**
 * Validates book code (3-letter uppercase)
 * Examples: "GEN", "JHN", "ROM", "1CO", "3JN"
 */
export const bookCodeValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		// 3-letter uppercase, may start with a digit
		const bookPattern = /^[1-3]?[A-Z]{2,3}$/;
		
		return bookPattern.test(value) && value.length <= 3;
	},
	errorMessage: 'Book code must be 3-letter uppercase (e.g., "GEN", "JHN", "3JN")'
};

/**
 * Validates chapter number (1-150)
 */
export const chapterValidator: ValidationRule = {
	validate: (value: any): boolean => {
		const num = typeof value === 'string' ? parseInt(value, 10) : value;
		return typeof num === 'number' && !isNaN(num) && num >= 1 && num <= 150;
	},
	errorMessage: 'Chapter must be a number between 1 and 150'
};

/**
 * Validates verse number (1-176, for Psalm 119)
 */
export const verseValidator: ValidationRule = {
	validate: (value: any): boolean => {
		const num = typeof value === 'string' ? parseInt(value, 10) : value;
		return typeof num === 'number' && !isNaN(num) && num >= 1 && num <= 176;
	},
	errorMessage: 'Verse must be a number between 1 and 176'
};

/**
 * Validates format parameter (json, text, usfm, markdown)
 */
export const formatValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		const validFormats = ['json', 'text', 'usfm', 'markdown', 'plain'];
		return validFormats.includes(value.toLowerCase());
	},
	errorMessage: 'Format must be one of: json, text, usfm, markdown, plain'
};

/**
 * Validates boolean parameters
 */
export const booleanValidator: ValidationRule = {
	validate: (value: any): boolean => {
		return typeof value === 'boolean' || value === 'true' || value === 'false';
	},
	errorMessage: 'Must be a boolean value (true/false)'
};

/**
 * Validates stage parameter (prod, preprod, latest)
 */
export const stageValidator: ValidationRule = {
	validate: (value: any): boolean => {
		if (typeof value !== 'string') return false;
		
		const validStages = ['prod', 'preprod', 'latest'];
		return validStages.includes(value.toLowerCase());
	},
	errorMessage: 'Stage must be one of: prod, preprod, latest'
};

/**
 * Generic string length validator factory
 */
export function createStringLengthValidator(minLength = 1, maxLength = 100): ValidationRule {
	return {
		validate: (value: any): boolean => {
			return (
				typeof value === 'string' &&
				value.length >= minLength &&
				value.length <= maxLength
			);
		},
		errorMessage: `String must be between ${minLength} and ${maxLength} characters`
	};
}

/**
 * Generic number range validator factory
 */
export function createNumberRangeValidator(min: number, max: number): ValidationRule {
	return {
		validate: (value: any): boolean => {
			const num = typeof value === 'string' ? parseFloat(value) : value;
			return typeof num === 'number' && !isNaN(num) && num >= min && num <= max;
		},
		errorMessage: `Number must be between ${min} and ${max}`
	};
}

/**
 * Generic enum validator factory
 */
export function createEnumValidator(allowedValues: string[], caseSensitive = false): ValidationRule {
	return {
		validate: (value: any): boolean => {
			if (typeof value !== 'string') return false;
			
			const compareValue = caseSensitive ? value : value.toLowerCase();
			const compareList = caseSensitive ? allowedValues : allowedValues.map(v => v.toLowerCase());
			
			return compareList.includes(compareValue);
		},
		errorMessage: `Must be one of: ${allowedValues.join(', ')}`
	};
}

/**
 * Composite validator - requires all validators to pass
 */
export function createCompositeValidator(...validators: ValidationRule[]): ValidationRule {
	return {
		validate: (value: any): boolean => {
			return validators.every(v => v.validate(value));
		},
		errorMessage: validators.map(v => v.errorMessage).join('; ')
	};
}
