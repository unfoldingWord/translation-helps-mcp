<script lang="ts">
	/** Recursive, collapsible JSON tree viewer for the Playground result pane. */

	type JsonPrimitive = string | number | boolean | null;
	type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };

	interface Props {
		value: JsonValue;
		/** Current depth (used to auto-expand shallow levels). */
		depth?: number;
		/** Prop key label shown before the value. */
		propKey?: string | number;
		/** Whether this is the last item in its parent container. */
		isLast?: boolean;
	}

	let { value, depth = 0, propKey, isLast = true }: Props = $props();

	let expanded = $state(depth < 2);
	let strExpanded = $state(false);

	const isArray = $derived(Array.isArray(value));
	const isObject = $derived(
		value !== null && typeof value === 'object' && !Array.isArray(value)
	);
	const isExpandable = $derived(isArray || isObject);
	const isLongString = $derived(typeof value === 'string' && value.length > 160);

	const entries = $derived(
		isArray
			? (value as JsonValue[]).map((v, i) => [i, v] as [string | number, JsonValue])
			: isObject
				? Object.entries(value as Record<string, JsonValue>)
				: []
	);

	const count = $derived(entries.length);
	const brackets = $derived(isArray ? (['[', ']'] as const) : (['{', '}'] as const));

	/**
	 * Try to parse a JSON string value — if it parses to an object/array,
	 * we'll render it as a nested tree instead of a raw string.
	 */
	const parsedInner = $derived.by(() => {
		if (typeof value !== 'string') return null;
		const trimmed = (value as string).trim();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
		try {
			const parsed = JSON.parse(trimmed);
			if (typeof parsed === 'object' && parsed !== null) return parsed as JsonValue;
		} catch {
			/* not JSON */
		}
		return null;
	});

	function toggle() {
		expanded = !expanded;
	}

	/** Inline preview of a collapsed container. */
	function preview(val: JsonValue, maxItems = 3): string {
		if (Array.isArray(val)) {
			const items = val.slice(0, maxItems).map((v) => previewPrimitive(v));
			const more = val.length > maxItems ? ` …+${val.length - maxItems}` : '';
			return `[${items.join(', ')}${more}]`;
		}
		if (val !== null && typeof val === 'object') {
			const keys = Object.keys(val as object).slice(0, maxItems);
			const more =
				Object.keys(val as object).length > maxItems
					? ` …+${Object.keys(val as object).length - maxItems}`
					: '';
			return `{ ${keys.join(', ')}${more} }`;
		}
		return previewPrimitive(val);
	}

	function previewPrimitive(val: JsonValue): string {
		if (val === null) return 'null';
		if (typeof val === 'string') return `"${val.slice(0, 20)}${val.length > 20 ? '…' : ''}"`;
		return String(val);
	}
</script>

<span class="json-node">
	<!-- Key label -->
	{#if propKey !== undefined}
		<span class="json-key">"{propKey}"</span><span class="json-punct">: </span>
	{/if}

	{#if isExpandable}
		<!-- Expandable container (object / array) -->
		<button onclick={toggle} class="json-toggle" title={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded}>
			<span class="json-chevron" class:rotated={expanded}>▶</span>
		</button>

		{#if expanded}
			<span class="json-bracket">{brackets[0]}</span
			><span class="json-count"
				>{count} {isArray ? (count === 1 ? 'item' : 'items') : count === 1 ? 'key' : 'keys'}</span
			>
			<div class="json-children">
				{#each entries as [k, v], i}
					<div class="json-entry">
						<svelte:self value={v} depth={depth + 1} propKey={k} isLast={i === count - 1} />
						{#if i < count - 1}<span class="json-punct">,</span>{/if}
					</div>
				{/each}
			</div>
			<span class="json-bracket">{brackets[1]}</span>
		{:else}
			<button onclick={toggle} class="json-preview">
				<span class="json-bracket">{brackets[0]}</span>
				<span class="json-preview-text">{preview(value)}</span>
				<span class="json-bracket">{brackets[1]}</span>
			</button>
		{/if}
	{:else if parsedInner !== null}
		<!-- JSON string that parses to an object/array — render as nested tree -->
		<span class="json-parsed-badge">JSON↓</span>
		<svelte:self value={parsedInner} depth={depth + 1} isLast={true} />
	{:else if value === null}
		<span class="json-null">null</span>
	{:else if typeof value === 'boolean'}
		<span class="json-bool">{String(value)}</span>
	{:else if typeof value === 'number'}
		<span class="json-number">{value}</span>
	{:else if typeof value === 'string'}
		{#if isLongString}
			<!-- Long strings: show truncated with expand toggle -->
			<span class="json-string"
				>"{strExpanded ? (value as string) : (value as string).slice(0, 160)}…"</span
			>
			<button
				onclick={() => (strExpanded = !strExpanded)}
				class="json-str-toggle"
			>{strExpanded ? 'less' : `+${(value as string).length - 160} more`}</button
			>
		{:else}
			<span class="json-string">"{value}"</span>
		{/if}
	{/if}
</span>

<style>
	.json-node {
		font-family: 'Fira Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.78rem;
		line-height: 1.65;
	}

	.json-key {
		color: #93c5fd; /* blue-300 */
	}

	.json-punct {
		color: #4b5563; /* gray-600 */
	}

	.json-bracket {
		color: #9ca3af; /* gray-400 */
		font-weight: 600;
	}

	.json-string {
		color: #86efac; /* green-300 */
		word-break: break-all;
	}

	.json-number {
		color: #fde68a; /* amber-200 */
	}

	.json-bool {
		color: #fb923c; /* orange-400 */
		font-weight: 600;
	}

	.json-null {
		color: #6b7280;
		font-style: italic;
	}

	.json-toggle {
		background: none;
		border: none;
		padding: 0 2px 0 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
	}

	.json-chevron {
		font-size: 0.5rem;
		color: #6b7280;
		display: inline-block;
		transition: transform 0.12s ease;
		transform: rotate(0deg);
		line-height: 1;
	}

	.json-chevron.rotated {
		transform: rotate(90deg);
	}

	.json-children {
		padding-left: 1.4rem;
		border-left: 1px solid #1f2937;
		margin-left: 0.3rem;
	}

	.json-entry {
		display: block;
	}

	.json-count {
		color: #4b5563;
		font-size: 0.68rem;
		font-style: italic;
		margin-left: 0.35rem;
	}

	.json-preview {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline;
	}

	.json-preview:hover .json-preview-text {
		color: #a5b4fc;
	}

	.json-preview-text {
		color: #6b7280;
		font-style: italic;
		transition: color 0.12s;
	}

	.json-parsed-badge {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 700;
		color: #818cf8; /* indigo-400 */
		background: #1e1b4b;
		border-radius: 3px;
		padding: 0 4px;
		margin-right: 4px;
		vertical-align: middle;
		letter-spacing: 0.05em;
	}

	.json-str-toggle {
		background: none;
		border: none;
		padding: 0 3px;
		cursor: pointer;
		font-size: 0.65rem;
		color: #818cf8;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		vertical-align: middle;
	}

	.json-str-toggle:hover {
		color: #a5b4fc;
	}
</style>
