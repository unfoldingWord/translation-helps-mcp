/** The steps of the guided path on the Try page. */
export type GuidedStepId = 'pick' | 'text' | 'context' | 'map' | 'deeper' | 'check';

export type TryState = {
	tab: 'guided' | 'obs' | 'tools';
	tool?: string;
	args?: Record<string, unknown>;
	lang?: string;
	ref?: string;
	step?: GuidedStepId;
	open?: { kind: 'note' | 'academy' | 'word'; key: string };
	story?: number;
};

const FALLBACK: TryState = { tab: 'guided' };

const TABS = ['guided', 'obs', 'tools'];
const STEPS: readonly string[] = ['pick', 'text', 'context', 'map', 'deeper', 'check'];
const OPEN_KINDS = ['note', 'academy', 'word'];

function toBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeTryState(s: TryState): string {
	return '#' + toBase64Url(JSON.stringify(s));
}

/** Read the Try page state from a URL hash. Never throws; odd input gives the guided tab. */
export function decodeTryState(hash: string, knownTools: string[]): TryState {
	let raw: unknown;
	try {
		raw = JSON.parse(fromBase64Url(hash.replace(/^#/, '')));
	} catch {
		return { ...FALLBACK };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...FALLBACK };
	const r = raw as Record<string, unknown>;
	if (typeof r.tab !== 'string' || !TABS.includes(r.tab)) return { ...FALLBACK };

	const out: TryState = { tab: r.tab as TryState['tab'] };
	const isPlainObject = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	for (const [key, value] of Object.entries(r)) {
		switch (key) {
			case 'tab':
				break;
			case 'tool':
				if (typeof value === 'string' && knownTools.includes(value)) out.tool = value;
				break;
			case 'args':
				if (!isPlainObject(value)) return { ...FALLBACK };
				out.args = value;
				break;
			case 'lang':
			case 'ref':
				if (typeof value !== 'string') return { ...FALLBACK };
				out[key] = value;
				break;
			case 'step':
				if (typeof value !== 'string' || !STEPS.includes(value)) return { ...FALLBACK };
				out.step = value as GuidedStepId;
				break;
			case 'open':
				if (
					!isPlainObject(value) ||
					typeof value.kind !== 'string' ||
					!OPEN_KINDS.includes(value.kind) ||
					typeof value.key !== 'string'
				) {
					return { ...FALLBACK };
				}
				out.open = { kind: value.kind as 'note' | 'academy' | 'word', key: value.key };
				break;
			case 'story':
				if (typeof value !== 'number' || !Number.isInteger(value)) return { ...FALLBACK };
				out.story = value;
				break;
			default:
				return { ...FALLBACK };
		}
	}
	return out;
}
