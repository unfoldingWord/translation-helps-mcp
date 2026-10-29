<script lang="ts">
	/**
	 * ScriptureHeader — in-stream scripture card for a passage study block.
	 * Includes Read → Explore → Check stage strip and tap-to-explore phrases.
	 */

	import BookOpen from 'lucide-svelte/icons/book-open';
	import CheckCircle2 from 'lucide-svelte/icons/check-circle-2';
	import Compass from 'lucide-svelte/icons/compass';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import ScriptureTextPanel from './ScriptureTextPanel.svelte';
	import {
		studySession,
		requestOpenCheck,
		selectResource,
		type ChallengeItem
	} from '$lib/stores/studySession.js';

	interface Version {
		label: string;
		text: string;
		direction?: 'ltr' | 'rtl';
		resourceType?: string;
	}

	export let reference = '';
	export let versions: Version[] = [];
	export let highlightPhrase: string | undefined = undefined;
	export let challenges: ChallengeItem[] = [];
	export let exploredIndices: number[] = [];
	/** When false, starts collapsed (older passage blocks). */
	export let expanded = true;
	/** When true, stage strip reacts to session; older blocks show read-only stages. */
	export let active = true;

	let collapsed = !expanded;
	let lastExpanded = expanded;

	$: if (expanded !== lastExpanded) {
		lastExpanded = expanded;
		collapsed = !expanded;
	}

	$: preview = versions[0]?.text?.replace(/\s+/g, ' ').trim().slice(0, 140) ?? '';
	$: previewLabel = versions[0]?.label ?? '';

	$: readDone = versions.length > 0;
	$: exploreDone = active && $studySession.explored.length > 0;
	$: checkKey = reference ? `check:${reference}` : '';
	$: checkDone = active && !!checkKey && ($studySession.resourceThreads[checkKey]?.length ?? 0) > 0;

	$: activeStage = !active
		? 'done'
		: !readDone
			? 'read'
			: !exploreDone
				? 'explore'
				: !checkDone
					? 'check'
					: 'done';

	function toggle() {
		collapsed = !collapsed;
	}

	function handleCheckClick() {
		if (!active) return;
		requestOpenCheck();
	}

	function handleSelectChallenge(c: ChallengeItem) {
		if (!active) return;
		selectResource({ kind: 'challenge', challenge: c });
	}

	function stageClass(stage: 'read' | 'explore' | 'check', done: boolean): string {
		const isActive =
			active && (activeStage === stage || (activeStage === 'done' && stage === 'check'));
		if (done) {
			return isActive
				? 'border-emerald-400 bg-emerald-50 text-emerald-800'
				: 'border-emerald-200 bg-emerald-50/70 text-emerald-700';
		}
		if (isActive) {
			return 'border-sky-400 bg-sky-50 text-sky-800';
		}
		return 'border-[var(--bt-border)] bg-white text-[var(--bt-taupe)]';
	}
</script>

{#if versions.length > 0}
	<div class="overflow-hidden rounded-xl border border-[var(--bt-border)] bg-white shadow-sm">
		<!-- Stage strip -->
		{#if active}
			<div
				class="flex items-center gap-1.5 border-b border-[var(--bt-border)] bg-[var(--bt-parchment)] px-3 py-1.5"
			>
				<span
					class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase {stageClass(
						'read',
						readDone
					)}"
					title="Passage loaded"
				>
					{#if readDone}
						<CheckCircle2 size={12} strokeWidth={2.25} class="shrink-0" />
					{:else}
						<span class="font-mono">1</span>
					{/if}
					<span class="hidden sm:inline">Read</span>
				</span>
				<span class="text-[var(--bt-taupe)]" aria-hidden="true">
					<ArrowRight size={12} strokeWidth={2} />
				</span>
				<span
					class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase {stageClass(
						'explore',
						exploreDone
					)}"
					title="Explore challenges and resources"
				>
					{#if exploreDone}
						<CheckCircle2 size={12} strokeWidth={2.25} class="shrink-0" />
					{:else}
						<Compass size={12} strokeWidth={2} class="shrink-0" />
					{/if}
					<span class="hidden sm:inline">Explore</span>
				</span>
				<span class="text-[var(--bt-taupe)]" aria-hidden="true">
					<ArrowRight size={12} strokeWidth={2} />
				</span>
				<button
					type="button"
					on:click={handleCheckClick}
					class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase transition-colors hover:border-emerald-500 {stageClass(
						'check',
						checkDone
					)}"
					title="Check your draft"
					aria-label="Open draft check"
				>
					{#if checkDone}
						<CheckCircle2 size={12} strokeWidth={2.25} class="shrink-0" />
					{:else}
						<ShieldCheck size={12} strokeWidth={2} class="shrink-0" />
					{/if}
					<span class="hidden sm:inline">Check</span>
				</button>
			</div>
		{/if}

		{#if collapsed}
			<button
				type="button"
				on:click={toggle}
				class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bt-parchment)]"
				aria-expanded="false"
				aria-label="Expand scripture"
			>
				<BookOpen size={14} strokeWidth={2} class="shrink-0 text-sky-600" />
				{#if reference}
					<span
						class="shrink-0 rounded bg-[var(--bt-black)] px-2 py-0.5 font-mono text-xs text-[var(--bt-cream)]"
					>
						{reference}
					</span>
				{/if}
				{#if previewLabel}
					<span class="shrink-0 text-xs font-medium text-[var(--bt-taupe)]">{previewLabel}</span>
				{/if}
				<span class="min-w-0 flex-1 truncate text-xs text-[var(--bt-muted)]">
					{preview}{preview.length >= 140 ? '…' : ''}
				</span>
				<span class="shrink-0 text-[var(--bt-taupe)]" aria-hidden="true">
					<ChevronDown size={14} strokeWidth={2} />
				</span>
			</button>
		{:else}
			<div class="relative">
				<button
					type="button"
					on:click={toggle}
					class="absolute top-2 right-2 z-10 inline-flex items-center rounded border border-[var(--bt-border)] bg-white/95 px-2 py-0.5 text-xs text-[var(--bt-taupe)] transition-colors hover:border-sky-500 hover:text-[var(--bt-black)]"
					aria-expanded="true"
					aria-label="Collapse scripture"
					title="Collapse"
				>
					<ChevronUp size={14} strokeWidth={2} />
				</button>
				<div class="max-h-72 overflow-y-auto md:max-h-96">
					<ScriptureTextPanel
						{reference}
						{versions}
						{highlightPhrase}
						{challenges}
						{exploredIndices}
						selectedPhrase={highlightPhrase}
						onSelectChallenge={handleSelectChallenge}
					/>
				</div>
			</div>
		{/if}
	</div>
{/if}
