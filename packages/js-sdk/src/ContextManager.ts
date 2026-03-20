/**
 * ContextManager - Generic state store for client-side session context
 * 
 * Manages dynamic key-value pairs that can be automatically injected
 * into MCP tool calls when the LLM drops implicit context parameters.
 */

export type ContextValue = string | number | boolean | null | undefined;
export type ContextStore = Record<string, ContextValue>;

export interface ValidationRule {
	validate: (value: any) => boolean;
	errorMessage: string;
}

export type ValidationRules = Record<string, ValidationRule>;

/**
 * Generic context manager for storing and retrieving session state
 */
export class ContextManager {
	private store: ContextStore = {};
	private validationRules: ValidationRules = {};

	/**
	 * Get a value from the context store
	 */
	get<T extends ContextValue = ContextValue>(key: string): T | undefined {
		return this.store[key] as T | undefined;
	}

	/**
	 * Set a value in the context store with optional validation
	 */
	set(key: string, value: ContextValue): boolean {
		// Run validation if rule exists for this key
		if (this.validationRules[key]) {
			const rule = this.validationRules[key];
			if (!rule.validate(value)) {
				console.warn(
					`[ContextManager] Validation failed for key "${key}": ${rule.errorMessage}`,
					{ attemptedValue: value }
				);
				return false;
			}
		}

		this.store[key] = value;
		return true;
	}

	/**
	 * Check if a key exists in the context store
	 */
	has(key: string): boolean {
		return key in this.store && this.store[key] !== undefined;
	}

	/**
	 * Remove a key from the context store
	 */
	delete(key: string): boolean {
		if (this.has(key)) {
			delete this.store[key];
			return true;
		}
		return false;
	}

	/**
	 * Clear all context values
	 */
	clear(): void {
		this.store = {};
	}

	/**
	 * Get all context values (useful for debugging)
	 */
	getAll(): Readonly<ContextStore> {
		return { ...this.store };
	}

	/**
	 * Register a validation rule for a specific context key
	 */
	addValidationRule(key: string, rule: ValidationRule): void {
		this.validationRules[key] = rule;
	}

	/**
	 * Remove a validation rule
	 */
	removeValidationRule(key: string): void {
		delete this.validationRules[key];
	}

	/**
	 * Batch set multiple values at once
	 */
	setMany(values: Record<string, ContextValue>): Record<string, boolean> {
		const results: Record<string, boolean> = {};
		for (const [key, value] of Object.entries(values)) {
			results[key] = this.set(key, value);
		}
		return results;
	}
}
