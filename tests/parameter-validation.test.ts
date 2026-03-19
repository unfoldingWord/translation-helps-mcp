/**
 * Parameter Validation Tests
 * 
 * Tests all parameter combinations for Translation Academy and Translation Word endpoints
 * to ensure they work correctly and fail appropriately.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8174';
const MCP_URL = `${BASE_URL}/api/mcp`;

// Helper to make REST API calls
async function fetchREST(endpoint: string, params: Record<string, string>) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([_, v]) => v !== undefined)
  ).toString();
  const url = `${BASE_URL}${endpoint}?${query}`;
  const response = await fetch(url);
  return {
    status: response.status,
    data: response.ok ? await response.json() : await response.text()
  };
}

// Helper to make MCP calls
async function fetchMCP(toolName: string, args: Record<string, any>) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  const result = await response.json();
  return {
    status: response.status,
    data: result.result || result.error,
    error: result.error
  };
}

describe('Translation Academy - Organization Parameter', () => {
  describe('REST API', () => {
    it('should find es-419 resource with empty organization (search all)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es',
        organization: '',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
      expect(result.data.title).toMatch(/metáfora/i); // Spanish content
    });

    it('should find es-419 resource with omitted organization (search all)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es',
        format: 'json',
        topic: 'tc-ready'
        // organization omitted
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
      expect(result.data.title).toMatch(/metáfora/i);
    });

    it('should return 404 for unfoldingWord organization with es-419 (not found)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es',
        organization: 'unfoldingWord',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(404);
      expect(result.data).toMatch(/not available/i);
    });

    it('should find resource with explicit es-419_gl organization', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es-419',
        organization: 'es-419_gl',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
    });

    it('should find English resource with unfoldingWord organization', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        organization: 'unfoldingWord',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data.title).toBe('Metaphor');
    });
  });

  describe('MCP API', () => {
    it('should find es-419 resource with empty organization (MCP)', async () => {
      const result = await fetchMCP('fetch_translation_academy', {
        path: 'translate/figs-metaphor',
        language: 'es',
        organization: '',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data.content[0].text).toContain('Metáfora');
    });

    it('should return error for unfoldingWord with es-419 (MCP)', async () => {
      const result = await fetchMCP('fetch_translation_academy', {
        path: 'translate/figs-metaphor',
        language: 'es',
        organization: 'unfoldingWord',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.error).toBeDefined();
      expect(result.error.message).toMatch(/not available/i);
    });
  });
});

describe('Translation Academy - Format Parameter', () => {
  describe('Valid Formats', () => {
    it('should return JSON format', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'json'
      });
      
      expect(result.status).toBe(200);
      expect(typeof result.data).toBe('object');
      expect(result.data).toHaveProperty('title');
      expect(result.data).toHaveProperty('content');
    });

    it('should return markdown format', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'md'
      });
      
      expect(result.status).toBe(200);
      expect(typeof result.data).toBe('string');
      expect(result.data).toMatch(/^#\s+Metaphor/); // Markdown header
    });

    it('should return markdown format (markdown alias)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'markdown'
      });
      
      expect(result.status).toBe(200);
      expect(typeof result.data).toBe('string');
      expect(result.data).toMatch(/^#\s+Metaphor/);
    });
  });

  describe('Invalid Formats', () => {
    it('should reject "text" format (400)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'text'
      });
      
      expect(result.status).toBe(400);
      expect(result.data).toMatch(/format is invalid/i);
    });

    it('should reject "usfm" format (400)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'usfm'
      });
      
      expect(result.status).toBe(400);
    });

    it('should reject invalid format (400)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'invalid'
      });
      
      expect(result.status).toBe(400);
    });
  });

  describe('MCP Format Handling', () => {
    it('should handle md format in MCP and return text', async () => {
      const result = await fetchMCP('fetch_translation_academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'md'
      });
      
      expect(result.status).toBe(200);
      expect(result.data.content[0].text).toMatch(/^#\s+Metaphor/);
      expect(result.data.content[0].text).not.toBe('No translation academy content found');
    });

    it('should handle json format in MCP', async () => {
      const result = await fetchMCP('fetch_translation_academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        format: 'json'
      });
      
      expect(result.status).toBe(200);
      const parsed = JSON.parse(result.data.content[0].text);
      expect(parsed).toHaveProperty('title');
    });
  });
});

describe('Translation Academy - Language & Variant Auto-Retry', () => {
  it('should auto-retry es → es-419 with empty org', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es',
      organization: '',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(result.data.title).toMatch(/metáfora/i);
  });

  it('should NOT auto-retry to different org when org is explicit', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es',
      organization: 'unfoldingWord',
      format: 'json'
    });
    
    // Should NOT find es-419_gl resource because org is explicit
    expect(result.status).toBe(404);
  });

  it('should work directly with variant language', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es-419',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(result.data.title).toMatch(/metáfora/i);
  });
});

describe('Translation Academy - Topic Parameter', () => {
  it('should work with tc-ready topic', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'en',
      topic: 'tc-ready',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
  });

  it('should work with omitted topic (defaults to tc-ready)', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'en',
      format: 'json'
      // topic omitted
    });
    
    expect(result.status).toBe(200);
  });
});

describe('Translation Academy - Path Parameter', () => {
  it('should return 404 for invalid path', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      path: 'invalid/nonexistent-path',
      language: 'en',
      format: 'json'
    });
    
    expect(result.status).toBe(404);
  });

  it('should return TOC when path is omitted', async () => {
    const result = await fetchREST('/api/fetch-translation-academy', {
      language: 'en',
      format: 'json'
      // path omitted
    });
    
    expect(result.status).toBe(404);
    expect(result.data).toMatch(/table-of-contents|Translation Academy/i);
  });

  it('should work with different valid paths', async () => {
    const paths = [
      'translate/figs-metaphor',
      'translate/figs-idiom',
      'intro/ta-intro'
    ];

    for (const path of paths) {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path,
        language: 'en',
        format: 'json'
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
    }
  });
});

describe('Translation Word - Organization Parameter', () => {
  it('should find resource with empty organization', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'es',
      organization: '',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('title');
  });

  it('should return 404 for unfoldingWord with es-419', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'es',
      organization: 'unfoldingWord',
      format: 'json'
    });
    
    expect(result.status).toBe(404);
  });

  it('should work with English and unfoldingWord', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      organization: 'unfoldingWord',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(result.data.title).toMatch(/love/i);
  });
});

describe('Translation Word - Format Parameter', () => {
  it('should return JSON format', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(typeof result.data).toBe('object');
    expect(result.data).toHaveProperty('title');
    expect(result.data).toHaveProperty('definition');
    expect(result.data).toHaveProperty('content');
  });

  it('should return markdown format', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      format: 'md'
    });
    
    expect(result.status).toBe(200);
    expect(typeof result.data).toBe('string');
    expect(result.data).toMatch(/^#/); // Markdown header
  });

  it('should reject invalid format', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      format: 'text'
    });
    
    expect(result.status).toBe(400);
  });
});

describe('Translation Word - Category Parameter', () => {
  it('should work with kt category', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      category: 'kt',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
    expect(result.data.path).toContain('kt');
  });

  it('should work with names category', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/names/paul',
      language: 'en',
      category: 'names',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
  });

  it('should work with other category', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/other/shepherd',
      language: 'en',
      category: 'other',
      format: 'json'
    });
    
    expect(result.status).toBe(200);
  });

  it('should reject invalid category', async () => {
    const result = await fetchREST('/api/fetch-translation-word', {
      path: 'bible/kt/love',
      language: 'en',
      category: 'invalid',
      format: 'json'
    });
    
    expect(result.status).toBe(400);
  });
});

describe('Combined Parameter Tests', () => {
  describe('Valid Combinations', () => {
    it('should handle all parameters together (TA)', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es-419',
        organization: 'es-419_gl',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
      expect(result.data).toHaveProperty('metadata');
    });

    it('should handle all parameters together (TW)', async () => {
      const result = await fetchREST('/api/fetch-translation-word', {
        path: 'bible/kt/love',
        language: 'en',
        organization: 'unfoldingWord',
        category: 'kt',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty('title');
      expect(result.data).toHaveProperty('definition');
    });
  });

  describe('Invalid Combinations', () => {
    it('should fail with invalid format + valid other params', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'en',
        organization: 'unfoldingWord',
        format: 'invalid',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(400);
    });

    it('should fail with invalid path + valid other params', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'invalid/path',
        language: 'en',
        organization: 'unfoldingWord',
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(404);
    });

    it('should fail with explicit org that doesn\'t have resource', async () => {
      const result = await fetchREST('/api/fetch-translation-academy', {
        path: 'translate/figs-metaphor',
        language: 'es-419',
        organization: 'unfoldingWord', // doesn't have es-419 TA
        format: 'json',
        topic: 'tc-ready'
      });
      
      expect(result.status).toBe(404);
    });
  });
});

describe('Cache Behavior with Organization', () => {
  it('should not cache-share between different organizations', async () => {
    // First request: all orgs (should find es-419_gl)
    const result1 = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es-419',
      organization: '',
      format: 'json'
    });
    expect(result1.status).toBe(200);

    // Second request: explicit unfoldingWord (should be 404, not cached from above)
    const result2 = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es-419',
      organization: 'unfoldingWord',
      format: 'json'
    });
    expect(result2.status).toBe(404);

    // Third request: all orgs again (should still work)
    const result3 = await fetchREST('/api/fetch-translation-academy', {
      path: 'translate/figs-metaphor',
      language: 'es-419',
      organization: '',
      format: 'json'
    });
    expect(result3.status).toBe(200);
  });
});
