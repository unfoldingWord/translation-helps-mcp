<script lang="ts">
	/**
	 * DraftCheckCard — local draft workspace for Check step.
	 * Seeds from the My translation editor; "Ask for review" requests source-side check questions
	 * (draft body stays local — not sent to the coach).
	 */

	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import { getDraftTextForReference, requestDraftCoachReview } from '$lib/stores/draftStore.js';
	import { appendToThread } from '$lib/stores/studySession.js';

	export let reference = '';
	/** Receptor / target language (kept for call-site compatibility — chrome is English). */
	export let language = 'en';
	/** Source / conversation language for ready-for-check cue. */
	export let sourceLanguage = 'en';
	/** Optional seed from the My translation editor (overrides empty local state). */
	export let initialDraft = '';
	/** Kept for TurnResources call-site compatibility; coach fetches TN/TQ via harness. */
	export let tnNotes: Array<{
		id: string;
		quote?: string;
		noteText: string;
		verse?: string;
	}> = [];
	export let tqQuestions: Array<{
		id: string;
		question: string;
		response?: string;
		verse?: string;
	}> = [];

	void tnNotes;
	void tqQuestions;
	void language;

	let draft = '';
	let status = '';
	let lastCheckKey = '';

	$: checkKey = reference ? `check:${reference}` : '';
	$: workspaceDraft = initialDraft.trim() || (reference ? getDraftTextForReference(reference) : '');

	$: if (checkKey !== lastCheckKey) {
		lastCheckKey = checkKey;
		status = '';
		draft = workspaceDraft;
	} else if (!draft.trim() && workspaceDraft) {
		draft = workspaceDraft;
	}

	function handleSubmit() {
		const text = draft.trim();
		if (!text || !reference) return;

		const ok = requestDraftCoachReview({
			reference,
			draft: text,
			language: sourceLanguage,
			source: 'check_card'
		});
		if (!ok) return;

		const key = `check:${reference}`;
		const note = 'Sent to chat — the coach will ask check questions (without reading your draft).';
		appendToThread(key, {
			role: 'user',
			content: "I'm ready for check questions."
		});
		appendToThread(key, { role: 'assistant', content: note });
		status = note;
	}
</script>

<div class="space-y-3 p-2">
	<textarea
		bind:value={draft}
		rows="4"
		placeholder="Paste your draft translation of {reference || 'this passage'}…"
		class="w-full resize-y rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/40 focus:outline-none"
		aria-label="Draft translation"
	></textarea>

	<button
		type="button"
		on:click={handleSubmit}
		disabled={!draft.trim() || !reference}
		class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800/80 px-3 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
	>
		<ShieldCheck size={16} strokeWidth={2} />
		<span>Check my draft</span>
	</button>

	{#if status}
		<p class="text-xs text-emerald-300/90">{status}</p>
	{/if}
</div>
