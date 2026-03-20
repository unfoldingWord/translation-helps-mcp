/**
 * StateInjectionInterceptor - Automatically inject missing parameters from context
 * 
 * This interceptor middleware:
 * 1. Checks which context parameters a tool requires
 * 2. Injects missing parameters from the ContextManager
 * 3. Syncs explicitly-provided parameters back to context
 * 4. Validates parameters before storing
 */

import { ContextManager, type ContextValue } from './ContextManager';

/**
 * Configuration mapping tool names to required context keys
 */
export interface ToolContextConfig {
	[toolName: string]: string[]; // Array of context keys required by this tool
}

/**
 * Options for the interceptor
 */
export interface InterceptorOptions {
	/**
	 * Enable debug logging
	 */
	debug?: boolean;

	/**
	 * Prefix for debug logs (default: '[StateInjectionInterceptor]')
	 */
	logPrefix?: string;

	/**
	 * Custom handler for when a required parameter is missing and cannot be injected
	 */
	onMissingRequiredParam?: (toolName: string, paramKey: string) => void;

	/**
	 * Custom handler for when context is injected
	 */
	onContextInjected?: (toolName: string, injectedParams: Record<string, ContextValue>) => void;

	/**
	 * Custom handler for when context is synced from tool arguments
	 */
	onContextSynced?: (toolName: string, syncedParams: Record<string, ContextValue>) => void;
}

/**
 * Result of intercepting a tool call
 */
export interface InterceptionResult {
	/**
	 * The modified arguments object (with injected context)
	 */
	arguments: Record<string, any>;

	/**
	 * Parameters that were injected from context
	 */
	injected: Record<string, ContextValue>;

	/**
	 * Parameters that were synced to context
	 */
	synced: Record<string, ContextValue>;

	/**
	 * Whether any changes were made
	 */
	modified: boolean;
}

/**
 * State Injection Interceptor
 * 
 * Manages automatic parameter injection and context synchronization
 */
export class StateInjectionInterceptor {
	private contextManager: ContextManager;
	private toolConfig: ToolContextConfig;
	private options: Required<InterceptorOptions>;

	constructor(
		contextManager: ContextManager,
		toolConfig: ToolContextConfig,
		options: InterceptorOptions = {}
	) {
		this.contextManager = contextManager;
		this.toolConfig = toolConfig;
		this.options = {
			debug: options.debug ?? false,
			logPrefix: options.logPrefix ?? '[StateInjectionInterceptor]',
			onMissingRequiredParam: options.onMissingRequiredParam ?? (() => {}),
			onContextInjected: options.onContextInjected ?? (() => {}),
			onContextSynced: options.onContextSynced ?? (() => {})
		};
	}

	/**
	 * Intercept a tool call and inject/sync context as needed
	 * 
	 * @param toolName - Name of the MCP tool being called
	 * @param toolArguments - Arguments provided by the LLM
	 * @returns Modified arguments with injected context
	 */
	intercept(toolName: string, toolArguments: Record<string, any>): InterceptionResult {
		const result: InterceptionResult = {
			arguments: { ...toolArguments },
			injected: {},
			synced: {},
			modified: false
		};

		// Check if this tool has context requirements
		const requiredContextKeys = this.toolConfig[toolName];
		if (!requiredContextKeys || requiredContextKeys.length === 0) {
			this.log(`No context requirements for tool: ${toolName}`);
			return result;
		}

		this.log(`Intercepting tool: ${toolName}`, {
			requiredKeys: requiredContextKeys,
			providedArgs: Object.keys(toolArguments)
		});

		// Process each required context key
		for (const contextKey of requiredContextKeys) {
			// Case 1: Argument explicitly provided → Sync to context
			if (contextKey in toolArguments && toolArguments[contextKey] !== undefined) {
				const providedValue = toolArguments[contextKey];
				const syncSuccess = this.contextManager.set(contextKey, providedValue);

				if (syncSuccess) {
					result.synced[contextKey] = providedValue;
					result.modified = true;
					this.log(`Synced context: ${contextKey} = ${providedValue}`);
				} else {
					this.log(`Failed to sync context (validation failed): ${contextKey}`);
				}
			}
			// Case 2: Argument missing → Inject from context
			else if (this.contextManager.has(contextKey)) {
				const contextValue = this.contextManager.get(contextKey);
				result.arguments[contextKey] = contextValue;
				result.injected[contextKey] = contextValue;
				result.modified = true;
				this.log(`Injected context: ${contextKey} = ${contextValue}`);
			}
			// Case 3: Missing and not in context → Log warning
			else {
				this.log(`⚠️ Missing required parameter: ${contextKey} (not in arguments or context)`);
				this.options.onMissingRequiredParam(toolName, contextKey);
			}
		}

		// Emit events if changes were made
		if (Object.keys(result.injected).length > 0) {
			this.options.onContextInjected(toolName, result.injected);
		}
		if (Object.keys(result.synced).length > 0) {
			this.options.onContextSynced(toolName, result.synced);
		}

		return result;
	}

	/**
	 * Update the tool configuration
	 */
	updateToolConfig(newConfig: ToolContextConfig): void {
		this.toolConfig = { ...this.toolConfig, ...newConfig };
	}

	/**
	 * Get current tool configuration
	 */
	getToolConfig(): Readonly<ToolContextConfig> {
		return { ...this.toolConfig };
	}

	/**
	 * Add context requirements for a specific tool
	 */
	addToolRequirements(toolName: string, contextKeys: string[]): void {
		this.toolConfig[toolName] = [...new Set([...(this.toolConfig[toolName] || []), ...contextKeys])];
	}

	/**
	 * Remove context requirements for a specific tool
	 */
	removeToolRequirements(toolName: string): void {
		delete this.toolConfig[toolName];
	}

	/**
	 * Internal logging method
	 */
	private log(message: string, data?: any): void {
		if (this.options.debug) {
			if (data) {
				console.log(`${this.options.logPrefix} ${message}`, data);
			} else {
				console.log(`${this.options.logPrefix} ${message}`);
			}
		}
	}
}
