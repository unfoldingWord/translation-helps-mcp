/**
 * POST /api/skill/query
 *
 * Transparent pass-through to the rag_query MCP tool.
 * Adds Zod validation, rate limiting, requestId, and canonical HTTP error codes.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { isRateLimited, retryAfterSeconds } from '$lib/rateLimiter.js';
import { generateRequestId } from '$lib/requestId.js';
import { validationError, rateLimitError, internalError } from '$lib/apiError.js';
import { RagQueryArgs, handleRagQuery } from '../../../../../../src/tools/ragQuery.js';

const RATE_LIMIT = parseInt(process.env.SKILL_RATE_LIMIT ?? '60', 10);

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const key = `query:${ip}`;

	if (isRateLimited(key, RATE_LIMIT)) {
		return rateLimitError(retryAfterSeconds(key));
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return internalError('Could not parse request body as JSON.');
	}

	const parsed = RagQueryArgs.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error);
	}

	const requestId = parsed.data.requestId ?? generateRequestId();
	const args = { ...parsed.data, requestId };

	try {
		const mcpResult = await handleRagQuery(args);

		if (mcpResult.isError) {
			const errText =
				(mcpResult.content[0] as { type: string; text: string } | undefined)?.text ??
				'Unknown error';
			return internalError(errText);
		}

		const resultText =
			(mcpResult.content[0] as { type: string; text: string } | undefined)?.text ?? '{}';
		const data = JSON.parse(resultText);

		return json(
			{ ...data, requestId },
			{
				headers: { 'X-Request-Id': requestId }
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return internalError(message);
	}
};
