/**
 * POST /api/skill/generate
 *
 * Generates an LLM-driven translation help response from a pre-assembled bundle.
 * Input: { bundle, userPrompt, maxTokens?, citations? }
 * Output: { response, citations, requestId }
 *
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
import type { Bundle } from '../../../../../../src/services/rag/BundleCache.js';

const RATE_LIMIT = parseInt(process.env.SKILL_RATE_LIMIT ?? '30', 10);

/** Loose schema for the bundle — we trust the caller since we can't enumerate every field. */
const BundleSchema = z.object({
	scripture: z.object({ text: z.string(), format: z.string() }).passthrough().optional(),
	notes: z.array(z.record(z.unknown())).optional(),
	tw: z.array(z.record(z.unknown())).optional(),
	ta: z.array(z.record(z.unknown())).optional(),
	metadata: z.record(z.unknown()).optional()
});

const GenerateSchema = z.object({
	bundle: BundleSchema,
	userPrompt: z.string().min(1),
	maxTokens: z.number().int().min(64).max(4096).optional(),
	citations: z.boolean().optional(),
	requestId: z.string().optional()
});

/** Stub callTool — generate endpoint does not need MCP tool routing. */
async function noopCallTool(_name: string, _params: Record<string, unknown>): Promise<unknown> {
	return {};
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const key = `generate:${ip}`;

	if (isRateLimited(key, RATE_LIMIT)) {
		return rateLimitError(retryAfterSeconds(key));
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return internalError('Could not parse request body as JSON.');
	}

	const parsed = GenerateSchema.safeParse(body);
	if (!parsed.success) {
		return validationError(parsed.error);
	}

	const requestId = parsed.data.requestId ?? generateRequestId();

	const service = new SkillService({
		callTool: noopCallTool,
		llmProvider: new FakeLLMProvider(),
		requestId
	});

	try {
		const result = await service.generateTranslationHelp(
			parsed.data.bundle as Bundle,
			parsed.data.userPrompt,
			{
				maxTokens: parsed.data.maxTokens,
				citations: parsed.data.citations,
				requestId
			}
		);

		return json({ ...result, requestId }, { headers: { 'X-Request-Id': requestId } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return internalError(message);
	}
};
