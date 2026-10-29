<script lang="ts">
	/**
	 * ChatDock — bottom bar with scope chip, resources, quick actions, input.
	 * Mobile: compact controls, horizontal chips, safe-area padding.
	 */

	import { createEventDispatcher, tick } from 'svelte';
	import Zap from 'lucide-svelte/icons/zap';
	import X from 'lucide-svelte/icons/x';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import MoreHorizontal from 'lucide-svelte/icons/more-horizontal';
	import { studySession, clearScope, type WorkflowMode } from '$lib/stores/studySession.js';
	import { workflowModeHint, WORKFLOW_MODES } from '$core/harness/workflowMode.js';
	import { isNeutralTarget } from '$core/harness/languagePair.js';
	import BookMarked from 'lucide-svelte/icons/book-marked';
	import PenLine from 'lucide-svelte/icons/pen-line';
	import ClipboardCheck from 'lucide-svelte/icons/clipboard-check';

	export let input = '';
	export let model = 'gpt-4o';
	/** Target / receptor language — optional; neutral "my language" when never set. */
	export let language = 'en';
	/** Source / conversation + Door43 resource language. */
	export let sourceLanguage = 'en';
	/** tc-ready languages from Door43 catalog (code + optional name). */
	export let languages: Array<{ code: string; name?: string }> = [];
	export let isLoading = false;
	export let hasMessages = false;
	export let xrayActive = false;
	export let xrayEnabled = false;
	export let xrayEventCount = 0;
	export let resourceCount = 0;
	export let resourcesOpen = false;
	/** Active Study | Translate | Check mode. */
	export let workflowMode: WorkflowMode = 'study';

	function withCode(
		list: Array<{ code: string; name?: string }>,
		code: string
	): Array<{ code: string; name?: string }> {
		if (code && !list.some((l) => l.code === code)) {
			return [{ code, name: code }, ...list];
		}
		return list;
	}

	$: baseLanguageOptions = languages.length
		? languages
		: [{ code: sourceLanguage || 'en', name: sourceLanguage || 'en' }];
	// Neutral "my language" placeholder is metadata, not a catalog entry.
	$: targetLanguageOptions = isNeutralTarget(language)
		? baseLanguageOptions
		: withCode(baseLanguageOptions, language);
	$: sourceLanguageOptions = withCode(baseLanguageOptions, sourceLanguage);
	/** Compact display for the (optional) target side — "—" until the user sets one. */
	$: targetDisplay = isNeutralTarget(language) ? '—' : language.toUpperCase();

	const dispatch = createEventDispatcher<{
		send: void;
		clearScope: void;
		toggleXray: void;
		clearChat: void;
		resetSession: void;
		quickAction: string;
		openResources: void;
		inputFocus: void;
		inputBlur: void;
		languageChange: string;
		sourceLanguageChange: string;
		workflowModeChange: WorkflowMode;
	}>();

	const modeMeta: Record<WorkflowMode, { labelEn: string; Icon: typeof BookMarked }> = {
		study: { labelEn: 'Study', Icon: BookMarked },
		translate: { labelEn: 'Translate', Icon: PenLine },
		check: { labelEn: 'Check', Icon: ClipboardCheck }
	};

	let showMore = false;

	// Model picker — compact chip opening a popover list. Never a native
	// <select>: options must not render inline in the dock (same fix as the
	// language pickers).
	const MODEL_OPTIONS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] as const;
	let modelPickerOpen = false;

	function pickModel(next: string) {
		model = next;
		modelPickerOpen = false;
	}

	// Language-pair picker — compact chip ("EN → ES-419") opening a searchable
	// popover. Never renders the full catalog inline in the dock.
	let langPickerOpen = false;
	let langPickerSide: 'src' | 'tgt' = 'src';
	let langFilter = '';
	let langFilterEl: HTMLInputElement | null = null;

	$: pickerOptions = langPickerSide === 'src' ? sourceLanguageOptions : targetLanguageOptions;
	$: filteredPickerOptions = (() => {
		const q = langFilter.trim().toLowerCase();
		if (!q) return pickerOptions;
		return pickerOptions.filter(
			(l) => l.code.toLowerCase().includes(q) || (l.name?.toLowerCase().includes(q) ?? false)
		);
	})();
	$: pickerCurrentCode = langPickerSide === 'src' ? sourceLanguage : language;

	async function openLangPicker(side: 'src' | 'tgt' = 'src') {
		langPickerSide = side;
		langFilter = '';
		langPickerOpen = true;
		await tick();
		langFilterEl?.focus();
	}

	function closeLangPicker() {
		langPickerOpen = false;
	}

	function pickLanguage(code: string) {
		if (langPickerSide === 'src') {
			dispatch('sourceLanguageChange', code);
		} else {
			dispatch('languageChange', code);
		}
		closeLangPicker();
	}

	function handleLangFilterKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeLangPicker();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const first = filteredPickerOptions[0];
			if (first) pickLanguage(first.code);
		}
	}

	$: scope = $studySession.scope;
	$: isResourceScoped = scope.kind === 'resource';
	$: hasReference = !!$studySession.reference;

	/**
	 * Mode-aware quick prompts. Study offers exploration prompts; Translate and
	 * Check stay quiet (draft editor / checklist are the affordances there).
	 * Resource-scoped chips apply in any mode while a resource thread is active.
	 */
	$: quickChips = (() => {
		const chips: Array<{ label: string; prompt: string }> = [];
		if (hasReference && workflowMode === 'study') {
			chips.push(
				{ label: 'Explain passage', prompt: 'Explain this passage' },
				{
					label: 'Culture',
					prompt: 'What cultural background should I know for this passage?'
				}
			);
		}
		if (isResourceScoped) {
			chips.push(
				{ label: 'Example', prompt: 'Give an example' },
				{ label: 'Simpler', prompt: 'Suggest a simpler rendering' }
			);
		}
		return chips;
	})();

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.shiftKey) return;
		// IME composition: Enter confirms the composed text, not a submit.
		// keyCode 229 covers browsers that fire keydown before compositionend.
		if (e.isComposing || e.keyCode === 229) return;
		e.preventDefault();
		if (isLoading || !input.trim()) return;
		dispatch('send');
	}

	function handleClearScope() {
		clearScope();
		dispatch('clearScope');
	}

	function handleChip(chip: { label: string; prompt: string }) {
		dispatch('quickAction', chip.prompt);
	}
</script>

<div
	class="shrink-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md"
	style="padding-bottom: env(safe-area-inset-bottom, 0px)"
>
	<div class="px-2.5 py-2 sm:px-3 sm:py-2.5">
		<!-- Controls row: quiet mode control + scope + resources + language pair.
		     Conversation drives the mode; this control is a secondary affordance. -->
		<div class="mb-1.5 flex items-center gap-1.5">
			<div
				class="inline-flex shrink-0 items-center rounded-md border border-slate-800 bg-slate-900/50 p-px"
				role="tablist"
				aria-label="Workflow mode"
			>
				{#each WORKFLOW_MODES as mode}
					{@const meta = modeMeta[mode]}
					{@const ModeIcon = meta.Icon}
					{@const active = workflowMode === mode}
					<button
						type="button"
						role="tab"
						aria-selected={active}
						disabled={isLoading}
						title={workflowModeHint(mode, 'en')}
						aria-label={meta.labelEn}
						on:click={() => dispatch('workflowModeChange', mode)}
						class="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-50
							{active
							? mode === 'check'
								? 'bg-emerald-900/70 text-emerald-200'
								: mode === 'translate'
									? 'bg-amber-900/70 text-amber-200'
									: 'bg-sky-900/70 text-sky-200'
							: 'text-slate-500 hover:text-slate-300'}"
					>
						<ModeIcon size={12} strokeWidth={2} />
						<span class="hidden sm:inline">{meta.labelEn}</span>
					</button>
				{/each}
			</div>

			{#if isResourceScoped && scope.kind === 'resource'}
				<div
					class="flex max-w-[55%] min-w-0 items-center gap-1 rounded-full border border-violet-700/60 bg-violet-950/50 px-2 py-0.5 text-xs text-violet-200 sm:max-w-[min(100%,20rem)]"
				>
					<span class="truncate" title={scope.label}>{scope.label}</span>
					<button
						type="button"
						on:click={handleClearScope}
						class="shrink-0 rounded-full p-0.5 text-violet-400 hover:bg-violet-900 hover:text-white"
						title="Clear scope"
						aria-label="Clear scope"
					>
						<X size={12} strokeWidth={2.5} />
					</button>
				</div>
			{/if}

			{#if resourceCount > 0}
				<button
					type="button"
					on:click={() => dispatch('openResources')}
					class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors lg:hidden
						{resourcesOpen
						? 'border-sky-500 bg-sky-950 text-sky-200'
						: 'border-slate-600 bg-slate-900 text-slate-200 hover:border-sky-500 hover:text-white'}"
					title="Passage resources"
					aria-label="Open passage resources"
					aria-pressed={resourcesOpen}
				>
					<BookOpen size={13} strokeWidth={2} />
					<span>Helps</span>
					<span
						class="rounded-full bg-sky-900/80 px-1.5 py-px text-[10px] font-semibold text-sky-200"
					>
						{resourceCount}
					</span>
				</button>
			{/if}

			<div class="ml-auto flex items-center gap-0.5">
				<!-- Language pair chip — source (resources + coach) → target (receptor).
				     Opens a searchable popover; the catalog never renders inline. -->
				<div class="relative shrink-0">
					<button
						type="button"
						on:click={() => (langPickerOpen ? closeLangPicker() : openLangPicker('src'))}
						class="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[10px] tracking-wide text-slate-300 uppercase transition-colors hover:border-sky-500 hover:text-white"
						title="Languages — source {sourceLanguage.toUpperCase()} (helps + coach) → target {targetDisplay} (receptor, optional)"
						aria-label="Change source or target language"
						aria-expanded={langPickerOpen}
						aria-haspopup="dialog"
					>
						<span>{sourceLanguage.toUpperCase()}</span>
						<ArrowRight size={10} strokeWidth={2.5} class="text-slate-500" />
						<span>{targetDisplay}</span>
					</button>

					{#if langPickerOpen}
						<button
							type="button"
							class="fixed inset-0 z-40 cursor-default"
							aria-label="Close language picker"
							on:click={closeLangPicker}
						></button>
						<div
							class="absolute right-0 bottom-full z-50 mb-1.5 w-72 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
							role="dialog"
							aria-label="Language picker"
						>
							<div class="flex gap-1 border-b border-slate-800 p-1.5">
								<button
									type="button"
									on:click={() => (langPickerSide = 'src')}
									class="flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors
										{langPickerSide === 'src' ? 'bg-sky-900/70 text-sky-200' : 'text-slate-400 hover:text-slate-200'}"
									title="Source — scripture/helps + coach language"
								>
									Src · {sourceLanguage.toUpperCase()}
								</button>
								<button
									type="button"
									on:click={() => (langPickerSide = 'tgt')}
									class="flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors
										{langPickerSide === 'tgt' ? 'bg-sky-900/70 text-sky-200' : 'text-slate-400 hover:text-slate-200'}"
									title="Target — receptor language (optional; never required)"
								>
									Tgt · {targetDisplay}
								</button>
							</div>
							<div class="p-1.5">
								<input
									type="search"
									bind:this={langFilterEl}
									bind:value={langFilter}
									on:keydown={handleLangFilterKey}
									placeholder="Search languages…"
									aria-label="Search languages"
									class="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
								/>
							</div>
							<div class="max-h-56 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
								{#each filteredPickerOptions as opt (opt.code)}
									{@const current = opt.code === pickerCurrentCode}
									<button
										type="button"
										on:click={() => pickLanguage(opt.code)}
										class="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors
											{current ? 'bg-sky-950 text-sky-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}"
										aria-pressed={current}
									>
										<span class="truncate">{opt.name || opt.code}</span>
										<span class="shrink-0 font-mono text-[10px] text-slate-500 uppercase"
											>{opt.code}</span
										>
									</button>
								{/each}
								{#if filteredPickerOptions.length === 0}
									<p class="px-2 py-3 text-xs text-slate-500">No languages match.</p>
								{/if}
							</div>
						</div>
					{/if}
				</div>

				<!-- Desktop: model chip + xray + clear -->
				<div class="relative hidden shrink-0 sm:block">
					<button
						type="button"
						on:click={() => (modelPickerOpen = !modelPickerOpen)}
						class="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[10px] text-slate-300 transition-colors hover:border-sky-500 hover:text-white"
						title="Model — {model}"
						aria-label="Change model"
						aria-expanded={modelPickerOpen}
						aria-haspopup="listbox"
					>
						<span>{model}</span>
					</button>

					{#if modelPickerOpen}
						<button
							type="button"
							class="fixed inset-0 z-40 cursor-default"
							aria-label="Close model picker"
							on:click={() => (modelPickerOpen = false)}
						></button>
						<div
							class="absolute right-0 bottom-full z-50 mb-1.5 w-40 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl"
							role="listbox"
							aria-label="Model"
						>
							{#each MODEL_OPTIONS as opt (opt)}
								<button
									type="button"
									role="option"
									aria-selected={opt === model}
									on:click={() => pickModel(opt)}
									class="block w-full rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors
										{opt === model ? 'bg-sky-950 text-sky-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}"
								>
									{opt}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<button
					type="button"
					on:click={() => dispatch('toggleXray')}
					title="{xrayEnabled ? 'X-ray on' : 'Enable X-ray'} — pipeline trace"
					class="hidden items-center gap-0.5 rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 sm:inline-flex
						{xrayActive ? 'text-sky-400' : xrayEnabled ? 'text-amber-400' : ''}"
					aria-label="Toggle X-ray"
				>
					<Zap size={14} strokeWidth={2} />
					{#if xrayEventCount > 0}
						<span class="text-xs">{xrayEventCount}</span>
					{/if}
				</button>

				{#if hasMessages}
					<button
						type="button"
						on:click={() => dispatch('clearChat')}
						class="hidden rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 sm:inline-flex"
						title="Clear chat"
						aria-label="Clear chat"
					>
						<X size={14} strokeWidth={2} />
					</button>
				{/if}

				<button
					type="button"
					on:click={() => dispatch('resetSession')}
					class="hidden rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 sm:inline-flex"
					title="Reset session"
					aria-label="Reset session"
				>
					<RotateCcw size={14} strokeWidth={2} />
				</button>

				<!-- Mobile overflow for model / xray / clear -->
				<button
					type="button"
					class="inline-flex rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white sm:hidden"
					aria-label="More options"
					aria-expanded={showMore}
					on:click={() => (showMore = !showMore)}
				>
					<MoreHorizontal size={16} strokeWidth={2} />
				</button>
			</div>
		</div>

		{#if showMore}
			<div
				class="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-1.5 sm:hidden"
			>
				<div class="flex flex-wrap items-center gap-1" role="listbox" aria-label="Model">
					{#each MODEL_OPTIONS as opt (opt)}
						<button
							type="button"
							role="option"
							aria-selected={opt === model}
							on:click={() => (model = opt)}
							class="rounded-full border px-2 py-1 font-mono text-[10px] transition-colors
								{opt === model
								? 'border-sky-500 bg-sky-950 text-sky-200'
								: 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'}"
						>
							{opt}
						</button>
					{/each}
				</div>
				<button
					type="button"
					on:click={() => dispatch('toggleXray')}
					class="inline-flex items-center gap-0.5 rounded px-2 py-1 text-xs text-slate-400
						{xrayActive ? 'text-sky-400' : xrayEnabled ? 'text-amber-400' : ''}"
				>
					<Zap size={12} strokeWidth={2} />
					X-ray
					{#if xrayEventCount > 0}
						<span>{xrayEventCount}</span>
					{/if}
				</button>
				{#if hasMessages}
					<button
						type="button"
						on:click={() => {
							showMore = false;
							dispatch('clearChat');
						}}
						class="rounded px-2 py-1 text-xs text-slate-400 hover:text-white"
					>
						Clear chat
					</button>
				{/if}
				<button
					type="button"
					on:click={() => {
						showMore = false;
						dispatch('resetSession');
					}}
					class="rounded px-2 py-1 text-xs text-slate-400 hover:text-white"
				>
					Reset session
				</button>
			</div>
		{/if}

		<!-- Quick actions: single horizontal scroll on mobile -->
		{#if quickChips.length > 0 && hasMessages}
			<div
				class="-mx-0.5 mb-1.5 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-0.5 pb-0.5 [-ms-overflow-style:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden"
			>
				{#each quickChips as chip}
					<button
						type="button"
						disabled={isLoading}
						on:click={() => handleChip(chip)}
						class="shrink-0 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300 transition-colors disabled:opacity-40"
					>
						{chip.label}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Input row -->
		<div class="flex gap-2">
			<textarea
				bind:value={input}
				on:keydown={handleKey}
				on:focus={() => dispatch('inputFocus')}
				on:blur={() => dispatch('inputBlur')}
				placeholder={isResourceScoped ? 'Ask about this…' : 'Ask about a passage…'}
				rows="1"
				class="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-base text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none sm:text-sm"
				disabled={isLoading}
			></textarea>
			<button
				type="button"
				on:click={() => dispatch('send')}
				disabled={isLoading || !input.trim()}
				class="inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-full bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:w-auto sm:rounded-xl sm:px-3 sm:py-2"
				aria-label="Send"
			>
				{#if isLoading}
					<Loader2 size={18} strokeWidth={2} class="animate-spin" />
				{:else}
					<ArrowRight size={18} strokeWidth={2} />
				{/if}
			</button>
		</div>
	</div>
</div>
