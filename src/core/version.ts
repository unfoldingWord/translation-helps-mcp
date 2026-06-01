/**
 * Single source-of-truth version for the entire project.
 * This value flows to:
 *   - The MCP server initialize handshake
 *   - The website footer
 *   - Both SDKs (via Changesets release pipeline)
 */
export const VERSION = "2.0.0";

export const SERVER_NAME = "translation-helps-mcp";
