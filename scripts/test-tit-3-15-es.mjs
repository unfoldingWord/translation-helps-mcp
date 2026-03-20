#!/usr/bin/env node
const bases = [
	["LOCAL", "http://127.0.0.1:8174"],
	["REMOTE", "https://tc-helps.mcp.servant.bible"],
];
const langs = ["es", "es-419"];
const ref = "TIT 3:15";
const org = "unfoldingWord";

async function tryOne(base, lang) {
	const u = new URL(`${base}/api/fetch-translation-notes`);
	u.searchParams.set("reference", ref);
	u.searchParams.set("language", lang);
	u.searchParams.set("organization", org);
	u.searchParams.set("format", "json");
	const t0 = performance.now();
	const r = await fetch(u);
	const ms = (performance.now() - t0).toFixed(0);
	const text = await r.text();
	let j;
	try {
		j = JSON.parse(text);
	} catch {
		j = { parseError: text.slice(0, 300) };
	}
	const verseCount =
		j.verseNotes?.length ??
		j.counts?.verseNotesCount ??
		(j.error ? null : 0);
	const ctxCount =
		j.contextNotes?.length ?? j.counts?.contextNotesCount ?? null;
	return {
		lang,
		http: r.status,
		ms: `${ms}ms`,
		verseNotes: verseCount,
		contextNotes: ctxCount,
		error: j.error ?? j.parseError ?? null,
		firstNotePreview:
			j.verseNotes?.[0]?.Note?.slice(0, 160)?.replace(/\s+/g, " ") ??
			null,
	};
}

for (const [label, base] of bases) {
	console.log(`\n======== ${label} ${base} ========`);
	for (const lang of langs) {
		const row = await tryOne(base, lang);
		console.log(JSON.stringify(row, null, 2));
	}
}
