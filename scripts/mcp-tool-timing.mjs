#!/usr/bin/env node
/**
 * One-off / CI helper: measure MCP tool round-trip times against a running server.
 * Usage: node scripts/mcp-tool-timing.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:8174
 */
const base = process.argv[2] || "http://127.0.0.1:8174";

async function mcp(method, params) {
	const t0 = performance.now();
	const r = await fetch(`${base}/api/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	const t1 = performance.now();
	const text = await r.text();
	let j;
	try {
		j = JSON.parse(text);
	} catch {
		j = { parseError: text.slice(0, 200) };
	}
	return {
		wall_ms: +(t1 - t0).toFixed(1),
		http: r.status,
		x_response_time: r.headers.get("x-response-time"),
		x_cache_status: r.headers.get("x-cache-status"),
		ok: r.ok && !j.error,
		err: j.error || null,
		bytes: text.length,
	};
}

async function tool(name, args) {
	return mcp("tools/call", { name, arguments: args });
}

const fsArgs = {
	reference: "JHN 3:16",
	language: "en",
	organization: "unfoldingWord",
	stage: "prod",
};

const rows = [];
rows.push(["tools/list", await mcp("tools/list", {})]);
rows.push(["list_languages", await tool("list_languages", { stage: "prod" })]);
rows.push(["list_subjects", await tool("list_subjects", { stage: "prod" })]);
rows.push([
	"list_resources_for_language",
	await tool("list_resources_for_language", { language: "en", stage: "prod" }),
]);
rows.push(["fetch_scripture (1st)", await tool("fetch_scripture", fsArgs)]);
rows.push(["fetch_scripture (2nd)", await tool("fetch_scripture", fsArgs)]);
rows.push([
	"fetch_translation_notes",
	await tool("fetch_translation_notes", { ...fsArgs }),
]);

console.log(`\nMCP timing — ${base} (wall_ms = browser/client round-trip)\n`);
for (const [name, o] of rows) {
	const extra = [
		o.x_cache_status ? `cache:${o.x_cache_status}` : "",
		o.x_response_time ? `srv:${o.x_response_time}` : "",
		o.ok ? "OK" : `FAIL ${JSON.stringify(o.err).slice(0, 160)}`,
	]
		.filter(Boolean)
		.join(" ");
	console.log(
		`${name.padEnd(34)} ${String(o.wall_ms).padStart(8)} ms  HTTP ${o.http}  ${extra}`,
	);
}
