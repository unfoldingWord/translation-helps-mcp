/**
 * POST /api/skill/compose-help
 *
 * Composes a full translation report: fetches passage bundle then generates
 * an LLM-driven explanation.  Uses SkillService primitives.
 * Adds Zod validation, rate limiting, requestId, and canonical HTTP error codes.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

import { isRateLimited, retryAfterSeconds } from '$lib/rateLimiter.js';
import { generateRequestId } from '$lib/requestId.js';
import { validationError, rateLimitError, internalError } from '$lib/apiError.js';
import { SkillService } from '../../../../../../src/skill/SkillService.js';
import { FakeLLMProvider } from '../../../../../../src/services/rag/providers/FakeLLMProvider.js';
import { handleRagQuery } from '../../../../../../src/tools/ragQuery.js';
import { handleGetBundle } from '../../../../../../src/tools/getBundle.js';

const RATE_LIMIT = parseInt(process.env.SKILL_RATE_LIMIT ?? '30', 10);

const ComposeHelpSchema = z.object({
	language: z.string().min(1),
	reference: z.string().min(1),
	prompt: z.string().optional(),
	maxTokens: z.number().int().min(64).max(4096).optional(),
	requestId: z.string().optional()
});

/** Routes MCP tool calls to the local tool handlers. */
async function callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
	let mcpResult: { content: unknown[]; isError: boolean };

	if (name === 'rag_query') {
		mcpResult = await handleRagQuery(params as Parameters<typeof handleRagQuery>[0]);
	} else if (name === 'get_bundle') {
		mcpResult = await handleGetBundle(params as Parameters<typeof handleGetBundle>[0]);
	} else {
		throw new Error(`Unknown tool: ${name}`);
	}

	if (mcpResult.isError) {
		const errText =
			(mcpResult.content[0] as { type: string; text: string } | undefined)?.text ?? 'Tool error';
		throw new Error(errText);
	}

	const text = (mcpResult.content[0] as { type: string; text: string } | undefined)?.text ?? '{}';
	return JSON.parse(text);
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const key = `compose-help:${ip}`;

	if (isRateLimited(key, RATE_LIMIT)) {
		return rateLimitError(retryAfterSeconds(key));
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return internalError('Could not parse request body as JSON.');
	}

	const parsed = ComposeHelpSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error);
	}

	const requestId = parsed.data.requestId ?? generateRequestId();

	const service = new SkillService({
		callTool,
		llmProvider: new FakeLLMProvider(),
		requestId
	});

	try {
		const result = await service.composeTranslationReport(
			parsed.data.reference,
			parsed.data.language,
			parsed.data.prompt,
			{ maxTokens: parsed.data.maxTokens, requestId }
		);

		return json({ ...result, requestId }, { headers: { 'X-Request-Id': requestId } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return internalError(message);
	}
};
