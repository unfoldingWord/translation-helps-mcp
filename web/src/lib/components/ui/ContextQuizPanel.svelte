<script lang="ts">
	/**
	 * ContextQuizPanel — interactive context quiz in the resources panel.
	 * Radio options per question + one Submit; the server grades against the
	 * note-grounded answer key and Ezer replies in chat. After grading the
	 * component re-renders in `completed` state with per-question results.
	 *
	 * Reactivity note: Svelte does not track locals read inside plain function
	 * calls used in the template. Selection (`chosen`) MUST be read in markup
	 * (e.g. `{@const activeChoice = chosen[q.id]}`) and passed into helpers —
	 * otherwise aria-checked updates while classes stay on the default tone.
	 */
	import BadgeCheck from 'lucide-svelte/icons/badge-check';
	import Brain from 'lucide-svelte/icons/brain';
	import CheckCircle2 from 'lucide-svelte/icons/check-circle-2';
	import Send from 'lucide-svelte/icons/send';
	import XCircle from 'lucide-svelte/icons/x-circle';
	import type { ContextQuizComponent } from '$core/harness/uiComponents.js';
	import {
		isQuizOptionSelected,
		resolveQuizOptionTone,
		type QuizOptionTone
	} from '$core/harness/quizPanel.js';

	export let quiz: ContextQuizComponent;
	/** Submit all chosen answers → parent sends the structured chat message. */
	export let onSubmit: (payload: {
		reference: string;
		answers: (string | null)[];
	}) => void = () => {};
	export let isLoading = false;

	/** Chosen option per question id — reset when a new quiz arrives. */
	let chosen: Record<string, string> = {};
	let submitted = false;
	let quizKey = '';
	$: {
		const key = `${quiz.reference}|${quiz.status}|${quiz.questions.map((q) => q.q).join('|')}`;
		if (key !== quizKey) {
			quizKey = key;
			if (quiz.status === 'active') {
				chosen = {};
				submitted = false;
			}
		}
	}

	$: answeredCount = quiz.questions.filter((q) => chosen[q.id]).length;
	$: allAnswered = answeredCount === quiz.questions.length;

	function pick(qid: string, option: string) {
		if (quiz.status !== 'active' || submitted) return;
		chosen = { ...chosen, [qid]: option };
	}

	function submit() {
		if (!allAnswered || submitted || isLoading) return;
		submitted = true;
		onSubmit({
			reference: quiz.reference,
			answers: quiz.questions.map((q) => chosen[q.id] ?? null)
		});
	}

	const BASE =
		'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors';

	function optionClass(tone: QuizOptionTone): string {
		switch (tone) {
			case 'selected':
				return `${BASE} border-sky-400 bg-sky-800 text-sky-50 ring-1 ring-sky-400/60`;
			case 'correct':
				return `${BASE} border-emerald-400 bg-emerald-800 text-emerald-50`;
			case 'incorrect':
				return `${BASE} border-rose-400 bg-rose-800 text-rose-50`;
			case 'muted':
				return `${BASE} border-slate-700 bg-slate-900/50 text-slate-400`;
			default:
				return `${BASE} border-slate-700 bg-slate-900/50 text-slate-200 hover:border-sky-500/70 hover:bg-slate-800/80`;
		}
	}

	function radioDotClass(tone: QuizOptionTone): string {
		switch (tone) {
			case 'selected':
				return 'border-sky-300 bg-sky-300';
			case 'correct':
				return 'border-emerald-300 bg-emerald-300';
			case 'incorrect':
				return 'border-rose-300 bg-rose-300';
			default:
				return 'border-slate-500';
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="shrink-0 border-b border-slate-800 px-3 py-2.5">
		<div class="flex items-center justify-between gap-2">
			<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
				<Brain size={14} strokeWidth={2} class="text-sky-400" />
				Quiz
				<span class="font-mono text-[10px] text-slate-500">{quiz.reference}</span>
			</span>
			{#if quiz.status === 'completed'}
				<span
					class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px]
						{quiz.passed ? 'bg-emerald-950/60 text-emerald-300' : 'bg-slate-800 text-slate-400'}"
					title={quiz.passed ? 'Passed' : 'Not passed'}
				>
					{#if quiz.passed}<BadgeCheck size={12} strokeWidth={2} />{/if}
					{quiz.correctCount ?? 0}/{quiz.questions.length}
				</span>
			{:else}
				<span
					class="rounded-full bg-sky-950/60 px-2 py-0.5 font-mono text-[11px] text-sky-300"
					title="Answered"
				>
					{answeredCount}/{quiz.questions.length}
				</span>
			{/if}
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
		<ol class="space-y-4">
			{#each quiz.questions as q, i (q.id)}
				{@const activeChoice = chosen[q.id]}
				<li>
					<div class="mb-1.5 flex items-start gap-1.5">
						<span
							class="mt-0.5 shrink-0 rounded bg-slate-800 px-1.5 font-mono text-[10px] text-slate-400"
							aria-hidden="true">{i + 1}</span
						>
						<p class="min-w-0 flex-1 text-xs leading-snug font-medium text-slate-200">
							{q.q}
						</p>
						{#if quiz.status === 'completed'}
							<span class="mt-0.5 shrink-0" aria-hidden="true">
								{#if q.correct}
									<CheckCircle2 size={14} strokeWidth={2} class="text-emerald-400" />
								{:else}
									<XCircle size={14} strokeWidth={2} class="text-rose-400" />
								{/if}
							</span>
						{/if}
					</div>
					<div class="space-y-1 pl-6" role="radiogroup" aria-label={q.q}>
						{#each q.options as option (option)}
							{@const selected = isQuizOptionSelected({
								status: quiz.status,
								option,
								activeChoice,
								completedChosen: q.chosen
							})}
							{@const tone = resolveQuizOptionTone({
								status: quiz.status,
								option,
								activeChoice,
								completedChosen: q.chosen,
								expected: q.expected,
								correct: q.correct
							})}
							<button
								type="button"
								role="radio"
								aria-checked={selected}
								class={optionClass(tone)}
								disabled={quiz.status === 'completed' || submitted}
								on:click={() => pick(q.id, option)}
							>
								<span
									class="mt-0.5 h-3 w-3 shrink-0 rounded-full border {radioDotClass(tone)}"
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1 leading-snug">{option}</span>
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
	</div>

	{#if quiz.status === 'active'}
		<div class="shrink-0 border-t border-slate-800 px-3 py-2.5">
			<button
				type="button"
				class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors
					{allAnswered && !submitted && !isLoading
					? 'bg-sky-600 text-white hover:bg-sky-500'
					: 'cursor-not-allowed bg-slate-800 text-slate-500'}"
				disabled={!allAnswered || submitted || isLoading}
				on:click={submit}
				title="Submit"
				aria-label="Submit quiz answers"
			>
				<Send size={13} strokeWidth={2} />
				Submit
			</button>
		</div>
	{/if}
</div>
