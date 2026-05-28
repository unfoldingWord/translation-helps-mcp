/**
 * Helpers for returning canonical error JSON responses from SvelteKit endpoints.
 *
 * Error shape matches CONTRACTS_DETAILED.md §5.
 */

import { json } from '@sveltejs/kit';
import type { ZodError } from 'zod';

export interface ApiError {
	code: string;
	message: string;
	details?: unknown;
	retryable?: boolean;
}

export function errorResponse(
	status: number,
	code: string,
	message: string,
	details?: unknown,
	retryable?: boolean
) {
	const body: ApiError = { code, message };
	if (details !== undefined) body.details = details;
	if (retryable !== undefined) body.retryable = retryable;
	return json(body, { status });
}

export function validationError(err: ZodError) {
	return errorResponse(400, 'INVALID_PARAMS', 'Request validation failed', {
		issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
	});
}

export function rateLimitError(retryAfter: number) {
	return new Response(
		JSON.stringify({
			code: 'RATE_LIMITED',
			message: 'Too many requests — please slow down.',
			retryable: true
		}),
		{
			status: 429,
			headers: {
				'Content-Type': 'application/json',
				'Retry-After': String(retryAfter)
			}
		}
	);
}

export function internalError(message: string, details?: unknown) {
	return errorResponse(500, 'INTERNAL_ERROR', message, details);
}
