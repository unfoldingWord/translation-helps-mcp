import { McpHttpClient, McpHttpError, type CallResult, type ToolInfo } from './client';
import { classifyOutcome, type Outcome } from './outcome';

/** The page's session: one per page load, shared by every component on the page. */
let session: { client: McpHttpClient; ready: Promise<McpHttpClient> } | null = null;
let tools: Promise<ToolInfo[]> | null = null;

/** Open the session (the initialize handshake) the first time a component needs it. */
function open(endpoint: string): Promise<McpHttpClient> {
	if (!session) {
		const client = new McpHttpClient(endpoint);
		const ready = client.initialize().then(() => client);
		session = { client, ready };
		ready.catch(() => forget(client));
	}
	return session.ready;
}

/** Drop a session the server no longer has, unless another call has replaced it already. */
function forget(client: McpHttpClient) {
	if (session?.client !== client) return;
	session = null;
	tools = null;
}

/** Open the session and list the server's tools. A tool call alone does not list them. */
export function connect(endpoint: string): Promise<ToolInfo[]> {
	if (!tools) {
		const listed = open(endpoint).then((client) => client.listTools());
		tools = listed;
		listed.catch(() => {
			if (tools === listed) tools = null;
		});
	}
	return tools;
}

export type RunResult = { result: CallResult | null; outcome: Outcome };

/**
 * Call a tool on the page's session. A 404 means the server no longer has the session
 * (MCP Streamable HTTP): open a new one and try once more.
 */
async function callTool(
	endpoint: string,
	tool: string,
	args: Record<string, unknown>
): Promise<CallResult> {
	const used = await open(endpoint);
	try {
		return await used.callTool(tool, args);
	} catch (error) {
		if (!(error instanceof McpHttpError && error.status === 404)) throw error;
		forget(used);
		return (await open(endpoint)).callTool(tool, args);
	}
}

/** Call a tool and sort the answer into something the page can show. */
export async function run(
	endpoint: string,
	tool: string,
	args: Record<string, unknown>
): Promise<RunResult> {
	try {
		const result = await callTool(endpoint, tool, args);
		return { result, outcome: classifyOutcome({ status: result.exchange.status, result }) };
	} catch (error) {
		if (error instanceof McpHttpError) {
			return {
				result: null,
				outcome: classifyOutcome({
					status: error.status,
					error,
					retryAfter: error.retryAfter,
					endpoint
				})
			};
		}
		return { result: null, outcome: classifyOutcome({ status: 0, error, endpoint }) };
	}
}

/** Whether a tool's live schema has a parameter (for features that need a newer server). */
export function hasParam(tools: ToolInfo[], tool: string, param: string): boolean {
	const t = tools.find((x) => x.name === tool);
	const props = (t?.inputSchema?.properties ?? {}) as Record<string, unknown>;
	return param in props;
}
