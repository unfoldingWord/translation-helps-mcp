/**
 * POST /api/skill/fetch-passage
 *
 * Retrieves a fully-assembled translation bundle (scripture + notes + TW + TA).
 * Delegates to the get_bundle MCP tool handler.
 * Adds Zod validation, rate limiting, requestId, and canonical HTTP error codes.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { isRateLimited, retryAfterSeconds } from '$lib/rateLimiter.js';
import { generateRequestId } from '$lib/requestId.js';
import { validationError, rateLimitError, internalError } from '$lib/apiError.js';
import { handleGetBundle } from '../../../../../../src/tools/getBundle.js';

const RATE_LIMIT = parseInt(process.env.SKILL_RATE_LIMIT ?? '60', 10);

const FetchPassageSchema = z.object({
	language: z.string().min(1),
	reference: z.string().min(1),
	owner: z.string().optional(),
	project: z.string().optional(),
	force: z.boolean().optional(),
	requestId: z.string().optional()
});

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const key = `fetch-passage:${ip}`;

	if (isRateLimited(key, RATE_LIMIT)) {
		return rateLimitError(retryAfterSeconds(key));
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return internalError('Could not parse request body as JSON.');
	}

	const parsed = FetchPassageSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error);
	}

	const requestId = parsed.data.requestId ?? generateRequestId();
	const args = { ...parsed.data, requestId };

	try {
		const mcpResult = await handleGetBundle(args);

		if (mcpResult.isError) {
			const errText =
				(mcpResult.content[0] as { type: string; text: string } | undefined)?.text ??
				'Unknown error';
			return internalError(errText);
		}

		const bundleText =
			(mcpResult.content[0] as { type: string; text: string } | undefined)?.text ?? '{}';
		const bundle = JSON.parse(bundleText);

		return json(
			{ bundle, requestId, metadata: mcpResult.metadata },
			{
				headers: { 'X-Request-Id': requestId }
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return internalError(message);
	}
};
