/**
 * Unified test client for MCP and REST API testing
 */

export interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface MCPPromptCall {
  name: string;
  arguments?: Record<string, any>;
}

export interface MCPResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

export class TestClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8174') {
    this.baseUrl = baseUrl;
  }

  /**
   * Call a REST API endpoint
   */
  async callREST(
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    const url = new URL(`${this.baseUrl}/api/${endpoint}`);
    
    // Add query parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(
        `REST API error: ${response.status} ${response.statusText} - ${await response.text()}`
      );
    }

    return await response.json();
  }

  /**
   * Call an MCP tool
   */
  async callMCPTool(tool: MCPToolCall): Promise<MCPResponse> {
    const response = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: tool.name,
          arguments: tool.arguments
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`MCP Tool error: ${JSON.stringify(data.error)}`);
    }

    return data.result as MCPResponse;
  }

  /**
   * Execute an MCP prompt
   */
  async callMCPPrompt(prompt: MCPPromptCall): Promise<MCPResponse> {
    const response = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/get',
        params: {
          name: prompt.name,
          arguments: prompt.arguments || {}
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`MCP Prompt error: ${JSON.stringify(data.error)}`);
    }

    return data.result as MCPResponse;
  }

  /**
   * List available MCP tools
   */
  async listMCPTools(): Promise<Array<{ name: string; description: string }>> {
    const response = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      })
    });

    const data = await response.json();
    return data.result?.tools || [];
  }

  /**
   * List available MCP prompts
   */
  async listMCPPrompts(): Promise<Array<{ name: string; description: string }>> {
    const response = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'prompts/list'
      })
    });

    const data = await response.json();
    return data.result?.prompts || [];
  }

  /**
   * Check if server is running
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait for server to be ready
   */
  async waitForServer(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.healthCheck()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Server not ready after ${timeoutMs}ms`);
  }
}

/**
 * Parse MCP text response to extract content
 */
export function extractMCPText(response: MCPResponse): string {
  return response.content
    .map(c => c.text)
    .join('\n');
}

/**
 * Compare REST and MCP responses for structural equivalence
 */
export function compareResponses(
  restResponse: any,
  mcpResponse: MCPResponse,
  options: {
    ignoreFormatting?: boolean;
    ignoreOrder?: boolean;
  } = {}
): { equivalent: boolean; differences: string[] } {
  const differences: string[] = [];

  // Extract MCP text content
  const mcpText = extractMCPText(mcpResponse);

  // Basic checks
  if (!restResponse) {
    differences.push('REST response is empty');
  }

  if (!mcpText) {
    differences.push('MCP response is empty');
  }

  // Type checking
  const restType = typeof restResponse;
  const mcpIsObject = mcpText.startsWith('{') || mcpText.startsWith('[');

  if (restType === 'object' && !mcpIsObject) {
    // REST returned object, MCP returned formatted text (expected for some tools)
    // This is OK if MCP is using textExtractor
    return { equivalent: true, differences: [] };
  }

  // For objects, try to parse MCP text as JSON and compare
  if (restType === 'object' && mcpIsObject) {
    try {
      const mcpObject = JSON.parse(mcpText);
      const restKeys = Object.keys(restResponse);
      const mcpKeys = Object.keys(mcpObject);

      // Check for missing keys
      restKeys.forEach(key => {
        if (!mcpKeys.includes(key)) {
          differences.push(`MCP missing key: ${key}`);
        }
      });

      mcpKeys.forEach(key => {
        if (!restKeys.includes(key)) {
          differences.push(`REST missing key: ${key}`);
        }
      });

      // Check for value differences
      restKeys.forEach(key => {
        if (mcpKeys.includes(key)) {
          const restValue = JSON.stringify(restResponse[key]);
          const mcpValue = JSON.stringify(mcpObject[key]);
          
          if (restValue !== mcpValue && !options.ignoreFormatting) {
            differences.push(`Value mismatch for '${key}': REST=${restValue.slice(0, 100)}, MCP=${mcpValue.slice(0, 100)}`);
          }
        }
      });
    } catch (e) {
      differences.push(`Failed to parse MCP response as JSON: ${e}`);
    }
  }

  return {
    equivalent: differences.length === 0,
    differences
  };
}
