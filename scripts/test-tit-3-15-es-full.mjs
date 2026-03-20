#!/usr/bin/env node
const ref = "TIT 3:15";
// Recommended: omit organization so Spanish TN is found from whichever org publishes it.
// unfoldingWord does not publish Spanish TN — uw rows are negative checks only.
const scenarios = [
	["LOCAL+es (all orgs)", "http://127.0.0.1:8174", "es", null],
	["LOCAL+es-419 (all orgs)", "http://127.0.0.1:8174", "es-419", null],
	["LOCAL+uw only (expect fail)", "http://127.0.0.1:8174", "es", "unfoldingWord"],
	["REMOTE+es (all orgs)", "https://tc-helps.mcp.servant.bible", "es", null],
	["REMOTE+es-419 (all orgs)", "https://tc-helps.mcp.servant.bible", "es-419", null],
	["REMOTE+uw only (expect fail)", "https://tc-helps.mcp.servant.bible", "es", "unfoldingWord"],
];

async function one(label, base, lang, org) {
	const u = new URL(`${base}/api/fetch-translation-notes`);
	u.searchParams.set("reference", ref);
	u.searchParams.set("language", lang);
	if (org) u.searchParams.set("organization", org);
	u.searchParams.set("format", "json");
	const t0 = performance.now();
	const r = await fetch(u);
	const ms = (performance.now() - t0).toFixed(0);
	const j = await r.json().catch(() => ({}));
	return {
		label,
		http: r.status,
		ms: `${ms}ms`,
		verseNotes: j.verseNotes?.length ?? null,
		contextNotes: j.contextNotes?.length ?? null,
		error:
			typeof j.error === "string"
				? j.error
				: j.error?.message?.slice(0, 200) ?? null,
		preview: j.verseNotes?.[0]?.Note?.slice(0, 100)?.replace(/\n/g, " ") ?? null,
	};
}

console.log("TIT 3:15 — Spanish translation notes\n");
for (const [label, base, lang, org] of scenarios) {
	console.log(JSON.stringify(await one(label, base, lang, org), null, 2));
}
