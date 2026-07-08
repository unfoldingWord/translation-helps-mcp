<script lang="ts">
	/**
	 * TranslationNoteCard — a rich card for a single translation note.
	 *
	 * Shows the original-language quote at the top, a category pill,
	 * a markdown-rendered note body, and an optional TA link.
	 */

	import { renderMarkdown } from '$lib/renderMarkdown.js';

	interface Note {
		id: string;
		quote?: string;
		noteText: string;
		supportReference?: string;
		category?: string;
		verse?: string;
	}

	export let note: Note;

	function taLinkHref(ref: string): string {
		// Convert rc://*/ta/man/translate/figs-metaphor → a readable URL or just display it
		const match = ref.match(/ta\/man\/[^/]+\/([^/]+)/);
		return match ? `https://www.translationacademy.org/${match[1]}` : ref;
	}

	function taLinkLabel(ref: string): string {
		const match = ref.match(/([^/]+)$/);
		return match ? match[1].replace(/-/g, ' ') : ref;
	}

	const CATEGORY_COLORS: Record<string, string> = {
		'figs-metaphor': 'bg-violet-900/60 text-violet-300',
		'figs-simile': 'bg-violet-900/60 text-violet-300',
		'figs-idiom': 'bg-blue-900/60 text-blue-300',
		'figs-parallelism': 'bg-blue-900/60 text-blue-300',
		'figs-personification': 'bg-purple-900/60 text-purple-300',
		'figs-synecdoche': 'bg-purple-900/60 text-purple-300',
		'figs-explicit': 'bg-teal-900/60 text-teal-300',
		'figs-extrainfo': 'bg-teal-900/60 text-teal-300',
		'grammar-connect': 'bg-emerald-900/60 text-emerald-300',
		'translate-names': 'bg-amber-900/60 text-amber-300',
		'translate-unknown': 'bg-orange-900/60 text-orange-300',
		'writing-background': 'bg-gray-700/60 text-gray-300'
	};

	function categoryColor(cat?: string): string {
		if (!cat) return 'bg-gray-700/60 text-gray-400';
		for (const [key, cls] of Object.entries(CATEGORY_COLORS)) {
			if (cat.toLowerCase().includes(key)) return cls;
		}
		return 'bg-gray-700/60 text-gray-400';
	}
</script>

<div class="rounded-lg border border-gray-700/60 bg-gray-800/50 text-sm">
	<!-- Quote section -->
	{#if note.quote}
		<div class="rounded-t-lg border-b border-amber-700/30 bg-amber-950/30 px-3 py-2">
			<div class="mb-1 flex items-center gap-2">
				{#if note.verse}
					<span class="rounded bg-gray-700/60 px-1.5 py-0.5 font-mono text-xs text-gray-400">
						v.{note.verse}
					</span>
				{/if}
				{#if note.category}
					<span class="rounded-full px-2 py-0.5 text-xs font-medium {categoryColor(note.category)}">
						{note.category}
					</span>
				{/if}
			</div>
			<p class="font-medium text-amber-200 italic">"{note.quote}"</p>
		</div>
	{:else}
		<!-- No quote: still show verse + category in header -->
		{#if note.verse || note.category}
			<div class="flex items-center gap-2 border-b border-gray-700/40 px-3 py-1.5">
				{#if note.verse}
					<span class="rounded bg-gray-700/60 px-1.5 py-0.5 font-mono text-xs text-gray-400">
						v.{note.verse}
					</span>
				{/if}
				{#if note.category}
					<span class="rounded-full px-2 py-0.5 text-xs font-medium {categoryColor(note.category)}">
						{note.category}
					</span>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Note body -->
	<div class="px-3 py-2.5">
		<div
			class="prose prose-invert prose-xs max-w-none text-gray-300
				[&_a]:text-indigo-400 [&_em]:text-indigo-300 [&_p]:mb-1
				[&_p:last-child]:mb-0 [&_strong]:text-gray-100"
		>
			{@html renderMarkdown(note.noteText)}
		</div>

		<!-- TA link -->
		{#if note.supportReference && note.supportReference.includes('ta/')}
			<div class="mt-2 flex items-center gap-1.5">
				<span class="text-xs text-gray-500">→</span>
				<a
					href={taLinkHref(note.supportReference)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-xs text-indigo-400 underline-offset-2 hover:underline"
					title={note.supportReference}
				>
					{taLinkLabel(note.supportReference)}
				</a>
			</div>
		{/if}
	</div>
</div>
