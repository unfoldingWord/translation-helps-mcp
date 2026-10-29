/**
 * The checks on /status. Plain TypeScript with relative imports only: the tests and the root tsc read it.
 * One check per tool, called with the example the Tools page shows, plus the MCP handshake and the REST API.
 */
import type { ToolDoc } from './catalog';
import type { Outcome } from './mcp/outcome';
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

/**
 * The checks for the tools of the Tools page (`buildToolCatalog`), in its order, each with
 * the example it shows there: a Try example, or the manifest's when the tool has none.
 */
export function statusChecks(tools: Pick<ToolDoc, 'name' | 'example'>[]): StatusCheck[] {
	return [
		{ id: 'mcp-initialize', label: 'MCP connection', tool: '', args: {} },
		{ id: 'rest-health', label: 'REST API', tool: '', args: {} },
		...tools.map((t) => ({ id: t.name, label: t.name, tool: t.name, args: t.example.args }))
	];
}

export type CheckState = 'ok' | 'not-available' | 'failed';
export type CheckResult = { state: CheckState; ms: number; note: string };

/** What a check needs from the outside, so the page can use the browser and a test can use fakes. */
export type CheckIo = {
	now: () => number;
	/** Open a fresh MCP session. */
	initialize: () => Promise<void>;
	/** Aborted when the check times out, so a real fetch stops too. */
	fetchHealth: (signal: AbortSignal) => Promise<Response>;
	callTool: (tool: string, args: Record<string, unknown>) => Promise<Outcome>;
	/** How long one check may take before it counts as failed. Default: 30 s, like the MCP client. */
	timeoutMs?: number;
};

export const CHECK_TIMEOUT_MS = 30_000;

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

/** Run one check and say how it went, with the time it took in ms. A check never throws and never hangs. */
export async function runCheck(check: StatusCheck, io: CheckIo): Promise<CheckResult> {
	const start = io.now();
	const limit = io.timeoutMs ?? CHECK_TIMEOUT_MS;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(`No answer in ${Math.round(limit / 1000)} s.`));
		}, limit);
	});
	const attempt = async (): Promise<Pick<CheckResult, 'state' | 'note'>> => {
		if (check.id === 'mcp-initialize') {
			await io.initialize();
			return { state: 'ok', note: '' };
		}
		if (check.id === 'rest-health') {
			const res = await io.fetchHealth(controller.signal);
			return res.ok ? { state: 'ok', note: '' } : { state: 'failed', note: `HTTP ${res.status}` };
		}
		return fromOutcome(await io.callTool(check.tool, check.args));
	};
	let part: Pick<CheckResult, 'state' | 'note'>;
	try {
		part = await Promise.race([attempt(), timeout]);
	} catch (error) {
		part = { state: 'failed', note: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
	return { ...part, ms: io.now() - start };
}
