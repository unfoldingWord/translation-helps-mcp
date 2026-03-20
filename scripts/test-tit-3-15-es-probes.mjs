const ref = "TIT 3:15";
const base = "http://127.0.0.1:8174";

async function hit(qs) {
	const u = `${base}/api/fetch-translation-notes?${qs}`;
	const r = await fetch(u);
	const j = await r.json().catch(() => ({}));
	return {
		qs,
		http: r.status,
		err: typeof j.error === "string" ? j.error : j.error?.message,
		verse: j.verseNotes?.length,
		ctx: j.contextNotes?.length,
	};
}

const cases = [
	`reference=${encodeURIComponent(ref)}&language=es`,
	`reference=${encodeURIComponent(ref)}&language=es-419`,
	`reference=${encodeURIComponent(ref)}&language=es&organization=`,
	`reference=${encodeURIComponent(ref)}&language=es_lat`,
	`reference=${encodeURIComponent(ref)}&language=es-ES`,
];

console.log("LOCAL probes\n");
for (const qs of cases) {
	console.log(JSON.stringify(await hit(qs)));
}
