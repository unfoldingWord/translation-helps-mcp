/**
 * Mock for $env/dynamic/private in tests
 */
export const env = {
	OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
	ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
	PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || ''
};
