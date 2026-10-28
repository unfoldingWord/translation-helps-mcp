/**
 * The checks on /status. Plain TypeScript with relative imports only: the tests and the root tsc read it.
 * One check per tool, called with the example the Tools page shows, plus the MCP handshake and the REST API.
 */
import { TOOL_GROUPS } from './catalog';
import type { Outcome } from './mcp/outcome';
import { PRESETS } from './try/presets';
import { API } from './site';

export type StatusCheck = {
	id: string;
	label: string;
	/** The tool to call. Empty for the two checks that are not tool calls. */
	tool: string;
	args: Record<string, unknown>;
};

/** The REST API's health route, which answers `{ status: "ok" }` without touching Door43 (src/api/worker.ts). */
export const REST_HEALTH_URL = `${API.origin}/health`;

/** The same example the Tools page shows: the first Try example that needs nothing newer than the server has. */
function exampleArgs(tool: string): Record<string, unknown> {
	return PRESETS.find((p) => p.tool === tool && !p.needs?.length)?.args ?? {};
}

export const STATUS_CHECKS: StatusCheck[] = [
	{ id: 'mcp-initialize', label: 'MCP connection', tool: '', args: {} },
	{ id: 'rest-health', label: 'REST API', tool: '', args: {} },
	...TOOL_GROUPS.flatMap((g) => g.tools).map((tool) => ({
		id: tool,
		label: tool,
		tool,
		args: exampleArgs(tool)
	}))
];

export type CheckState = 'ok' | 'not-available' | 'failed';
export type CheckResult = { state: CheckState; ms: number; note: string };

/** What a check needs from the outside, so the page can use the browser and a test can use fakes. */
export type CheckIo = {
	now: () => number;
	/** Open a fresh MCP session. */
	initialize: () => Promise<void>;
	fetchHealth: () => Promise<Response>;
	callTool: (tool: string, args: Record<string, unknown>) => Promise<Outcome>;
};

function fromOutcome(outcome: Outcome): Pick<CheckResult, 'state' | 'note'> {
	switch (outcome.kind) {
		case 'ok':
			return { state: 'ok', note: '' };
		case 'not-available':
			return { state: 'not-available', note: outcome.message };
		case 'rate-limited':
			return {
				state: 'failed',
				note: `Rate limited. Try again in ${outcome.retryAfterSeconds} s.`
			};
		default:
			return { state: 'failed', note: outcome.message };
	}
}

/** Run one check and say how it went, with the time it took in ms. A check never throws. */
export async function runCheck(check: StatusCheck, io: CheckIo): Promise<CheckResult> {
	const start = io.now();
	let part: Pick<CheckResult, 'state' | 'note'>;
	try {
		if (check.id === 'mcp-initialize') {
			await io.initialize();
			part = { state: 'ok', note: '' };
		} else if (check.id === 'rest-health') {
			const res = await io.fetchHealth();
			part = res.ok ? { state: 'ok', note: '' } : { state: 'failed', note: `HTTP ${res.status}` };
		} else {
			part = fromOutcome(await io.callTool(check.tool, check.args));
		}
	} catch (error) {
		part = { state: 'failed', note: error instanceof Error ? error.message : String(error) };
	}
	return { ...part, ms: io.now() - start };
}
