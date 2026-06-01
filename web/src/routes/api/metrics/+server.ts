/**
 * GET /api/metrics — query Analytics Engine for per-tool performance data.
 *
 * Uses the Cloudflare Analytics Engine SQL API.
 * Returns stub data when the CLOUDFLARE_API_TOKEN env is not set.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const DATASET = 'translation_helps_metrics';

export const GET: RequestHandler = async () => {
	if (!ACCOUNT_ID || !API_TOKEN) {
		// Return empty (not stub) — the UI handles the empty state gracefully
		return json({
			metrics: [],
			note: 'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to enable live metrics.'
		});
	}

	try {
		// Query Analytics Engine SQL API
		const sql = `
      SELECT
        blob1 AS tool,
        count() AS calls,
        quantilesMerge(0.50)(double1_quantiles) AS p50,
        quantilesMerge(0.95)(double1_quantiles) AS p95,
        countIf(blob4 != 'OK') / count() AS errorRate,
        countIf(blob3 = 'hit') / count() AS cacheHitRate
      FROM ${DATASET}
      WHERE timestamp >= NOW() - INTERVAL '24' HOUR
      GROUP BY tool
      ORDER BY calls DESC
    `;

		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${API_TOKEN}`,
					'Content-Type': 'text/plain'
				},
				body: sql
			}
		);

		if (!response.ok) {
			throw new Error(`AE API error: ${response.status}`);
		}

		const data = (await response.json()) as {
			data: Array<{
				tool: string;
				calls: number;
				p50: number;
				p95: number;
				errorRate: number;
				cacheHitRate: number;
			}>;
		};

		const metrics = (data.data ?? []).map((row) => ({
			tool: row.tool,
			calls: Number(row.calls),
			p50Ms: Math.round(Number(row.p50)),
			p95Ms: Math.round(Number(row.p95)),
			errorRate: Number(row.errorRate),
			cacheHitRate: Number(row.cacheHitRate)
		}));

		return json({ metrics });
	} catch (e) {
		return json(
			{ metrics: [], error: e instanceof Error ? e.message : String(e) },
			{ status: 200 }
		);
	}
};
