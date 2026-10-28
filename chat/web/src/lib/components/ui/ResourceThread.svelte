<script lang="ts">
	/**
	 * ResourceThread — detail view for a selected resource + its conversation thread.
	 *
	 * For challenges with an empty thread, auto-seeds a Scholar drill insight
	 * via /api/agent drill_challenge as the first assistant message.
	 */

	import { onDestroy } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ArrowRight from 'lucide-svelte/icons/arrow-right';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Shuffle from 'lucide-svelte/icons/shuffle';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Pencil from 'lucide-svelte/icons/pencil';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import Tag from 'lucide-svelte/icons/tag';
	import Landmark from 'lucide-svelte/icons/landmark';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import { renderMarkdown } from '$lib/renderMarkdown.js';
	import { withBase } from '$lib/paths.js';
	import AgentBadge from './AgentBadge.svelte';
	import {
		studySession,
		clearScope,
		appendToThread,
		updateLastThreadMessage,
		getThread,
		type ResourcePayload
	} from '$lib/stores/studySession.js';

	export let resource: ResourcePayload;
	export let resourceKey: string;
	export let currentLanguage = 'en';
	export let totalChallenges = 0;
	export let onNextChallenge: ((index: number) => void) | undefined = undefined;

	let seeding = false;
	let seedAbort: AbortController | null = null;
	let lastSeededKey = '';

	$: thread = $studySession.resourceThreads[resourceKey] ?? [];
	$: challenge = resource.kind === 'challenge' ? resource.challenge : undefined;

	$: if (resourceKey && resourceKey !== lastSeededKey) {
		lastSeededKey = resourceKey;
		maybeSeedChallenge();
	}

	async function maybeSeedChallenge() {
		if (resource.kind !== 'challenge' || !resource.challenge) return;
		const existing = getThread(resourceKey);
		if (existing.length > 0) return;
		if (seeding) return;

		seeding = true;
		seedAbort?.abort();
		seedAbort = new AbortController();

		appendToThread(resourceKey, { role: 'assistant', content: '', streaming: true });

		try {
			const res = await fetch(withBase('/api/agent'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					agent: 'scholar',
					action: {
						type: 'drill_challenge',
						challenge: resource.challenge,
						language: currentLanguage
					}
				}),
				signal: seedAbort.signal
			});

			if (!res.ok || !res.body) {
				updateLastThreadMessage(resourceKey, 'Could not load Scholar insight.', false);
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			let content = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const frames = buf.split('\n\n');
				buf = frames.pop() ?? '';
				for (const frame of frames) {
					if (!frame.trim()) continue;
					const lines = frame.split('\n');
					let ev = 'message';
					let data = '';
					for (const l of lines) {
						if (l.startsWith('event:')) ev = l.slice(6).trim();
						else if (l.startsWith('data:')) data = l.slice(5).trim();
					}
					if (!data) continue;
					try {
						const parsed = JSON.parse(data) as Record<string, unknown>;
						if (ev === 'token') {
							content += String(parsed.delta ?? '');
							updateLastThreadMessage(resourceKey, content, true);
						} else if (ev === 'error') {
							content = `Sorry: ${String(parsed.message ?? 'error')}`;
							updateLastThreadMessage(resourceKey, content, false);
						}
					} catch {
						/* ignore */
					}
				}
			}
			updateLastThreadMessage(resourceKey, content || 'No insight returned.', false);
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				updateLastThreadMessage(resourceKey, 'Could not load Scholar insight.', false);
			}
		} finally {
			seeding = false;
		}
	}

	onDestroy(() => {
		seedAbort?.abort();
	});

	function handleBack() {
		clearScope();
	}

	function handleNext() {
		if (!challenge || !onNextChallenge) return;
		if (challenge.index < totalChallenges) {
			onNextChallenge(challenge.index + 1);
		}
	}

	function stripUsfm(text: string): string {
		return text
			.replace(/\\zaln-[se][^\\]*\\\*/g, '')
			.replace(/\\zaln-[se]\s*\\\*/g, '')
			.replace(/\\w\s+(.*?)\|[^\\]+\\w\*/g, '$1')
			.replace(/\\w\s+(.*?)\\w\*/g, '$1')
			.replace(/\\v\s+\d+\s*/g, '')
			.replace(/\\c\s+\d+\s*/g, '')
			.replace(/\\[a-zA-Z0-9]+\*?\s*/g, '');
	}

	function renderMd(text: string): string {
		try {
			const clean = stripUsfm(text.replace(/<!--[\s\S]*?-->/g, '').trimEnd());
			return renderMarkdown(clean);
		} catch {
			return text;
		}
	}

	const CATEGORY_ICON: Record<string, typeof Sparkles> = {
		'figure-of-speech': Sparkles,
		'double-meaning': Shuffle,
		idiom: MessageCircle,
		grammar: Pencil,
		'key-term': KeyRound,
		name: Tag,
		cultural: Landmark,
		other: AlertTriangle
	};

	const CATEGORY_LABEL: Record<string, string> = {
		'figure-of-speech': 'Figure of speech',
		'double-meaning': 'Double meaning',
		idiom: 'Idiom',
		grammar: 'Grammar',
		'key-term': 'Key term',
		name: 'Name',
		cultural: 'Cultural',
		other: 'Note'
	};
</script>

<div class="flex flex-col overflow-hidden" transition:fade={{ duration: 150 }}>
	<!-- Back bar -->
	<div class="flex shrink-0 items-center gap-2 border-b border-gray-700/60 px-3 py-2">
		<button
			type="button"
			on:click={handleBack}
			class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--bt-taupe)] transition-colors hover:bg-[var(--bt-parchment)] hover:text-[var(--bt-black)]"
		>
			<ArrowLeft size={14} strokeWidth={2} />
			<span>Back</span>
		</button>
		{#if challenge && totalChallenges > 0 && challenge.index < totalChallenges}
			<button
				type="button"
				on:click={handleNext}
				class="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sky-700 transition-colors hover:bg-sky-50 hover:text-sky-900"
			>
				<span>Next</span>
				<ArrowRight size={14} strokeWidth={2} />
			</button>
		{/if}
	</div>

	<div class="space-y-4 px-3 py-3" transition:slide={{ duration: 180 }}>
		<!-- Resource detail -->
		{#if resource.kind === 'challenge' && challenge}
			{@const isKeyTerm = challenge.sourceType === 'tw'}
			{@const CatIcon = CATEGORY_ICON[challenge.category] ?? AlertTriangle}
			<div
				class="rounded-xl border p-4
					{isKeyTerm ? 'border-amber-200 bg-amber-50/70' : 'border-[var(--bt-border)] bg-white'}"
			>
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<span
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white
							{isKeyTerm ? 'bg-amber-700' : 'bg-sky-600'}"
					>
						{challenge.index}
					</span>
					<CatIcon size={14} strokeWidth={2} class="text-[var(--bt-taupe)]" />
					<span
						class="rounded-full px-2 py-0.5 text-xs font-medium
							{isKeyTerm ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-800'}"
					>
						{CATEGORY_LABEL[challenge.category] ?? 'Note'}
					</span>
					<span class="ml-auto font-mono text-xs text-[var(--bt-taupe)]">v.{challenge.verse}</span>
				</div>
				<p class="mb-2 text-lg font-semibold text-[var(--bt-black)]">"{challenge.phrase}"</p>
				{#if challenge.rawNoteText || challenge.noteText}
					<div
						class="prose prose-sm max-w-none text-[var(--bt-muted)]
							[&_p]:mb-1 [&_p:last-child]:mb-0"
					>
						{@html renderMd(challenge.rawNoteText ?? challenge.noteText)}
					</div>
				{/if}
				{#if challenge.at}
					<p class="mt-2 text-sm text-sky-800 italic">→ "{challenge.at}"</p>
				{/if}
			</div>
		{:else if resource.kind === 'note' && resource.note}
			<div class="rounded-xl border border-[var(--bt-border)] bg-white p-4">
				{#if resource.note.quote}
					<p class="mb-2 font-medium text-amber-900 italic">"{resource.note.quote}"</p>
				{/if}
				{#if resource.note.verse}
					<span
						class="mb-2 inline-block rounded bg-[var(--bt-parchment)] px-1.5 py-0.5 font-mono text-xs text-[var(--bt-taupe)]"
					>
						v.{resource.note.verse}
					</span>
				{/if}
				<div class="prose prose-sm max-w-none text-[var(--bt-black)]">
					{@html renderMd(resource.note.noteText)}
				</div>
			</div>
		{:else if resource.kind === 'word' && resource.word}
			<div class="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
				<p class="mb-1 font-semibold text-amber-950">{resource.word.term}</p>
				{#if resource.word.verse}
					<span
						class="mb-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-800"
					>
						v.{resource.word.verse}
					</span>
				{/if}
				{#if resource.word.definition}
					<div class="prose prose-sm max-w-none text-[var(--bt-muted)]">
						{@html renderMd(resource.word.definition)}
					</div>
				{/if}
			</div>
		{:else if resource.kind === 'verse' && resource.verse}
			<div class="rounded-xl border border-sky-200 bg-sky-50 p-4">
				<p class="mb-2 font-mono text-xs text-sky-800">{resource.verse.reference}</p>
				<p class="text-sm leading-relaxed text-[var(--bt-black)]">{resource.verse.text}</p>
			</div>
		{:else if resource.kind === 'question' && resource.question}
			<div class="rounded-xl border border-[var(--bt-border)] bg-[var(--bt-parchment)] p-4">
				{#if resource.question.verse}
					<span class="mb-1 block font-mono text-xs text-[var(--bt-taupe)]"
						>v.{resource.question.verse}</span
					>
				{/if}
				<p class="font-medium text-[var(--bt-black)]">{resource.question.question}</p>
				{#if resource.question.response}
					<p class="mt-1.5 text-xs text-[var(--bt-muted)]">{resource.question.response}</p>
				{/if}
			</div>
		{:else if resource.kind === 'article' && resource.article}
			<div class="rounded-xl border border-sky-200 bg-sky-50 p-4">
				<span
					class="mb-2 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800"
				>
					TA
				</span>
				<p class="font-semibold text-[var(--bt-black)]">
					{resource.article.title || resource.article.path}
				</p>
				{#if resource.article.title && resource.article.path}
					<p class="mt-1 font-mono text-xs text-sky-700/80">{resource.article.path}</p>
				{/if}
			</div>
		{/if}

		<!-- Thread messages -->
		{#if thread.length > 0}
			<div class="space-y-3 border-t border-[var(--bt-border)] pt-3">
				<p class="text-xs font-semibold tracking-wider text-[var(--bt-taupe)] uppercase">
					Conversation
				</p>
				{#each thread as msg, i (i)}
					{#if msg.role === 'user'}
						<div class="flex justify-end">
							<div
								class="max-w-[90%] rounded-2xl rounded-tr-sm bg-sky-600 px-3 py-2 text-sm text-white"
							>
								{msg.content}
							</div>
						</div>
					{:else}
						<div class="flex justify-start">
							<div class="w-full max-w-[95%] space-y-1">
								<AgentBadge agent="scholar" size="sm" />
								<div
									class="prose prose-sm max-w-none rounded-2xl rounded-tl-sm bg-[var(--bt-parchment)] px-3 py-2.5 text-[var(--bt-black)]"
								>
									{#if msg.content}
										{@html renderMd(msg.content)}
										{#if msg.streaming}
											<span class="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-sky-500"></span>
										{/if}
									{:else if msg.streaming}
										<div class="flex items-center gap-1.5 py-1">
											<span
												class="h-2 w-2 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.3s]"
											></span>
											<span
												class="h-2 w-2 animate-bounce rounded-full bg-sky-500 [animation-delay:-0.15s]"
											></span>
											<span class="h-2 w-2 animate-bounce rounded-full bg-sky-500"></span>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>
