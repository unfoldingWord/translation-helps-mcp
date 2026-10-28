<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { ArrowLeft, ArrowRight } from 'lucide-svelte';
	import ResultViewer from '$lib/components/ResultViewer.svelte';
	import AlignedQuote from '$lib/components/AlignedQuote.svelte';
	import { endpoint } from '$lib/endpoint';
	import type { GuidedStepId, TryState } from './hashState';
	import {
		EXAMPLES,
		GUIDED_STEPS,
		deeperCall,
		mapRows,
		nextStep,
		stepCall,
		toolsState,
		type Call,
		type MapRow
	} from './guided';
	import { languageOptions, loadLanguages } from './languages';
	import { createWalkRunner, revealResult } from './walkRunner.svelte';

	let { initial, onstate }: { initial: TryState; onstate: (s: TryState) => void } = $props();

	// Read once: the walk keeps its own state and reports it through onstate.
	const init = untrack(() => initial);
	let lang = $state(init.lang || 'en');
	const startRef = init.ref?.trim() || 'John 3:16';
	let ref = $state(startRef);
	let typed = $state(startRef);
	let refError = $state('');
	let step = $state<GuidedStepId>(init.step ?? 'pick');
	let open = $state<TryState['open']>(init.open);
	let languages = $state<{ code: string; label: string }[]>([]);
	/** The rows of the last map answer. Null until the map has been read for this passage. */
	let rows = $state<MapRow[] | null>(null);

	const KINDS: [MapRow['kind'], string][] = [
		['note', 'Notes'],
		['academy', 'Translation Academy topics'],
		['word', 'Key terms']
	];
	const KIND_NAME: Record<MapRow['kind'], string> = {
		note: 'Note',
		academy: 'Academy topic',
		word: 'Key term'
	};

	const canGoDeeper = $derived(rows === null || rows.length > 0);
	const title = $derived(GUIDED_STEPS.find((s) => s.id === step)?.title ?? step);
	const call = $derived(
		step === 'deeper' ? (open ? deeperCall(open, lang, ref) : null) : stepCall(step, lang, ref)
	);
	const isLast = $derived(step === 'check');
	const following = $derived(isLast ? null : nextStep(step, 1, canGoDeeper));
	const openRow = $derived(
		open ? rows?.find((r) => r.kind === open!.kind && r.key === open!.key) : undefined
	);

	// Runs the step's call and keeps only the latest answer. The map answer also fills `rows`.
	const runner = createWalkRunner((c, next) => {
		if (c.tool === 'get_passage_index') {
			const kind = next.outcome.kind;
			// Not available means there is nothing to open; a failure leaves it unknown.
			rows =
				kind === 'ok' ? mapRows(next.result?.structured) : kind === 'not-available' ? [] : null;
		}
	});
	onDestroy(() => runner.dispose());

	function report() {
		onstate({ tab: 'guided', lang, ref, step, ...(open ? { open } : {}) });
	}

	/** Show the current step: call its tool, or clear the answer when it has none. */
	function show() {
		report();
		if (call) {
			void runner.exec(call);
			return;
		}
		runner.clear();
	}

	let resultEl = $state<HTMLElement>();

	/** A choice made by the person: show it and, on a phone, scroll to it. */
	async function choose() {
		show();
		await revealResult(resultEl);
	}

	function goTo(id: GuidedStepId) {
		step = id;
		// Next from the map opens its first row, so Go deeper always has something to show.
		if (id === 'deeper' && !open && rows?.length) open = { kind: rows[0].kind, key: rows[0].key };
		void choose();
	}

	function go(delta: 1 | -1) {
		goTo(nextStep(step, delta, canGoDeeper));
	}

	function openItem(row: MapRow) {
		open = { kind: row.kind, key: row.key };
		goTo('deeper');
	}

	/** A new language or passage: what was read for the old one no longer applies. */
	function forget() {
		rows = null;
		open = undefined;
		if (step === 'deeper') step = 'map';
	}

	function setPassage(value: string) {
		const v = value.trim();
		if (v.length < 3) {
			refError = 'Type a passage, like John 3:16.';
			return;
		}
		refError = '';
		typed = v;
		if (v !== ref) {
			ref = v;
			forget();
		}
		if (step === 'pick') step = 'text';
		void choose();
	}

	function setLang(code: string) {
		lang = code;
		forget();
		void choose();
	}

	function openInTools() {
		if (call) onstate(toolsState(call));
	}

	onMount(async () => {
		// A shared link on a later step opens that step right away.
		if (step !== 'pick') show();
		const loaded = await loadLanguages(endpoint());
		if (!runner.alive) return;
		languages = languageOptions(loaded, lang);
	});

	const control =
		'w-full rounded-md border border-line-strong bg-bg px-2.5 py-1.5 text-sm text-ink';
	const chip =
		'rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-2 hover:text-ink';
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
	<aside class="min-w-0 space-y-4">
		<div>
			<label for="g-lang" class="text-ink-2 text-xs">Language</label>
			<select
				id="g-lang"
				class={control}
				value={lang}
				onchange={(e) => setLang(e.currentTarget.value)}
			>
				{#if !languages.length}<option value={lang}>{lang}</option>{/if}
				{#each languages as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
			</select>
		</div>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				setPassage(typed);
			}}
		>
			<label for="g-ref" class="text-ink-2 text-xs">Passage</label>
			<div class="flex gap-2">
				<input
					id="g-ref"
					class={control}
					bind:value={typed}
					placeholder="John 3:16"
					autocomplete="off"
					aria-invalid={refError ? 'true' : undefined}
					aria-describedby={refError ? 'g-ref-error' : undefined}
				/>
				<button
					type="submit"
					class="border-line-strong text-ink hover:bg-surface shrink-0 rounded-md border px-3 py-1.5 text-sm"
					>Show</button
				>
			</div>
			{#if refError}<p id="g-ref-error" class="text-danger mt-1 text-xs">{refError}</p>{/if}
		</form>
		<div>
			<p class="text-ink-2 mb-2 text-xs">Examples</p>
			<div class="flex flex-wrap gap-1.5">
				{#each EXAMPLES as ex (ex)}
					<button
						type="button"
						class={chip}
						aria-pressed={ex === ref}
						onclick={() => setPassage(ex)}>{ex}</button
					>
				{/each}
			</div>
		</div>
		<div class="lg:hidden">
			<label for="g-step" class="text-ink-2 text-xs">Step</label>
			<select
				id="g-step"
				class={control}
				value={step}
				onchange={(e) => goTo(e.currentTarget.value as GuidedStepId)}
			>
				{#each GUIDED_STEPS as s, i (s.id)}
					<option value={s.id} disabled={s.id === 'deeper' && !canGoDeeper}
						>{i + 1}. {s.title}</option
					>
				{/each}
			</select>
		</div>
		<ol class="border-line hidden space-y-0.5 border-t pt-4 lg:block" aria-label="Steps">
			{#each GUIDED_STEPS as s, i (s.id)}
				<li>
					<button
						type="button"
						onclick={() => goTo(s.id)}
						disabled={s.id === 'deeper' && !canGoDeeper}
						aria-current={s.id === step ? 'step' : undefined}
						class="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-sm disabled:opacity-40 {s.id ===
						step
							? 'bg-surface text-ink'
							: 'text-ink-2 hover:text-ink'}"
					>
						<span>{i + 1}. {s.title}</span>
						{#if s.tool}<span class="truncate font-mono text-[11px]">{s.tool}</span>{/if}
					</button>
				</li>
			{/each}
		</ol>
	</aside>

	<div class="min-w-0 scroll-mt-20 space-y-4" bind:this={resultEl} data-result>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-ink font-semibold">{title}</h2>
			<div class="flex gap-2">
				<button
					type="button"
					class="border-line-strong text-ink inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm disabled:opacity-40"
					onclick={() => go(-1)}
					disabled={step === 'pick'}><ArrowLeft size={14} /> Back</button
				>
				<button
					type="button"
					class="bg-accent text-on-accent inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm disabled:opacity-40"
					onclick={() => go(1)}
					disabled={isLast}>Next <ArrowRight size={14} /></button
				>
			</div>
		</div>

		{#if step === 'pick'}
			<div class="text-ink-2 space-y-3 text-sm">
				<p>
					Choose a language and a passage. The walk then asks the server for each help, in the order
					an assistant does:
				</p>
				<ol class="list-decimal space-y-1 pl-5">
					{#each GUIDED_STEPS.slice(1) as s (s.id)}
						<li>
							<span class="text-ink">{s.title}</span>
							<span class="font-mono text-xs"
								>{s.tool ?? 'get_note · get_academy_article · get_word_article'}</span
							>
						</li>
					{/each}
				</ol>
				<p>
					Now showing: <span class="text-ink">{ref}</span> in <span class="text-ink">{lang}</span>.
				</p>
			</div>
		{:else}
			{#if step === 'deeper'}
				{#if open}
					<p class="text-ink-2 text-sm">
						{KIND_NAME[open.kind]}:
						<span class="text-ink">{openRow?.label ?? open.key}</span>
						{#if openRow?.quote}
							<span class="mt-1 block"
								><AlignedQuote
									original={openRow.quote.original}
									aligned={openRow.quote.aligned}
								/></span
							>
						{/if}
					</p>
				{:else}
					<p class="text-ink-2 text-sm">
						Open a note, an Academy topic or a key term from the map.
						<button type="button" class="underline" onclick={() => goTo('map')}
							>Go to the map</button
						>
					</p>
				{/if}
			{/if}

			{#if call}
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
			{/if}

			{#if step === 'map' && !runner.pending && runner.answer && rows}
				{#if rows.length}
					<div class="space-y-4">
						{#each KINDS as [kind, heading] (kind)}
							{@const group = rows.filter((r) => r.kind === kind)}
							{#if group.length}
								<div>
									<p class="text-ink-2 mb-2 text-xs">{heading} ({group.length})</p>
									<ul class="flex flex-wrap gap-1.5">
										{#each group as row (row.key)}
											<li class="max-w-full">
												<button
													type="button"
													class="border-line-strong hover:bg-surface max-w-full rounded-md border px-2.5 py-1.5 text-left text-sm"
													onclick={() => openItem(row)}
												>
													<span class="text-ink block">{row.label}</span>
													{#if row.quote}
														<span class="block text-xs"
															><AlignedQuote
																original={row.quote.original}
																aligned={row.quote.aligned}
															/></span
														>
													{/if}
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						{/each}
					</div>
				{:else if runner.answer.outcome.kind === 'ok'}
					<p class="text-ink-2 text-sm">No notes or key terms for this passage.</p>
				{/if}
			{/if}

			{#if call}
				<ResultViewer
					tool={runner.asked?.tool ?? call.tool}
					result={runner.answer?.result ?? null}
					outcome={runner.answer?.outcome ?? null}
					pending={runner.pending}
					onretry={() => runner.retry()}
				/>
			{/if}
		{/if}

		{#if following}
			<button
				type="button"
				class="bg-accent text-on-accent inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold sm:w-auto"
				onclick={() => go(1)}
				>Next: {GUIDED_STEPS.find((s) => s.id === following)?.title}
				<ArrowRight size={14} /></button
			>
		{/if}
	</div>
</div>
