/**
 * Shared types and utility functions for trace event rendering.
 * Used by both /debug page and the chat X-ray panel.
 */
import type { TraceEvent } from '$lib/server/traceEvents.js';

export type AnyEvent =
	| { kind: 'trace'; ev: TraceEvent }
	| { kind: 'status'; text: string }
	| { kind: 'thinking'; label: string; state: string }
	| { kind: 'ui'; data: unknown }
	| { kind: 'done'; data: unknown }
	| { kind: 'error'; data: unknown }
	| { kind: 'meta'; data: unknown };

export type TimedEvent = { t: number; ev: AnyEvent };

// ─── Filter categories ────────────────────────────────────────────────────────

export type FilterKind = 'all' | 'routing' | 'tools' | 'llm' | 'status' | 'ui';

export function matchesFilter(te: TimedEvent, filter: FilterKind): boolean {
	if (filter === 'all') return true;
	const ev = te.ev;
	if (filter === 'routing') {
		if (ev.kind !== 'trace') return false;
		return ['intent', 'route', 'plan', 'budget', 'warm', 'done_trace'].includes(ev.ev.type);
	}
	if (filter === 'tools') {
		if (ev.kind !== 'trace') return false;
		return ev.ev.type === 'tool_call';
	}
	if (filter === 'llm') {
		if (ev.kind !== 'trace') return false;
		return ev.ev.type === 'llm_call';
	}
	if (filter === 'status') {
		return (
			ev.kind === 'status' ||
			ev.kind === 'thinking' ||
			ev.kind === 'done' ||
			ev.kind === 'error' ||
			ev.kind === 'meta'
		);
	}
	if (filter === 'ui') {
		return ev.kind === 'ui';
	}
	return true;
}

// ─── Route colours ────────────────────────────────────────────────────────────

export const ROUTE_COLORS: Record<string, string> = {
	A: 'bg-violet-950/50 border-violet-600/70 text-violet-100',
	D: 'bg-orange-950/50 border-orange-600/70 text-orange-100',
	G: 'bg-cyan-950/50 border-cyan-600/70 text-cyan-100',
	'G+': 'bg-teal-950/50 border-teal-600/70 text-teal-100',
	F: 'bg-sky-950/50 border-sky-600/70 text-sky-100',
	B: 'bg-sky-950/50 border-sky-600/70 text-sky-100',
	L: 'bg-pink-950/50 border-pink-600/70 text-pink-100'
};

export const ROUTE_BADGE: Record<string, string> = {
	A: 'bg-violet-700 text-white',
	D: 'bg-orange-700 text-white',
	G: 'bg-cyan-700 text-white',
	'G+': 'bg-teal-700 text-white',
	F: 'bg-sky-700 text-white',
	B: 'bg-sky-700 text-white',
	L: 'bg-pink-700 text-white'
};

// ─── Utility functions ────────────────────────────────────────────────────────

export function rowClass(ev: AnyEvent): string {
	if (ev.kind !== 'trace') {
		if (ev.kind === 'status') return 'bg-slate-900/80 border-slate-700';
		if (ev.kind === 'done') return 'bg-emerald-950/50 border-emerald-700/70';
		if (ev.kind === 'error') return 'bg-red-950/50 border-red-700/70';
		if (ev.kind === 'thinking') return 'bg-slate-900/60 border-slate-700';
		if (ev.kind === 'ui') return 'bg-teal-950/40 border-teal-700/70';
		return 'bg-slate-900/60 border-slate-700';
	}
	const t = ev.ev.type;
	if (t === 'intent') return 'bg-violet-950/40 border-violet-700/70';
	if (t === 'route') {
		const path = (ev.ev as TraceEvent & { type: 'route' }).path;
		return ROUTE_COLORS[path] ?? 'bg-slate-900 border-slate-700';
	}
	if (t === 'llm_call') return 'bg-amber-950/40 border-amber-700/70';
	if (t === 'tool_call') {
		const ok = (ev.ev as TraceEvent & { type: 'tool_call' }).ok;
		return ok ? 'bg-emerald-950/40 border-emerald-700/70' : 'bg-red-950/40 border-red-700/70';
	}
	if (t === 'plan') return 'bg-sky-950/40 border-sky-700/70';
	if (t === 'budget') return 'bg-orange-950/40 border-orange-700/70';
	if (t === 'warm') return 'bg-slate-900 border-slate-700';
	return 'bg-slate-900/60 border-slate-700';
}

export function rowLabel(te: TimedEvent): string {
	const ev = te.ev;
	if (ev.kind === 'status') return `⬤ ${ev.text}`;
	if (ev.kind === 'thinking') return `⟳ ${ev.label} [${ev.state}]`;
	if (ev.kind === 'ui') return `🖼 UI component`;
	if (ev.kind === 'done') return `✔ Done (${te.t}ms)`;
	if (ev.kind === 'error') return `✖ Error`;
	if (ev.kind === 'meta') return `⚙ Meta`;
	// At this point ev.kind === 'trace' (all other members handled above)
	const t = ev.ev.type;
	if (t === 'intent') {
		const r = ev.ev as TraceEvent & { type: 'intent' };
		return `🎯 Intent: ${r.result.intent} (${r.result.confidence}) ${r.ms}ms`;
	}
	if (t === 'route') {
		const r = ev.ev as TraceEvent & { type: 'route' };
		return `→ Route ${r.path}: ${r.reason}`;
	}
	if (t === 'llm_call') {
		const r = ev.ev as TraceEvent & { type: 'llm_call' };
		return `🤖 LLM: ${r.label}${r.streaming ? ' [stream]' : ''} — ${r.ms}ms`;
	}
	if (t === 'tool_call') {
		const r = ev.ev as TraceEvent & { type: 'tool_call' };
		const icon = r.ok ? '🔧' : '❌';
		return `${icon} ${r.name} (${r.ms}ms)${r.summary ? ' — ' + r.summary : ''}`;
	}
	if (t === 'plan') {
		const r = ev.ev as TraceEvent & { type: 'plan' };
		return `📋 Plan: ${r.intent} → ${r.initialFetches.length} fetches, ${r.rcExpansion.length} expansions`;
	}
	if (t === 'budget') {
		const r = ev.ev as TraceEvent & { type: 'budget' };
		return `💰 Budget: ${r.before}→${r.after} (${r.dropped} dropped)`;
	}
	if (t === 'warm') {
		const r = ev.ev as TraceEvent & { type: 'warm' };
		return `🔥 Warm: ${r.reference} [${r.language}]`;
	}
	if (t === 'done_trace') {
		const r = ev.ev as TraceEvent & { type: 'done_trace' };
		return `⏱ Total: ${r.totalMs}ms`;
	}
	return `? ${t}`;
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

export function getIntentEv(events: TimedEvent[]) {
	return events
		.map((e) => e.ev)
		.find(
			(e): e is { kind: 'trace'; ev: TraceEvent & { type: 'intent' } } =>
				e.kind === 'trace' && (e as { kind: 'trace'; ev: TraceEvent }).ev.type === 'intent'
		) as { kind: 'trace'; ev: TraceEvent & { type: 'intent' } } | undefined;
}

export function getRouteEv(events: TimedEvent[]) {
	return events
		.map((e) => e.ev)
		.find(
			(e): e is { kind: 'trace'; ev: TraceEvent & { type: 'route' } } =>
				e.kind === 'trace' && (e as { kind: 'trace'; ev: TraceEvent }).ev.type === 'route'
		) as { kind: 'trace'; ev: TraceEvent & { type: 'route' } } | undefined;
}

export function countByKind(events: TimedEvent[], kind: string): number {
	return events.filter((e) => {
		if (e.ev.kind === 'trace') return e.ev.ev.type === kind;
		return e.ev.kind === kind;
	}).length;
}

// ─── Text report export ──────────────────────────────────────────────────────

export type XrayTurnReport = {
	userSnippet: string;
	events: TimedEvent[];
	live?: boolean;
	statusText?: string;
};

function indent(text: string, prefix = '  '): string {
	return text
		.split('\n')
		.map((line) => (line.length ? prefix + line : line))
		.join('\n');
}

function fmtJson(value: unknown, maxChars = 12_000): string {
	try {
		const raw = JSON.stringify(value, null, 2) ?? String(value);
		if (raw.length <= maxChars) return raw;
		return `${raw.slice(0, maxChars)}\n… [truncated ${raw.length - maxChars} chars]`;
	} catch {
		return String(value);
	}
}

function formatEventDetail(te: TimedEvent): string {
	const lines: string[] = [`[+${te.t}ms] ${rowLabel(te)}`];
	const ev = te.ev;

	if (ev.kind === 'trace') {
		const t = ev.ev;
		if (t.type === 'intent') {
			lines.push(indent(fmtJson(t.result)));
		} else if (t.type === 'route') {
			lines.push(indent(`path=${t.path}`));
			lines.push(indent(`reason=${t.reason}`));
		} else if (t.type === 'plan') {
			lines.push(indent(`intent=${t.intent}`));
			lines.push(indent(`fetches=${t.initialFetches.join(', ') || '(none)'}`));
			lines.push(indent(`rcExpansion=${t.rcExpansion.join(', ') || '(none)'}`));
		} else if (t.type === 'tool_call') {
			lines.push(indent(`ok=${t.ok}  ms=${t.ms}${t.summary ? `  summary=${t.summary}` : ''}`));
			lines.push(indent('params:'));
			lines.push(indent(fmtJson(t.params), '    '));
			if (t.error) {
				lines.push(indent(`ERROR: ${t.error}`));
			}
			if (t.resultSnapshot !== undefined) {
				lines.push(indent('resultSnapshot:'));
				lines.push(indent(fmtJson(t.resultSnapshot), '    '));
			}
		} else if (t.type === 'llm_call') {
			lines.push(
				indent(
					`model=${t.model}  ms=${t.ms}  streaming=${t.streaming}${t.tokens != null ? `  tokens=${t.tokens}` : ''}`
				)
			);
			if (t.error) lines.push(indent(`ERROR: ${t.error}`));
			for (const msg of t.messages ?? []) {
				lines.push(indent(`--- ${msg.role} ---`));
				lines.push(indent(String(msg.content ?? ''), '    '));
			}
			if (t.response) {
				lines.push(indent('--- response ---'));
				lines.push(indent(t.response, '    '));
			}
		} else if (t.type === 'budget') {
			lines.push(indent(`${t.before} → ${t.after} (dropped ${t.dropped})`));
		} else if (t.type === 'warm') {
			lines.push(indent(`${t.reference} [${t.language}]`));
		} else if (t.type === 'done_trace') {
			lines.push(indent(`totalMs=${t.totalMs}`));
		} else if (t.type === 'ui_emit') {
			lines.push(indent(`componentType=${t.componentType}`));
		}
	} else if (ev.kind === 'status') {
		lines.push(indent(ev.text));
	} else if (ev.kind === 'thinking') {
		lines.push(indent(`${ev.label} [${ev.state}]`));
	} else if (ev.kind === 'error' || ev.kind === 'done' || ev.kind === 'meta' || ev.kind === 'ui') {
		lines.push(indent(fmtJson(ev.data)));
	}

	return lines.join('\n');
}

/**
 * Build a plain-text X-ray report suitable for pasting into a debug chat.
 */
export function formatXrayReport(
	turns: XrayTurnReport[],
	opts?: { url?: string; generatedAt?: Date }
): string {
	const generatedAt = (opts?.generatedAt ?? new Date()).toISOString();
	const url = opts?.url ?? (typeof location !== 'undefined' ? location.href : '');
	const totalEvents = turns.reduce((s, t) => s + t.events.length, 0);
	const totalTools = turns.reduce((s, t) => s + countByKind(t.events, 'tool_call'), 0);
	const totalLlm = turns.reduce((s, t) => s + countByKind(t.events, 'llm_call'), 0);
	const failedTools = turns.flatMap((t) =>
		t.events.filter(
			(e) =>
				e.ev.kind === 'trace' && e.ev.ev.type === 'tool_call' && !(e.ev.ev as { ok?: boolean }).ok
		)
	);

	const out: string[] = [
		'Translation Helps — X-ray debug report',
		'=====================================',
		`generatedAt: ${generatedAt}`,
		url ? `url: ${url}` : '',
		`turns: ${turns.length}`,
		`events: ${totalEvents}`,
		`tools: ${totalTools}  (failed: ${failedTools.length})`,
		`llmCalls: ${totalLlm}`,
		''
	].filter((line, i) => line !== '' || i < 3);

	if (failedTools.length > 0) {
		out.push('FAILED TOOLS');
		out.push('------------');
		for (const te of failedTools) {
			const t = te.ev as { kind: 'trace'; ev: TraceEvent & { type: 'tool_call' } };
			out.push(`- ${t.ev.name} (+${te.t}ms): ${t.ev.error ?? 'unknown error'}`);
			out.push(indent(`params: ${JSON.stringify(t.ev.params)}`));
		}
		out.push('');
	}

	// CACHE summary — extract [kv]/[r2]/[memory]/[network] tags from tool summaries
	const cacheHits: Array<{ turn: number; tool: string; cache: string; ms: number }> = [];
	turns.forEach((turn, i) => {
		for (const te of turn.events) {
			if (te.ev.kind !== 'trace' || te.ev.ev.type !== 'tool_call') continue;
			const t = te.ev.ev;
			const m = t.summary?.match(/\[(kv|r2|memory|network|mixed)\]/i);
			if (m) {
				cacheHits.push({
					turn: i + 1,
					tool: t.name,
					cache: m[1].toLowerCase(),
					ms: t.ms
				});
			}
		}
	});
	if (cacheHits.length > 0) {
		out.push('CACHE');
		out.push('-----');
		for (const h of cacheHits) {
			out.push(`- turn ${h.turn}: ${h.tool} → ${h.cache} (${h.ms}ms)`);
		}
		const networks = cacheHits.filter((h) => h.cache === 'network').length;
		const hits = cacheHits.length - networks;
		out.push(
			`summary: ${hits} hit(s), ${networks} network miss(es) of ${cacheHits.length} reported`
		);
		out.push('');
	}

	turns.forEach((turn, i) => {
		const intentEv = getIntentEv(turn.events);
		const routeEv = getRouteEv(turn.events);
		const doneEv = turn.events.find((e) => e.ev.kind === 'done');
		out.push(`TURN ${i + 1}${turn.live ? ' [live]' : ''}`);
		out.push('-'.repeat(40));
		out.push(`user: ${turn.userSnippet || '(empty)'}`);
		if (intentEv) {
			out.push(
				`intent: ${intentEv.ev.result.intent} (${intentEv.ev.result.confidence})${intentEv.ev.result.reference ? `  ref=${intentEv.ev.result.reference}` : ''}`
			);
		}
		if (routeEv) {
			out.push(`route: ${routeEv.ev.path} — ${routeEv.ev.reason}`);
		}
		if (doneEv) out.push(`latencyMs: ${doneEv.t}`);
		if (turn.statusText) out.push(`status: ${turn.statusText}`);
		out.push('');
		out.push('timeline:');
		if (turn.events.length === 0) {
			out.push(indent('(no events — x-ray was off for this turn)'));
		} else {
			for (const te of turn.events) {
				out.push(formatEventDetail(te));
				out.push('');
			}
		}
		out.push('');
	});

	out.push('RAW EVENTS JSON');
	out.push('---------------');
	out.push(
		fmtJson(
			turns.map((t, i) => ({
				turn: i + 1,
				userSnippet: t.userSnippet,
				live: t.live ?? false,
				statusText: t.statusText,
				events: t.events
			})),
			80_000
		)
	);
	out.push('');
	out.push('End of report.');
	return out.join('\n');
}

/** Download a UTF-8 text file in the browser. */
export function downloadTextFile(filename: string, content: string): void {
	const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
	const href = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = href;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(href);
}
