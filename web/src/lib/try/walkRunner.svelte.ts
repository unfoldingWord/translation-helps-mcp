import { tick } from 'svelte';
import { endpoint } from '$lib/endpoint';
import { run, type RunResult } from '$lib/mcp/session';
import { revealOnNarrow } from '$lib/reveal';
import { latestOnly, type Call } from './guided';

const keyOf = (c: Call) => JSON.stringify([c.tool, c.args]);

/**
 * The call a walk is showing. It keeps the answer of the latest call only (one that comes
 * back after a newer call started is dropped), does not call the server twice for the same
 * call, and writes nothing after `dispose()`.
 *
 * `onanswer` runs for each answer that is shown, with the call that made it.
 */
export function createWalkRunner(onanswer?: (call: Call, answer: RunResult) => void) {
	let asked = $state<Call | null>(null);
	let answer = $state<RunResult | null>(null);
	let pending = $state(false);
	// A call can finish after the tab changes; a closed walk must not write state.
	let alive = true;
	const seq = latestOnly();

	async function exec(c: Call, force = false) {
		// The same call again (a double click, a step pressed twice) does not call the server again,
		// unless the last try failed (rate limit, network): then pressing the step again retries.
		const settled = answer && ['ok', 'not-available'].includes(answer.outcome.kind);
		if (!force && asked && keyOf(asked) === keyOf(c) && (pending || settled)) return;
		const mine = seq.next();
		asked = c;
		answer = null;
		pending = true;
		const next = await run(endpoint(), c.tool, c.args);
		if (!alive || !seq.isLatest(mine)) return;
		answer = next;
		pending = false;
		onanswer?.(c, next);
	}

	return {
		get asked() {
			return asked;
		},
		get answer() {
			return answer;
		},
		get pending() {
			return pending;
		},
		exec,
		/** False once `dispose()` ran: other work of the walk (a language list) checks it too. */
		get alive() {
			return alive;
		},
		/** Ask the last call again, even if it failed. */
		retry() {
			if (asked) return exec(asked, true);
		},
		/** Show no answer (a step that has no call). A call still on its way is dropped. */
		clear() {
			seq.next();
			asked = null;
			answer = null;
			pending = false;
		},
		dispose() {
			alive = false;
		}
	};
}

/** After a choice, once the page has updated: on a phone, scroll the result into view. */
export async function revealResult(el: Element | null | undefined) {
	await tick();
	revealOnNarrow(el);
}
