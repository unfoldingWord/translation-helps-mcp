<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight } from 'lucide-svelte';
	import ResultViewer from '$lib/components/ResultViewer.svelte';
	import { endpoint } from '$lib/endpoint';
	import { run, type RunResult } from '$lib/mcp/session';
	import { revealOnNarrow } from '$lib/reveal';
	import type { TryState } from './hashState';
	import { latestOnly, type Call } from './guided';
	import { OBS_STEPS, OBS_STORIES, obsCall, type ObsStepId } from './obs';

	let { initial, onstate }: { initial: TryState; onstate: (s: TryState) => void } = $props();

	// Read once: the walk keeps its own state and reports it through onstate.
	const init = untrack(() => initial);
	let lang = $state(init.lang || 'en');
	let story = $state(
		Number.isInteger(init.story) ? Math.min(OBS_STORIES, Math.max(1, init.story!)) : 1
	);
	const startFrame = Number.isInteger(init.frame) && init.frame! >= 1 ? init.frame : undefined;
	let frame = $state<number | undefined>(startFrame);
	let typedFrame = $state(startFrame ? String(startFrame) : '');
	let frameError = $state('');
	let step = $state<ObsStepId>('story');
	let languages = $state<{ code: string; label: string }[]>([]);
	let pending = $state(false);
	let answer = $state<RunResult | null>(null);
	/** The call whose answer is on screen (or on its way), so Try again repeats it. */
	let asked = $state<Call | null>(null);
	/** The title of the story, once the story step has answered for it. */
	let storyTitle = $state('');

	const at = $derived(OBS_STEPS.findIndex((s) => s.id === step));
	const title = $derived(OBS_STEPS[at].title);
	const call = $derived(obsCall(step, lang, story, frame));
	const following = $derived(OBS_STEPS[at + 1]);
	const where = $derived(frame ? `Story ${story}, frame ${frame}` : `Story ${story}`);

	// A call can finish after the tab changes; a closed walk must not write state.
	let alive = true;
	onDestroy(() => (alive = false));
	// Answers can arrive out of order; only the latest call may show.
	const seq = latestOnly();
	const keyOf = (c: Call) => JSON.stringify([c.tool, c.args]);

	function report() {
		onstate({ tab: 'obs', lang, story, ...(frame ? { frame } : {}) });
	}

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
		if (c.tool === 'get_obs_story' && next.outcome.kind === 'ok') {
			const t = next.result?.structured?.title;
			// The server numbers its titles ("1. The Creation"); the line already says the story number.
			storyTitle = typeof t === 'string' ? t.trim().replace(/^\d+\.\s*/, '') : '';
		}
	}

	/** Show the current step: report the state and call its tool. */
	function show() {
		report();
		void exec(call);
	}

	let resultEl = $state<HTMLElement>();

	/** A choice made by the person: show it and, on a phone, scroll to it. */
	async function choose() {
		show();
		await tick();
		revealOnNarrow(resultEl);
	}

	function goTo(id: ObsStepId) {
		step = id;
		void choose();
	}

	function go(delta: 1 | -1) {
		const to = OBS_STEPS[Math.min(OBS_STEPS.length - 1, Math.max(0, at + delta))];
		goTo(to.id);
	}

	function setStory(n: number) {
		if (n === story) return;
		story = n;
		storyTitle = '';
		step = 'story';
		void choose();
	}

	function setFrame(value: string) {
		const v = value.trim();
		if (v === '') {
			frameError = '';
			if (frame === undefined) return;
			frame = undefined;
		} else {
			const n = Number(v);
			if (!/^\d+$/.test(v) || n < 1) {
				frameError = 'Type a frame number, like 5, or leave it empty for the whole story.';
				return;
			}
			frameError = '';
			if (n === frame) return;
			frame = n;
		}
		void choose();
	}

	function setLang(code: string) {
		lang = code;
		storyTitle = '';
		void choose();
	}

	function openInTools() {
		onstate({ tab: 'tools', tool: call.tool, args: { ...call.args } });
	}

	onMount(async () => {
		// The walk opens on the story, so the first thing seen is the text itself.
		show();
		const { result } = await run(endpoint(), 'list_languages', { limit: 9999 });
		if (!alive) return;
		const found = Array.isArray(result?.structured?.languages)
			? (result.structured.languages as { code?: unknown; name?: unknown; englishName?: unknown }[])
			: [];
		const list = found
			.filter((l) => typeof l.code === 'string' && l.code)
			.map((l) => {
				const name =
					(typeof l.englishName === 'string' && l.englishName) ||
					(typeof l.name === 'string' && l.name) ||
					(l.code as string);
				return { code: l.code as string, label: `${name} (${l.code})` };
			});
		if (!list.some((l) => l.code === 'en')) list.unshift({ code: 'en', label: 'English (en)' });
		if (!list.some((l) => l.code === lang)) list.unshift({ code: lang, label: lang });
		languages = list;
	});

	const control =
		'w-full rounded-md border border-line-strong bg-bg px-2.5 py-1.5 text-sm text-ink';
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
	<aside class="min-w-0 space-y-4">
		<div>
			<label for="o-lang" class="text-ink-2 text-xs">Language</label>
			<select
				id="o-lang"
				class={control}
				value={lang}
				onchange={(e) => setLang(e.currentTarget.value)}
			>
				{#if !languages.length}<option value={lang}>{lang}</option>{/if}
				{#each languages as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
			</select>
		</div>
		<div>
			<label for="o-story" class="text-ink-2 text-xs">Story</label>
			<select
				id="o-story"
				class={control}
				value={story}
				onchange={(e) => setStory(Number(e.currentTarget.value))}
			>
				{#each Array.from({ length: OBS_STORIES }, (_, i) => i + 1) as n (n)}
					<option value={n}>Story {n}</option>
				{/each}
			</select>
		</div>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				setFrame(typedFrame);
			}}
		>
			<label for="o-frame" class="text-ink-2 text-xs">Frame (optional)</label>
			<div class="flex gap-2">
				<input
					id="o-frame"
					class={control}
					type="text"
					inputmode="numeric"
					bind:value={typedFrame}
					placeholder="Whole story"
					autocomplete="off"
					aria-invalid={frameError ? 'true' : undefined}
					aria-describedby={frameError ? 'o-frame-error' : undefined}
				/>
				<button
					type="submit"
					class="border-line-strong text-ink hover:bg-surface shrink-0 rounded-md border px-3 py-1.5 text-sm"
					>Show</button
				>
			</div>
			{#if frameError}<p id="o-frame-error" class="text-danger mt-1 text-xs">{frameError}</p>{/if}
		</form>
		<div class="lg:hidden">
			<label for="o-step" class="text-ink-2 text-xs">Step</label>
			<select
				id="o-step"
				class={control}
				value={step}
				onchange={(e) => goTo(e.currentTarget.value as ObsStepId)}
			>
				{#each OBS_STEPS as s, i (s.id)}
					<option value={s.id}>{i + 1}. {s.title}</option>
				{/each}
			</select>
		</div>
		<ol class="border-line hidden space-y-0.5 border-t pt-4 lg:block" aria-label="Steps">
			{#each OBS_STEPS as s, i (s.id)}
				<li>
					<button
						type="button"
						onclick={() => goTo(s.id)}
						aria-current={s.id === step ? 'step' : undefined}
						class="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-sm {s.id ===
						step
							? 'bg-surface text-ink'
							: 'text-ink-2 hover:text-ink'}"
					>
						<span>{i + 1}. {s.title}</span>
						<span class="truncate font-mono text-[11px]">{s.tool}</span>
					</button>
				</li>
			{/each}
		</ol>
	</aside>

	<div class="min-w-0 scroll-mt-20 space-y-4" bind:this={resultEl} data-result>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="min-w-0">
				<h2 class="text-ink font-semibold">{title}</h2>
				<p class="text-ink-2 text-sm">
					{where}{#if storyTitle}<span class="text-ink"> · {storyTitle}</span>{/if}
				</p>
			</div>
			<div class="flex gap-2">
				<button
					type="button"
					class="border-line-strong text-ink inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm disabled:opacity-40"
					onclick={() => go(-1)}
					disabled={at === 0}><ArrowLeft size={14} /> Back</button
				>
				<button
					type="button"
					class="bg-accent text-on-accent inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm disabled:opacity-40"
					onclick={() => go(1)}
					disabled={!following}>Next <ArrowRight size={14} /></button
				>
			</div>
		</div>

		<div class="flex flex-wrap items-center justify-between gap-2">
			<code class="text-ink-2 min-w-0 font-mono text-xs break-all"
				>{call.tool} {JSON.stringify(call.args)}</code
			>
			<button
				type="button"
				class="border-line-strong text-ink-2 hover:text-ink shrink-0 rounded-md border px-2.5 py-1 text-xs"
				onclick={openInTools}>Open in Tools</button
			>
		</div>

		<ResultViewer
			tool={asked?.tool ?? call.tool}
			result={answer?.result ?? null}
			outcome={answer?.outcome ?? null}
			{pending}
			onretry={() => asked && exec(asked, true)}
		/>

		{#if following}
			<button
				type="button"
				class="bg-accent text-on-accent inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold sm:w-auto"
				onclick={() => go(1)}>Next: {following.title} <ArrowRight size={14} /></button
			>
		{/if}
	</div>
</div>
