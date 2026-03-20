/**
 * Shared TypeScript types for tools metadata
 * Used across API endpoint and UI pages
 */

export interface ToolParameter {
	name: string;
	type: string;
	required: boolean;
	description: string;
	default?: any;
	options?: string[];
	example?: string;
}

export interface ToolExample {
	title: string;
	description?: string;
	parameters: Record<string, any>;
	expectedResponse?: string;
}

export interface ToolMetadata {
	name: string;
	mcpName: string;
	endpoint: string;
	description: string;
	category: string;
	parameters: ToolParameter[];
	examples: ToolExample[];
}

export interface PromptArgument {
	name: string;
	description: string;
	required: boolean;
}

export interface PromptMetadata {
	name: string;
	description: string;
	arguments: PromptArgument[];
}

export interface MetadataResponse {
	tools: ToolMetadata[];
	prompts: PromptMetadata[];
	categories: string[];
	version: string;
	generatedAt: string;
}

/**
 * Group tools by category
 */
export function groupToolsByCategory(tools: ToolMetadata[]): Record<string, ToolMetadata[]> {
	return tools.reduce((acc, tool) => {
		if (!acc[tool.category]) {
			acc[tool.category] = [];
		}
		acc[tool.category].push(tool);
		return acc;
	}, {} as Record<string, ToolMetadata[]>);
}

/**
 * Find tool by name (display name or MCP name)
 */
export function findTool(tools: ToolMetadata[], name: string): ToolMetadata | undefined {
	return tools.find(t => t.name === name || t.mcpName === name || t.endpoint === name);
}

/**
 * Get default test parameters for a tool
 */
export function getDefaultTestParams(tool: ToolMetadata): Record<string, any> {
	const params: Record<string, any> = {};
	
	// Use example if available
	if (tool.examples && tool.examples.length > 0) {
		return { ...tool.examples[0].parameters };
	}
	
	// Otherwise, use parameter defaults and common patterns
	for (const param of tool.parameters) {
		if (param.default !== undefined) {
			params[param.name] = param.default;
		} else if (param.required) {
			// Provide sensible defaults for required params
			switch (param.name) {
				case 'reference':
					params[param.name] = 'John 3:16';
					break;
				case 'language':
					params[param.name] = 'en';
					break;
				case 'organization':
					params[param.name] = 'unfoldingWord';
					break;
				case 'term':
					params[param.name] = 'faith';
					break;
				case 'moduleId':
					params[param.name] = 'figs-metaphor';
					break;
				default:
					// Use example if available
					if (param.example) {
						params[param.name] = param.example;
					}
			}
		}
	}
	
	return params;
}
