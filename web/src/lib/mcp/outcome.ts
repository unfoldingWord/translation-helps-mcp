import { McpHttpError, type CallResult } from './client';

export type Outcome =
	| { kind: 'ok' }
	| { kind: 'not-available'; message: string }
	| { kind: 'upstream'; message: string }
	| { kind: 'rate-limited'; retryAfterSeconds: number }
	| { kind: 'error'; message: string };

const UPSTREAM = /UPSTREAM_DCS_ERROR/;
/** HTTP statuses a proxy or gateway gives when the server behind it is down. */
const UNREACHABLE_STATUS = [500, 502, 503, 504];
const NOT_AVAILABLE = 'RESOURCE_NOT_AVAILABLE';

/**
 * Sort a tool call into what the page should tell the person.
 * `endpoint` is only used to name the server when it cannot be reached.
 */
export function classifyOutcome(input: {
	status: number;
	result?: CallResult;
	error?: unknown;
	retryAfter?: string | null;
	endpoint?: string;
}): Outcome {
	if (input.status === 429) {
		const n = Number.parseInt(input.retryAfter ?? '', 10);
		return { kind: 'rate-limited', retryAfterSeconds: Number.isFinite(n) && n > 0 ? n : 60 };
	}
	if (input.error !== undefined) {
		// fetch rejects with a TypeError when there is no network or the server is down.
		// A dev proxy or gateway with nothing behind it answers 500, 502, 503 or 504 instead.
		const unreachable =
			input.error instanceof TypeError ||
			(input.error instanceof McpHttpError && UNREACHABLE_STATUS.includes(input.error.status));
		if (unreachable) {
			return {
				kind: 'error',
				message: `Can't reach the server at ${input.endpoint ?? 'this address'}. Check your connection and try again.`
			};
		}
		const message = input.error instanceof Error ? input.error.message : String(input.error);
		return UPSTREAM.test(message) ? { kind: 'upstream', message } : { kind: 'error', message };
	}
	const result = input.result;
	if (!result) return { kind: 'error', message: 'No answer from the server.' };
	const structured = result.structured;
	if (
		structured?.available === false ||
		structured?.code === NOT_AVAILABLE ||
		result.text.startsWith(NOT_AVAILABLE)
	) {
		const message =
			typeof structured?.message === 'string' && structured.message
				? structured.message
				: structured
					? 'This content is not available.'
					: result.text;
		return { kind: 'not-available', message };
	}
	if (result.isError) {
		return UPSTREAM.test(result.text)
			? { kind: 'upstream', message: result.text }
			: { kind: 'error', message: result.text || 'The tool returned an error.' };
	}
	return { kind: 'ok' };
}
