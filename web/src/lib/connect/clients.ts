/**
 * Setup for each MCP client. Plain TypeScript with no imports: the tests and the root tsc read it.
 * The server needs no key, so every snippet is only the server URL in the shape the client reads.
 */
const SERVER_KEY = 'translation-helps';

function toBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

/** One-click install link for Cursor. */
export function cursorDeeplink(endpoint: string): string {
	const config = toBase64(JSON.stringify({ url: endpoint }));
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_KEY}&config=${encodeURIComponent(config)}`;
}

/** One-click install link for VS Code. */
export function vscodeDeeplink(endpoint: string): string {
	const config = JSON.stringify({ type: 'http', url: endpoint });
	return `https://vscode.dev/redirect/mcp/install?name=${SERVER_KEY}&config=${encodeURIComponent(config)}`;
}

export type ClientSetup = {
	id: string;
	label: string;
	steps: string;
	tabs: { label: string; code: string }[];
	install?: { label: string; href: string };
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Setup for each client, in the order the Connect page lists them. */
export function CLIENTS(endpoint: string): ClientSetup[] {
	return [
		{
			id: 'claude-desktop',
			label: 'Claude Desktop',
			steps:
				'In Claude, open Settings, then Connectors, and choose Add custom connector. Paste the URL and give it a name. If your plan has no custom connectors, Claude Desktop can reach the server through mcp-remote in claude_desktop_config.json.',
			tabs: [
				{ label: 'Connector URL', code: endpoint },
				{
					label: 'claude_desktop_config.json',
					code: json({
						mcpServers: { [SERVER_KEY]: { command: 'npx', args: ['-y', 'mcp-remote', endpoint] } }
					})
				}
			]
		},
		{
			id: 'claude-code',
			label: 'Claude Code',
			steps:
				'Run this once in your terminal. The server is then available in every Claude Code session.',
			tabs: [
				{ label: 'Terminal', code: `claude mcp add --transport http ${SERVER_KEY} ${endpoint}` }
			]
		},
		{
			id: 'cursor',
			label: 'Cursor',
			steps:
				'Use the install button, or add the server to ~/.cursor/mcp.json (all projects) or .cursor/mcp.json (one project).',
			tabs: [
				{ label: 'mcp.json', code: json({ mcpServers: { [SERVER_KEY]: { url: endpoint } } }) }
			],
			install: { label: 'Install in Cursor', href: cursorDeeplink(endpoint) }
		},
		{
			id: 'vscode',
			label: 'VS Code',
			steps:
				'Use the install button, run the command, or add the server to .vscode/mcp.json. VS Code uses the key "servers", not "mcpServers".',
			tabs: [
				{
					label: '.vscode/mcp.json',
					code: json({ servers: { [SERVER_KEY]: { type: 'http', url: endpoint } } })
				},
				{
					label: 'Terminal',
					code: `code --add-mcp '${JSON.stringify({ name: SERVER_KEY, type: 'http', url: endpoint })}'`
				}
			],
			install: { label: 'Install in VS Code', href: vscodeDeeplink(endpoint) }
		},
		{
			id: 'chatgpt',
			label: 'ChatGPT',
			steps:
				'ChatGPT can use a remote MCP server as a custom connector. It needs only this URL; where to add it depends on your plan and workspace.',
			tabs: [{ label: 'Server URL', code: endpoint }]
		},
		{
			id: 'other',
			label: 'Other clients',
			steps:
				'Any client that supports MCP over Streamable HTTP can use the URL as it is. For a client that can only start local programs, run it through mcp-remote.',
			tabs: [
				{ label: 'URL', code: endpoint },
				{ label: 'mcp-remote', code: `npx -y mcp-remote ${endpoint}` }
			]
		}
	];
}
