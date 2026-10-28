import { McpHttpClient, McpHttpError, type CallResult, type ToolInfo } from './client';
import { classifyOutcome, type Outcome } from './outcome';

let client: McpHttpClient | null = null;
let ready: Promise<ToolInfo[]> | null = null;

/** One MCP session per page load, shared by every component on the page. */
export function connect(endpoint: string): Promise<ToolInfo[]> {
	if (!ready) {
		client = new McpHttpClient(endpoint);
		ready = client
			.initialize()
			.then(() => client!.listTools())
			.catch((err) => {
				ready = null;
				throw err;
			});
	}
	return ready;
}

export type RunResult = { result: CallResult | null; outcome: Outcome };

/** Call a tool and sort the answer into something the page can show. */
export async function run(
	endpoint: string,
	tool: string,
	args: Record<string, unknown>
): Promise<RunResult> {
	try {
		await connect(endpoint);
		const result = await client!.callTool(tool, args);
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
