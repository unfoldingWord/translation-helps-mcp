#!/usr/bin/env node
/**
 * Routing check for a running v1 build (CI runs it against `wrangler pages dev`).
 *
 * Usage: node scripts/check-routing.js [baseUrl] [timeoutSeconds]
 *
 * Every v1 page in src/lib/v1-page-redirects.json (the list the hook uses) must
 * answer 302 to its own /v2 target with the query string kept, and /mcp,
 * /api/mcp and /api/health must still answer as v1 does. Exits 1 on any failure.
 */
import { readFileSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://localhost:8788';
const timeoutSeconds = Number(process.argv[3] ?? 60);
const redirects = JSON.parse(
	readFileSync(new URL('../src/lib/v1-page-redirects.json', import.meta.url), 'utf8')
);

const INITIALIZE = JSON.stringify({
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-03-26',
		capabilities: {},
		clientInfo: { name: 'routing-check', version: '1.0.0' }
	}
});

const failures = [];

function check(label, ok, detail) {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (${detail})`}`);
	if (!ok) failures.push(label);
}

async function waitForServer() {
	const deadline = Date.now() + timeoutSeconds * 1000;
	let lastError = 'no answer';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(new URL('/api/health', baseUrl));
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error.cause?.code ?? error.message;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	console.error(
		`Server at ${baseUrl} did not answer /api/health within ${timeoutSeconds}s (last: ${lastError})`
	);
	process.exit(1);
}

async function checkRedirect(path, target) {
	for (const method of ['GET', 'HEAD']) {
		const url = new URL(`${path}?routing-check=1`, baseUrl);
		const expected = new URL(`${target}?routing-check=1`, baseUrl).href;
		const response = await fetch(url, { method, redirect: 'manual' });
		const location = response.headers.get('location');
		const actual = location ? new URL(location, url).href : null;
		check(
			`${method} ${path} -> 302 ${target}`,
			response.status === 302 && actual === expected,
			`got ${response.status} ${actual ?? 'no location'}`
		);
	}
}

async function checkInitialize(path) {
	const response = await fetch(new URL(path, baseUrl), {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream'
		},
		body: INITIALIZE
	});
	const body = await response.text();
	check(
		`POST ${path} initialize -> 200 with serverInfo`,
		response.status === 200 && body.includes('"serverInfo"'),
		`got ${response.status} ${body.slice(0, 120)}`
	);
}

await waitForServer();

for (const [source, target] of redirects) {
	if (source.endsWith('/*')) {
		const base = source.slice(0, -2);
		await checkRedirect(base, target);
		await checkRedirect(`${base}/routing-check`, target);
	} else {
		await checkRedirect(source, target);
	}
}

await checkInitialize('/mcp');
await checkInitialize('/api/mcp');

const mcpInfo = await fetch(new URL('/mcp', baseUrl), { redirect: 'manual' });
check('GET /mcp -> 200', mcpInfo.status === 200, `got ${mcpInfo.status}`);

// Bare /api has no index route and 404s (issue #26), so check a real API route.
const health = await fetch(new URL('/api/health', baseUrl), { redirect: 'manual' });
const healthBody = await health.text();
check(
	'GET /api/health -> 200 healthy',
	health.status === 200 && healthBody.includes('healthy'),
	`got ${health.status} ${healthBody.slice(0, 120)}`
);

const mcpStream = await fetch(new URL('/api/mcp', baseUrl), {
	redirect: 'manual',
	headers: { accept: 'text/event-stream' }
});
check('GET /api/mcp (event-stream) -> 405', mcpStream.status === 405, `got ${mcpStream.status}`);

if (failures.length > 0) {
	console.error(`\n${failures.length} routing check(s) failed`);
	process.exit(1);
}
console.log('\nAll routing checks passed');
