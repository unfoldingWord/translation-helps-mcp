<script lang="ts">
	/**
	 * Checking checklist — completion is read-only (coach CHECK markers only).
	 * Clicking an item starts a coach check conversation for that item; it
	 * never toggles the item directly.
	 */
	import CheckCircle2 from 'lucide-svelte/icons/check-circle-2';
	import Circle from 'lucide-svelte/icons/circle';
	import StickyNote from 'lucide-svelte/icons/sticky-note';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import HelpCircle from 'lucide-svelte/icons/help-circle';
	import ClipboardCheck from 'lucide-svelte/icons/clipboard-check';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import { groupChecklistItems, type ChecklistItem } from '$lib/stores/checkingChecklistStore.js';

	export let items: ChecklistItem[] = [];
	export let completed = 0;
	export let total = 0;
	/** Click an item → start a coach check for it in chat (no self-ticking). */
	export let onCheckItem: (item: ChecklistItem) => void = () => {};

	$: groups = groupChecklistItems(items);
	$: pct = total > 0 ? Math.round((completed / total) * 100) : 0;

	function rowClass(item: ChecklistItem): string {
		return item.completed
			? 'border-emerald-900/50 bg-emerald-950/20 text-slate-400 hover:border-emerald-700/60'
			: 'border-slate-800 bg-slate-900/40 text-slate-200 hover:border-sky-600/60 hover:bg-slate-900/70';
	}

	function itemAria(item: ChecklistItem): string {
		if (item.completed) {
			return `Checked: ${item.title}. Click to revisit it with the coach`;
		}
		return `Unchecked: ${item.title}. Click to check it with the coach`;
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="shrink-0 border-b border-slate-800 px-3 py-2.5">
		<div class="flex items-center justify-between gap-2">
			<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
				<ClipboardCheck size={14} strokeWidth={2} class="text-emerald-400" />
				Checking
			</span>
			<span
				class="rounded-full bg-emerald-950/60 px-2 py-0.5 font-mono text-[11px] text-emerald-300"
				title="Progress"
			>
				{completed}/{total}
			</span>
		</div>
		<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
			<div
				class="h-full rounded-full bg-emerald-500 transition-all duration-300"
				style="width: {pct}%"
			></div>
		</div>
		<p class="mt-1.5 text-[10px] text-slate-600">
			Click an item to check it with the coach — only the coach ticks it.
		</p>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
		{#if total === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-10 text-center">
				<ClipboardCheck size={32} strokeWidth={1.5} class="text-slate-700" />
				<p class="text-xs text-slate-600">No items yet</p>
			</div>
		{:else}
			{#each [{ key: 'notes', label: 'Notes', Icon: StickyNote, list: groups.notes }, { key: 'words', label: 'Key terms', Icon: KeyRound, list: groups.words }, { key: 'questions', label: 'Questions', Icon: HelpCircle, list: groups.questions }] as section (section.key)}
				{#if section.list.length}
					<section class="mb-4">
						<h3
							class="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
						>
							<svelte:component this={section.Icon} size={11} strokeWidth={2} />
							{section.label}
							<span class="font-mono text-slate-600">
								{section.list.filter((i) => i.completed).length}/{section.list.length}
							</span>
						</h3>
						<ul class="space-y-1">
							{#each section.list as item (item.id)}
								<li>
									<button
										type="button"
										class="group flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors {rowClass(
											item
										)}"
										aria-label={itemAria(item)}
										title={itemAria(item)}
										on:click={() => onCheckItem(item)}
									>
										<span class="mt-0.5 shrink-0" aria-hidden="true">
											{#if item.completed}
												<CheckCircle2 size={14} strokeWidth={2} class="text-emerald-400" />
											{:else}
												<Circle size={14} strokeWidth={2} class="text-slate-600" />
											{/if}
										</span>
										<span class="min-w-0 flex-1">
											{#if item.verse}
												<span class="mb-0.5 block font-mono text-[10px] text-slate-500"
													>v.{item.verse}</span
												>
											{/if}
											<span
												class="block leading-snug {item.completed
													? 'line-through decoration-slate-600'
													: ''}">{item.title}</span
											>
										</span>
										<span
											class="mt-0.5 shrink-0 text-slate-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
											aria-hidden="true"
										>
											<MessageCircle size={13} strokeWidth={2} class="text-sky-400" />
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			{/each}
		{/if}
	</div>
</div>
