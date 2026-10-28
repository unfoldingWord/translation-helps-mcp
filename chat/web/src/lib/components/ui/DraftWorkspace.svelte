<script lang="ts">
	/**
	 * DraftWorkspace — docked "My translation" editor for the current study segment.
	 * Autosaves to th_drafts; outline lists saved book/chapter segments.
	 * Editor is gated to verse ranges / sections — whole chapter & book refs are not draftable.
	 * "Ask for review" asks the coach for source-side check questions (draft body stays local).
	 */
	import { slide } from 'svelte/transition';
	import PenLine from 'lucide-svelte/icons/pen-line';
	import ListTree from 'lucide-svelte/icons/list-tree';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Check from 'lucide-svelte/icons/check';
	import MessageSquareText from 'lucide-svelte/icons/message-square-text';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import {
		draftWorkspace,
		draftOutline,
		setEditorText,
		flushActiveDraft,
		openDraftSegment,
		setDraftOpen,
		setOutlineOpen,
		toggleDraftOpen,
		requestDraftCoachReview,
		isDraftableMeta,
		isDraftableRef
	} from '$lib/stores/draftStore.js';
	import { metaFromSegmentKey } from '$core/drafts/draftModel.js';
	import type { WorkflowMode } from '$lib/stores/studySession.js';

	/** Receptor / target language (kept for call-site compatibility — chrome is English). */
	export let language = 'en';
	/** Source / conversation language — phrasing for ready-for-check cue. */
	export let sourceLanguage = 'en';
	/** When true, disable Ask for review (e.g. chat already streaming). */
	export let reviewDisabled = false;
	/** Current study-session reference (may be book/chapter — used for gate UI). */
	export let studyReference: string | null = null;

	void language;
	/**
	 * Active workflow mode. Translate = expanded editor; Study/Check =
	 * collapsed by default (one tap re-opens). Check = read-only preview.
	 */
	export let workflowMode: WorkflowMode = 'study';

	/** Mode change drives the collapsed/expanded default; user toggle still wins after. */
	let lastAppliedMode: WorkflowMode | null = null;
	$: if (workflowMode !== lastAppliedMode) {
		lastAppliedMode = workflowMode;
		setDraftOpen(workflowMode === 'translate');
	}

	$: readOnly = workflowMode === 'check';

	$: activeDraftable =
		!!$draftWorkspace.activeKey && isDraftableMeta(metaFromSegmentKey($draftWorkspace.activeKey));

	$: studyNeedsSection =
		!!studyReference?.trim() && !isDraftableRef(studyReference) && !activeDraftable;

	const title = 'My translation';
	const sectionGateLabel = 'Pick a verse range to draft';
	const sectionGateHint = 'Sections only — not whole chapters';

	$: placeholder = activeDraftable
		? `Write your translation of ${$draftWorkspace.activeReference}…`
		: studyNeedsSection
			? sectionGateLabel
			: 'Load a verse range to start translating…';
	$: statusLabel =
		$draftWorkspace.saveStatus === 'dirty'
			? 'Unsaved…'
			: $draftWorkspace.saveStatus === 'saving'
				? 'Saving…'
				: $draftWorkspace.saveStatus === 'saved'
					? 'Saved'
					: '';
	$: canRequestReview =
		activeDraftable &&
		!!$draftWorkspace.activeReference &&
		!!$draftWorkspace.editorText.trim() &&
		!reviewDisabled &&
		!readOnly;
	const reviewLabel = 'Ask for review';

	$: showWorkspace =
		!!$draftWorkspace.activeKey || $draftOutline.length > 0 || !!studyReference?.trim();

	function onInput(e: Event) {
		const el = e.currentTarget as HTMLTextAreaElement;
		setEditorText(el.value);
	}

	function onBlur() {
		flushActiveDraft();
	}

	function onRequestReview() {
		const reference = $draftWorkspace.activeReference;
		const draft = $draftWorkspace.editorText;
		if (!reference || !draft.trim() || reviewDisabled || !activeDraftable) return;
		requestDraftCoachReview({
			reference,
			draft,
			language: sourceLanguage,
			source: 'workspace'
		});
	}

	function segmentIsDraftable(key: string): boolean {
		return isDraftableMeta(metaFromSegmentKey(key));
	}
</script>

{#if showWorkspace}
	<div class="shrink-0 border-t border-slate-800 bg-slate-950/95">
		<div class="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3">
			<button
				type="button"
				class="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-slate-200 hover:bg-slate-900"
				on:click={toggleDraftOpen}
				aria-expanded={$draftWorkspace.open}
				{title}
			>
				<PenLine size={14} strokeWidth={2} class="shrink-0 text-amber-500" />
				<span class="truncate">{title}</span>
				{#if activeDraftable && $draftWorkspace.activeReference}
					<span
						class="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-200/90"
					>
						{$draftWorkspace.activeReference}
					</span>
				{:else if studyNeedsSection && studyReference}
					<span
						class="shrink-0 rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
						title={sectionGateHint}
					>
						{studyReference}
					</span>
				{/if}
				{#if statusLabel}
					<span
						class="inline-flex shrink-0 items-center gap-0.5 text-[10px]
							{$draftWorkspace.saveStatus === 'saved' ? 'text-emerald-400' : 'text-amber-400/90'}"
					>
						{#if $draftWorkspace.saveStatus === 'saved'}
							<Check size={10} strokeWidth={2.5} />
						{/if}
						{statusLabel}
					</span>
				{/if}
				<span class="ml-auto shrink-0 text-slate-500" aria-hidden="true">
					{#if $draftWorkspace.open}
						<ChevronDown size={14} strokeWidth={2} />
					{:else}
						<ChevronUp size={14} strokeWidth={2} />
					{/if}
				</span>
			</button>

			<button
				type="button"
				class="inline-flex items-center justify-center rounded-md border border-slate-700 p-1.5 text-slate-400 hover:border-amber-700 hover:text-amber-300
					{$draftWorkspace.outlineOpen ? 'border-amber-700 text-amber-300' : ''}"
				title="Saved drafts"
				aria-label="Saved drafts"
				aria-pressed={$draftWorkspace.outlineOpen}
				on:click={() => {
					setDraftOpen(true);
					setOutlineOpen(!$draftWorkspace.outlineOpen);
				}}
			>
				<ListTree size={14} strokeWidth={2} />
			</button>
		</div>

		{#if $draftWorkspace.open}
			<div
				transition:slide={{ duration: 150 }}
				class="flex max-h-52 gap-0 border-t border-slate-800/80 sm:max-h-56"
			>
				{#if $draftWorkspace.outlineOpen}
					<nav
						class="w-[42%] shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950/80 px-1.5 py-1.5 sm:w-48"
						aria-label="Draft outline"
					>
						{#if $draftOutline.length === 0}
							<p class="px-1.5 py-2 text-[11px] text-slate-600">No drafts yet.</p>
						{:else}
							{#each $draftOutline as bookGroup (bookGroup.book)}
								<div class="mb-1.5">
									<p
										class="px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-amber-500/90"
									>
										{bookGroup.book}
									</p>
									{#each bookGroup.chapters as ch (ch.chapter)}
										<p class="px-1.5 text-[10px] text-slate-500">ch. {ch.chapter}</p>
										<ul class="space-y-0.5">
											{#each ch.segments as seg (seg.key)}
												<li>
													{#if segmentIsDraftable(seg.key)}
														<button
															type="button"
															class="w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] transition-colors
																{seg.key === $draftWorkspace.activeKey
																? 'bg-amber-950/60 text-amber-200'
																: 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}"
															on:click={() => openDraftSegment(seg.key)}
															title={seg.reference}
														>
															{seg.reference}
														</button>
													{:else}
														<span
															class="block w-full truncate rounded px-1.5 py-1 font-mono text-[11px] text-slate-600"
															title="Section drafts only"
														>
															{seg.reference}
														</span>
													{/if}
												</li>
											{/each}
										</ul>
									{/each}
								</div>
							{/each}
						{/if}
					</nav>
				{/if}

				<div class="min-w-0 flex-1 p-2 sm:px-2.5 sm:pt-2 sm:pb-2.5">
					{#if !activeDraftable}
						<!-- Gate: book / whole chapter — no free-form chapter textarea -->
						<div
							class="flex max-h-36 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-4 text-center"
							role="status"
							aria-label={sectionGateLabel}
						>
							<BookOpen size={20} strokeWidth={1.75} class="text-slate-500" />
							<p class="text-xs font-medium text-slate-300">{sectionGateLabel}</p>
							<p class="text-[11px] text-slate-500">{sectionGateHint}</p>
						</div>
					{:else if readOnly}
						<!-- Check mode: read-only preview — editing resumes in Translate. -->
						<div
							class="max-h-36 w-full overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-2 text-sm leading-relaxed text-slate-300"
							aria-label={title}
							aria-readonly="true"
						>
							{#if $draftWorkspace.editorText.trim()}
								<p class="whitespace-pre-wrap">{$draftWorkspace.editorText}</p>
							{:else}
								<p class="text-slate-600">{placeholder}</p>
							{/if}
						</div>
					{:else}
						<textarea
							value={$draftWorkspace.editorText}
							on:input={onInput}
							on:blur={onBlur}
							rows="4"
							{placeholder}
							class="w-full resize-y rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-2 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-amber-700/70 focus:ring-1 focus:ring-amber-700/40 focus:outline-none"
							aria-label={title}
						></textarea>
						<button
							type="button"
							class="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-800/70 bg-amber-950/40 px-2.5 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:border-amber-600 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
							disabled={!canRequestReview}
							title={reviewLabel}
							aria-label={reviewLabel}
							on:click={onRequestReview}
						>
							<MessageSquareText size={14} strokeWidth={2} />
							<span>{reviewLabel}</span>
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
