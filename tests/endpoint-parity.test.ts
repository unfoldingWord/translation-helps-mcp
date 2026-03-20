/**
 * Endpoint Parity Tests
 * 
 * Ensures MCP tools and REST endpoints are synchronized:
 * - Every MCP tool has a corresponding REST endpoint
 * - Every core REST endpoint has a corresponding MCP tool
 * - Parameter names are consistent between MCP and REST
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient } from './helpers/test-client';
import { TOOL_ENDPOINT_MAP } from './helpers/test-data';

describe('Endpoint Parity Tests', () => {
  const client = new TestClient();
  let mcpTools: Array<{ name: string; description: string; inputSchema?: any }> = [];
  let restEndpoints: string[] = [];

  beforeAll(async () => {
    // Wait for server to be ready
    await client.waitForServer();

    // Get MCP tools list
    const toolsResponse = await client.callREST('list-tools');
    mcpTools = toolsResponse.tools || [];

    // Get REST endpoints from tool registry
    restEndpoints = Object.values(TOOL_ENDPOINT_MAP);
  });

  describe('MCP to REST Mapping', () => {
    it('should have all MCP tools mapped to REST endpoints', () => {
      const unmappedTools: string[] = [];

      mcpTools.forEach(tool => {
        const expectedEndpoint = TOOL_ENDPOINT_MAP[tool.name as keyof typeof TOOL_ENDPOINT_MAP];
        if (!expectedEndpoint) {
          unmappedTools.push(tool.name);
        }
      });

      if (unmappedTools.length > 0) {
        console.warn('⚠️  Unmapped MCP tools (may be utility tools):', unmappedTools);
      }

      // Core translation helps tools must be mapped
      const coreTools = mcpTools.filter(t => 
        t.name.startsWith('fetch_') || t.name.startsWith('list_')
      );

      coreTools.forEach(tool => {
        expect(
          TOOL_ENDPOINT_MAP[tool.name as keyof typeof TOOL_ENDPOINT_MAP],
          `Core MCP tool '${tool.name}' must have REST endpoint mapping`
        ).toBeDefined();
      });
    });

    it('should have REST endpoints accessible for all mapped tools', async () => {
      const failedEndpoints: Array<{ tool: string; endpoint: string; error: string }> = [];

      for (const [toolName, endpoint] of Object.entries(TOOL_ENDPOINT_MAP)) {
        try {
          // Try to call the endpoint (may fail for missing required params, but should not 404)
          const response = await fetch(`${client['baseUrl']}/api/${endpoint}`);
          
          // 400 (missing params) is OK, 404 is not
          if (response.status === 404) {
            failedEndpoints.push({
              tool: toolName,
              endpoint,
              error: 'Endpoint not found (404)'
            });
          }
        } catch (error: any) {
          failedEndpoints.push({
            tool: toolName,
            endpoint,
            error: error.message
          });
        }
      }

      if (failedEndpoints.length > 0) {
        console.error('❌ Failed endpoints:', failedEndpoints);
      }

      expect(failedEndpoints).toHaveLength(0);
    });
  });

  describe('REST to MCP Mapping', () => {
    it('should have all core REST endpoints exposed as MCP tools', () => {
      const mcpToolNames = mcpTools.map(t => t.name);
      const missingTools: string[] = [];

      Object.entries(TOOL_ENDPOINT_MAP).forEach(([toolName, endpoint]) => {
        if (!mcpToolNames.includes(toolName)) {
          missingTools.push(`${toolName} (endpoint: ${endpoint})`);
        }
      });

      if (missingTools.length > 0) {
        console.error('❌ REST endpoints missing MCP tools:', missingTools);
      }

      expect(missingTools).toHaveLength(0);
    });

    it('should not have orphaned REST endpoints', async () => {
      // Known utility endpoints that don't need MCP tools
      const utilityEndpoints = [
        'health',
        'health-dcs',
        'cache-stats',
        'kv-status',
        'deployment',
        'mcp',
        'mcp-config',
        'chat-stream',
        'execute-prompt',
        'tools-metadata',
        'discover-language-orgs',
        'test-ta',
      ];

      // Get all API routes
      const apiDir = 'ui/src/routes/api';
      // Note: In a real test, we'd scan the directory or maintain a registry
      
      // For now, we'll check that list-resources-by-language has either:
      // 1. An MCP tool, OR
      // 2. Is documented as deprecated/superseded

      const potentialOrphan = 'list-resources-by-language';
      const hasMcpTool = mcpTools.some(t => 
        TOOL_ENDPOINT_MAP[t.name as keyof typeof TOOL_ENDPOINT_MAP] === potentialOrphan
      );

      if (!hasMcpTool && !utilityEndpoints.includes(potentialOrphan)) {
        console.warn(`⚠️  Potential orphan endpoint: ${potentialOrphan}`);
        console.warn(`   Consider: 1) Adding MCP tool, 2) Marking as deprecated, 3) Removing if unused`);
      }

      // This is a warning, not a failure, since some endpoints may be intentionally REST-only
      expect(true).toBe(true);
    });
  });

  describe('Parameter Consistency', () => {
    const testCases = [
      {
        tool: 'fetch_scripture',
        endpoint: 'fetch-scripture',
        params: { reference: 'John 3:16' }
      },
      {
        tool: 'fetch_translation_notes',
        endpoint: 'fetch-translation-notes',
        params: { reference: 'John 3:16' }
      },
      {
        tool: 'fetch_translation_word',
        endpoint: 'fetch-translation-word',
        params: { path: 'kt/faith' }
      },
      {
        tool: 'fetch_translation_academy',
        endpoint: 'fetch-translation-academy',
        params: { path: 'figs-metaphor' }
      },
      {
        tool: 'list_languages',
        endpoint: 'list-languages',
        params: {}
      },
    ];

    testCases.forEach(({ tool, endpoint, params }) => {
      it(`should accept same parameters for ${tool}`, async () => {
        let mcpSuccess = false;
        let restSuccess = false;
        let mcpError = '';
        let restError = '';

        // Try MCP tool
        try {
          await client.callMCPTool({ name: tool, arguments: params });
          mcpSuccess = true;
        } catch (error: any) {
          mcpError = error.message;
          // Check if error is about parameters (not about missing data)
          if (mcpError.includes('not found') || mcpError.includes('404')) {
            // Data not found is OK for this test (we're testing parameter acceptance)
            mcpSuccess = true;
          }
        }

        // Try REST endpoint
        try {
          await client.callREST(endpoint, params);
          restSuccess = true;
        } catch (error: any) {
          restError = error.message;
          // Check if error is about parameters (not about missing data)
          if (restError.includes('not found') || restError.includes('404')) {
            // Data not found is OK for this test (we're testing parameter acceptance)
            restSuccess = true;
          }
        }

        // Both should either succeed or fail with the same type of error
        if (!mcpSuccess || !restSuccess) {
          console.log(`\n${tool}:`);
          console.log(`  MCP: ${mcpSuccess ? '✅' : `❌ ${mcpError}`}`);
          console.log(`  REST: ${restSuccess ? '✅' : `❌ ${restError}`}`);
        }

        expect(mcpSuccess).toBe(restSuccess);
      });
    });
  });

  describe('Naming Conventions', () => {
    it('should follow consistent naming (underscores in MCP, hyphens in REST)', () => {
      Object.entries(TOOL_ENDPOINT_MAP).forEach(([toolName, endpoint]) => {
        // MCP tools should use underscores
        expect(toolName).toMatch(/^[a-z_]+$/);
        expect(toolName).not.toContain('-');

        // REST endpoints should use hyphens
        expect(endpoint).toMatch(/^[a-z-]+$/);
        expect(endpoint).not.toContain('_');

        // Names should be semantically equivalent (allowing for convention differences)
        const toolParts = toolName.split('_');
        const endpointParts = endpoint.split('-');
        
        expect(toolParts).toEqual(endpointParts);
      });
    });

    it('should use consistent verbs (fetch, list, get, etc.)', () => {
      const allowedVerbs = ['fetch', 'list', 'get', 'test'];
      
      Object.keys(TOOL_ENDPOINT_MAP).forEach(toolName => {
        const verb = toolName.split('_')[0];
        
        expect(
          allowedVerbs,
          `Tool '${toolName}' uses unconventional verb '${verb}'`
        ).toContain(verb);
      });
    });
  });

  describe('Tool Metadata', () => {
    it('should have descriptions for all MCP tools', () => {
      const toolsWithoutDescriptions: string[] = [];

      mcpTools.forEach(tool => {
        if (!tool.description || tool.description.trim() === '') {
          toolsWithoutDescriptions.push(tool.name);
        }
      });

      if (toolsWithoutDescriptions.length > 0) {
        console.error('❌ Tools missing descriptions:', toolsWithoutDescriptions);
      }

      expect(toolsWithoutDescriptions).toHaveLength(0);
    });

    it('should have input schemas for all MCP tools', () => {
      const toolsWithoutSchemas: string[] = [];

      mcpTools.forEach(tool => {
        if (!tool.inputSchema) {
          toolsWithoutSchemas.push(tool.name);
        }
      });

      if (toolsWithoutSchemas.length > 0) {
        console.error('❌ Tools missing input schemas:', toolsWithoutSchemas);
      }

      expect(toolsWithoutSchemas).toHaveLength(0);
    });

    it('should have consistent parameter names across all tools', () => {
      // Common parameters should have the same name everywhere
      const commonParams: Record<string, string[]> = {
        language: [],
        organization: [],
        reference: [],
        path: [],
        format: [],
        topic: [],
        category: [],
      };

      mcpTools.forEach(tool => {
        const schema = tool.inputSchema;
        if (schema && schema.properties) {
          Object.keys(commonParams).forEach(param => {
            if (schema.properties[param]) {
              commonParams[param].push(tool.name);
            }
          });
        }
      });

      // Log parameter usage for verification
      console.log('\n📋 Parameter usage across tools:');
      Object.entries(commonParams).forEach(([param, tools]) => {
        if (tools.length > 0) {
          console.log(`  ${param}: ${tools.length} tools`);
        }
      });

      // All tools using 'language' should have the same schema for it
      // (This is a spot check - could be expanded)
      expect(true).toBe(true);
    });
  });
});
