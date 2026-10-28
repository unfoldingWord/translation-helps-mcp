/** Quote a value for a POSIX shell. */
function sh(value: string): string {
	return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

const PROTOCOL_VERSION = '2025-03-26';

/** The JSON-RPC body of a tool call, as the page sends it. */
function callBody(tool: string, args: object) {
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name: tool, arguments: args }
	};
}

/**
 * The same call as curl commands. The server needs a session, so the first
 * command opens one and keeps its id, and the second makes the call. The server
 * keeps each event stream open after answering, so curl stops after a time limit.
 */
export function curlFor(endpoint: string, tool: string, args: object): string {
	const init = JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: 'curl', version: '1' }
		}
	});
	const call = JSON.stringify({ ...callBody(tool, args), id: 2 });
	const headers = `-H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream'`;
	return [
		'# 1. Open a session and keep its id',
		`SID=$(curl -s --max-time 5 -D - -o /dev/null -X POST ${sh(endpoint)} ${headers} \\`,
		`  -d ${sh(init)} | tr -d '\\r' | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')`,
		'',
		'# 2. Call the tool',
		`curl -s --max-time 20 -X POST ${sh(endpoint)} ${headers} \\`,
		`  -H "Mcp-Session-Id: $SID" \\`,
		`  -d ${sh(call)}`
	].join('\n');
}

/** The JSON-RPC body of the call, for any MCP client or HTTP tool. */
export function jsonRpcFor(tool: string, args: object): string {
	return JSON.stringify(callBody(tool, args), null, 2);
}

/** The server entry for an MCP client's config file (Cursor, VS Code, and others). */
export function mcpConfigFor(endpoint: string): string {
	return JSON.stringify({ mcpServers: { 'translation-helps': { url: endpoint } } }, null, 2);
}
