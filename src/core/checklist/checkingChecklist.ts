/**
 * Read-only translation checking checklist — pure model.
 *
 * Items are populated from TN / TW / TQ for a passage. The coach marks items
 * complete via hidden HTML markers; the user cannot toggle them.
 */

export const CHECKLIST_STORAGE_KEY = "th_checklist";
export const CHECKLIST_VERSION = 1 as const;

export type ChecklistKind = "note" | "tw" | "tq";

export interface ChecklistItem {
  /** Stable key: `${kind}:${resourceId}` */
  id: string;
  kind: ChecklistKind;
  /** Note id / TW path / TQ id — used in CHECK markers */
  resourceId: string;
  title: string;
  subtitle?: string;
  verse?: string;
  completed: boolean;
  completedAt?: number;
}

export interface PassageChecklist {
  reference: string;
  items: Record<string, ChecklistItem>;
  updatedAt: number;
}

export interface ChecklistStoreData {
  v: typeof CHECKLIST_VERSION;
  passages: Record<string, PassageChecklist>;
}

export interface ChecklistProgress {
  completed: number;
  total: number;
}

/** Normalize a free-text reference into a stable passage key. */
export function normalizePassageKey(reference: string): string {
  return reference.trim().replace(/\s+/g, " ").toUpperCase();
}

export function itemId(kind: ChecklistKind, resourceId: string): string {
  return `${kind}:${resourceId}`;
}

export function emptyChecklistStore(): ChecklistStoreData {
  return { v: CHECKLIST_VERSION, passages: {} };
}

export function parseChecklistStore(raw: unknown): ChecklistStoreData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== CHECKLIST_VERSION) return null;
  if (!obj.passages || typeof obj.passages !== "object") return null;
  const passages: Record<string, PassageChecklist> = {};
  for (const [key, value] of Object.entries(
    obj.passages as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object") continue;
    const p = value as Record<string, unknown>;
    if (
      typeof p.reference !== "string" ||
      !p.items ||
      typeof p.items !== "object"
    ) {
      continue;
    }
    const items: Record<string, ChecklistItem> = {};
    for (const [itemKey, itemVal] of Object.entries(
      p.items as Record<string, unknown>,
    )) {
      const parsed = parseChecklistItem(itemVal);
      if (parsed) items[itemKey] = parsed;
    }
    passages[key] = {
      reference: p.reference,
      items,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
    };
  }
  return { v: CHECKLIST_VERSION, passages };
}

function parseChecklistItem(raw: unknown): ChecklistItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.resourceId !== "string" ||
    typeof o.title !== "string"
  ) {
    return null;
  }
  const kind = o.kind;
  if (kind !== "note" && kind !== "tw" && kind !== "tq") return null;
  return {
    id: o.id,
    kind,
    resourceId: o.resourceId,
    title: o.title,
    subtitle: typeof o.subtitle === "string" ? o.subtitle : undefined,
    verse: typeof o.verse === "string" ? o.verse : undefined,
    completed: Boolean(o.completed),
    completedAt: typeof o.completedAt === "number" ? o.completedAt : undefined,
  };
}

export interface UpsertSeed {
  kind: ChecklistKind;
  resourceId: string;
  title: string;
  subtitle?: string;
  verse?: string;
}

/**
 * Upsert items for a passage. Preserves completed state for existing ids.
 * Does not remove items that are missing from the new seed list.
 */
export function upsertChecklistItems(
  store: ChecklistStoreData,
  reference: string,
  seeds: UpsertSeed[],
  now = Date.now(),
): ChecklistStoreData {
  const key = normalizePassageKey(reference);
  if (!key || seeds.length === 0) return store;

  const existing = store.passages[key];
  const items: Record<string, ChecklistItem> = { ...(existing?.items ?? {}) };

  let changed = !existing;
  for (const seed of seeds) {
    const resourceId = seed.resourceId.trim();
    if (!resourceId) continue;
    const id = itemId(seed.kind, resourceId);
    const prev = items[id];
    const nextItem: ChecklistItem = {
      id,
      kind: seed.kind,
      resourceId,
      title: seed.title.trim() || resourceId,
      subtitle: seed.subtitle?.trim() || undefined,
      verse: seed.verse?.trim() || undefined,
      completed: prev?.completed ?? false,
      completedAt: prev?.completedAt,
    };
    if (
      !prev ||
      prev.title !== nextItem.title ||
      prev.subtitle !== nextItem.subtitle ||
      prev.verse !== nextItem.verse ||
      prev.completed !== nextItem.completed
    ) {
      changed = true;
    }
    items[id] = nextItem;
  }

  if (!changed) return store;

  return {
    ...store,
    passages: {
      ...store.passages,
      [key]: {
        reference: existing?.reference ?? reference.trim(),
        items,
        updatedAt: now,
      },
    },
  };
}

/** Mark a single item complete. No-op if missing or already complete. */
export function completeChecklistItem(
  store: ChecklistStoreData,
  reference: string,
  kind: ChecklistKind,
  resourceId: string,
  now = Date.now(),
): ChecklistStoreData {
  const key = normalizePassageKey(reference);
  const passage = store.passages[key];
  if (!passage) return store;
  const id = itemId(kind, resourceId.trim());
  const item = passage.items[id];
  if (!item || item.completed) return store;

  return {
    ...store,
    passages: {
      ...store.passages,
      [key]: {
        ...passage,
        updatedAt: now,
        items: {
          ...passage.items,
          [id]: { ...item, completed: true, completedAt: now },
        },
      },
    },
  };
}

export interface ParsedCheckMarker {
  kind: ChecklistKind;
  resourceId: string;
  /** Item title from STUDY CONTEXT (TW term / TQ question) — used for text matching. */
  title?: string;
}

/**
 * Parse coach-emitted progress markers.
 * Formats: `<!-- CHECK:note:id -->`, `<!-- CHECK:tw:path -->`, `<!-- CHECK:tq:id -->`
 */
export function parseCheckMarkers(text: string): ParsedCheckMarker[] {
  if (!text) return [];
  const re = /<!--\s*CHECK:(note|tw|tq):([^\s>]+?)\s*-->/gi;
  const seen = new Set<string>();
  const out: ParsedCheckMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase() as ChecklistKind;
    const resourceId = m[2].trim();
    if (!resourceId) continue;
    const key = `${kind}:${resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, resourceId });
  }
  return out;
}

/** Apply all CHECK markers found in text to the store for a passage. */
export function applyCheckMarkers(
  store: ChecklistStoreData,
  reference: string,
  text: string,
  now = Date.now(),
): ChecklistStoreData {
  const markers = parseCheckMarkers(text);
  if (markers.length === 0) return store;
  let next = store;
  for (const marker of markers) {
    next = completeChecklistItem(
      next,
      reference,
      marker.kind,
      marker.resourceId,
      now,
    );
  }
  return next;
}

export function getPassageChecklist(
  store: ChecklistStoreData,
  reference: string,
): PassageChecklist | null {
  const key = normalizePassageKey(reference);
  return store.passages[key] ?? null;
}

export function checklistProgress(
  passage: PassageChecklist | null | undefined,
): ChecklistProgress {
  if (!passage) return { completed: 0, total: 0 };
  const items = Object.values(passage.items);
  return {
    completed: items.filter((i) => i.completed).length,
    total: items.length,
  };
}

export function listChecklistItems(
  passage: PassageChecklist | null | undefined,
): ChecklistItem[] {
  if (!passage) return [];
  const kindOrder: Record<ChecklistKind, number> = { note: 0, tw: 1, tq: 2 };
  return Object.values(passage.items).sort((a, b) => {
    const kd = kindOrder[a.kind] - kindOrder[b.kind];
    if (kd !== 0) return kd;
    const va = a.verse ?? "";
    const vb = b.verse ?? "";
    if (va !== vb) return va.localeCompare(vb, undefined, { numeric: true });
    return a.title.localeCompare(b.title);
  });
}

export function groupChecklistItems(items: ChecklistItem[]): {
  notes: ChecklistItem[];
  words: ChecklistItem[];
  questions: ChecklistItem[];
} {
  return {
    notes: items.filter((i) => i.kind === "note"),
    words: items.filter((i) => i.kind === "tw"),
    questions: items.filter((i) => i.kind === "tq"),
  };
}

/** Compact study-context block so the coach can prioritize unchecked items. */
export function formatChecklistStudyContext(
  passage: PassageChecklist | null | undefined,
): string {
  if (!passage) return "";
  const items = listChecklistItems(passage);
  if (items.length === 0) return "";
  const progress = checklistProgress(passage);
  const lines = [
    `Checking checklist for ${passage.reference}: ${progress.completed}/${progress.total} complete (read-only panel; coach marks via <!-- CHECK:kind:id -->).`,
  ];
  for (const item of items) {
    const mark = item.completed ? "[x]" : "[ ]";
    const verse = item.verse ? ` v.${item.verse}` : "";
    lines.push(
      `${mark} ${item.kind}:${item.resourceId}${verse} — ${truncate(item.title, 80)}`,
    );
  }
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/**
 * Title for a TN checklist item.
 * Prefers the alignment-resolved gateway-language quote (so users see e.g.
 * "chosen people of God" rather than raw Greek "ἐκλεκτῶν Θεοῦ"), then the
 * original quote (with `&` shown as `…`), then the note's first line.
 */
export function noteItemTitle(note: {
  id: string;
  quote?: string;
  gatewayQuote?: { original?: string; aligned?: string };
  noteText: string;
}): string {
  const aligned = note.gatewayQuote?.aligned?.trim();
  if (aligned) return aligned;
  const original = (note.gatewayQuote?.original ?? note.quote ?? "").trim();
  if (original)
    return original
      .split("&")
      .map((p) => p.trim())
      .filter(Boolean)
      .join(" … ");
  return firstLine(note.noteText) || note.id;
}

/** Build upsert seeds from translation_notes / translation_words / translation_questions shapes. */
export function seedsFromResourcePayloads(input: {
  notes?: Array<{
    id: string;
    quote?: string;
    gatewayQuote?: { original?: string; aligned?: string };
    noteText: string;
    verse?: string;
  }>;
  words?: Array<{
    id: string;
    term: string;
    wordPath?: string;
    verse?: string;
    definition?: string;
  }>;
  questions?: Array<{
    id: string;
    question: string;
    response?: string;
    verse?: string;
  }>;
}): UpsertSeed[] {
  const seeds: UpsertSeed[] = [];

  for (const n of input.notes ?? []) {
    if (!n.id) continue;
    seeds.push({
      kind: "note",
      resourceId: n.id,
      title: noteItemTitle(n).trim(),
      subtitle: firstLine(n.noteText),
      verse: n.verse,
    });
  }

  for (const w of input.words ?? []) {
    const resourceId = (w.wordPath || w.id || "").trim();
    if (!resourceId) continue;
    seeds.push({
      kind: "tw",
      resourceId,
      title: (w.term || resourceId).trim(),
      subtitle: w.definition ? firstLine(w.definition) : undefined,
      verse: w.verse,
    });
  }

  for (const q of input.questions ?? []) {
    if (!q.id) continue;
    seeds.push({
      kind: "tq",
      resourceId: q.id,
      title: firstLine(q.question) || q.id,
      subtitle: q.response ? firstLine(q.response) : undefined,
      verse: q.verse,
    });
  }

  return seeds;
}

function firstLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Instruction snippet for coach prompts — emit markers after validating an item. */
export const CHECKLIST_MARKER_INSTRUCTIONS = `## Checking checklist (resources panel)
The resources panel shows a **read-only Checking checklist** for this passage (Notes / Key terms / Questions). The user cannot tick items — only you mark them complete.
When a conversational check confirms the translator has thought through a specific item (source-side Q&A; never grade target text), append a hidden HTML comment on its own line:
- Translation note: \`<!-- CHECK:note:<note-id> -->\` — use the exact note id from the provided TN list
- Key term (TW): \`<!-- CHECK:tw:<word-path-or-id> -->\` — use the exact word path/id from the TW list
- Translation question: \`<!-- CHECK:tq:<question-id> -->\` — use the exact question id from the TQ list
Walk unchecked items one-by-one (or in small batches of 2–4). Only probe items still marked \`[ ]\` in STUDY CONTEXT — items marked \`[x]\` are ALREADY validated: NEVER re-ask or re-probe them, and acknowledge earlier progress instead of restarting from the first item. Stay in the source/conversation language. Do not ask them to paste receptor draft text.`;

/** Build a single hidden CHECK progress marker. */
export function buildCheckMarker(
  kind: ChecklistKind,
  resourceId: string,
): string {
  return `<!-- CHECK:${kind}:${resourceId.trim()} -->`;
}

// ---------------------------------------------------------------------------
// Click-to-check — user clicks a checklist item to start checking it
// ---------------------------------------------------------------------------

/**
 * Hidden marker embedded in the *user* chat message when a checklist item is
 * clicked in the resources panel. Distinct from `CHECK:` (coach completion).
 */
export function buildCheckItemMarker(
  kind: ChecklistKind,
  resourceId: string,
): string {
  return `<!-- CHECKITEM:${kind}:${resourceId.trim()} -->`;
}

/** Parse the first CHECKITEM marker from a user message (null when absent). */
export function parseCheckItemFromMessage(
  text: string | undefined | null,
): ParsedCheckMarker | null {
  if (!text) return null;
  const m = /<!--\s*CHECKITEM:(note|tw|tq):([^\s>]+?)\s*-->/i.exec(text);
  if (!m) return null;
  const resourceId = m[2].trim();
  if (!resourceId) return null;
  return { kind: m[1].toLowerCase() as ChecklistKind, resourceId };
}

/**
 * Build the chat user message for a checklist-item click:
 * visible source-language line + hidden CHECKITEM marker so the server routes
 * to the checking path scoped to exactly this item.
 * Clicking never completes the item — only coach CHECK markers do.
 */
export function formatCheckItemMessage(opts: {
  kind: ChecklistKind;
  resourceId: string;
  title: string;
  verse?: string;
  /** Source / conversation language for the visible phrasing. */
  language?: string;
  /** True when the item is already validated — phrased as a revisit. */
  completed?: boolean;
}): string {
  const es = (opts.language ?? "en").toLowerCase().startsWith("es");
  const versePrefix = opts.verse?.trim() ? `v.${opts.verse.trim()} ` : "";
  const label = `${versePrefix}${opts.title.trim()}`.trim();
  const lead = opts.completed
    ? es
      ? "Volvamos a revisar:"
      : "Let's revisit:"
    : es
      ? "Revisemos:"
      : "Let's check:";
  return `${lead} ${label}\n${buildCheckItemMarker(opts.kind, opts.resourceId)}`;
}

/**
 * Look up a checklist item's `[x]`/`[ ]` line in the STUDY CONTEXT block
 * (see formatChecklistStudyContext) to recover completion state and title.
 */
export function findChecklistLineInStudyContext(
  studyContext: string | undefined,
  kind: ChecklistKind,
  resourceId: string,
): { completed: boolean; title?: string; verse?: string } | null {
  if (!studyContext?.trim() || !resourceId.trim()) return null;
  const re = new RegExp(
    `^\\[([ x])\\]\\s*${kind}:${escapeRegExp(resourceId.trim())}(?:\\s+v\\.(\\S+))?(?:\\s*—\\s*(.+))?$`,
    "im",
  );
  const m = re.exec(studyContext);
  if (!m) return null;
  return {
    completed: m[1].toLowerCase() === "x",
    verse: m[2]?.trim() || undefined,
    title: m[3]?.replace(/…$/, "").trim() || undefined,
  };
}

export interface CheckItemFocusOptions {
  kind: ChecklistKind;
  resourceId: string;
  title?: string;
  verse?: string;
  /** True when STUDY CONTEXT marks this item `[x]` (already validated). */
  alreadyValidated?: boolean;
  /**
   * Verbatim body of the focused resource (TN note text, TW article excerpt,
   * or TQ question + expected answer). When present, injected into the focus
   * block so the coach cannot invent content beyond it.
   */
  resourceBody?: string;
  /** Optional original-language / quoted phrase from the TN. */
  resourceQuote?: string;
}

/** Minimal bundle shape for resolving a focused checklist item's body. */
export interface CheckItemBodySource {
  notes?: Array<{ id: string; text?: string; quote?: string }>;
  tw?: Array<{ path: string; article?: string; title?: string }>;
  tq?: Array<{ id: string; question?: string; response?: string }>;
}

/**
 * Look up the focused checklist item's body text from an assembled bundle.
 * Returns null when the item is missing or has no usable body yet.
 */
export function resolveCheckItemResourceBody(
  kind: ChecklistKind,
  resourceId: string,
  source: CheckItemBodySource | undefined,
): { body: string; quote?: string } | null {
  if (!source || !resourceId.trim()) return null;
  const id = resourceId.trim();

  if (kind === "note") {
    const note = source.notes?.find((n) => n.id === id);
    const text = note?.text?.trim();
    if (!text) return null;
    return {
      body: text,
      quote: note?.quote?.trim() || undefined,
    };
  }

  if (kind === "tw") {
    const tw = source.tw?.find(
      (t) => t.path === id || t.path.endsWith(`/${id}`) || id.endsWith(t.path),
    );
    const article = tw?.article?.trim();
    if (!article) return null;
    // Cap so a single focus block does not dominate the prompt.
    const capped =
      article.length > 1500 ? `${article.slice(0, 1500).trimEnd()}…` : article;
    return { body: capped };
  }

  const tq = source.tq?.find((q) => q.id === id);
  if (!tq?.question?.trim()) return null;
  const answer = tq.response?.trim();
  const body = answer
    ? `Q: ${tq.question.trim()}\nExpected answer: ${answer}`
    : `Q: ${tq.question.trim()}`;
  return { body };
}

/**
 * Per-item coach focus block injected into the checking system prompt when the
 * user clicked a specific checklist item. Overrides the general checklist walk
 * for this turn and prescribes meaning-based / semantic-range probing.
 */
export function checkItemFocusInstructions(
  opts: CheckItemFocusOptions,
): string {
  const id = `${opts.kind}:${opts.resourceId}`;
  const kindLabel =
    opts.kind === "note"
      ? "Translation Note (TN)"
      : opts.kind === "tw"
        ? "key term (TW)"
        : "Translation Question (TQ)";
  const label = opts.title
    ? ` ("${opts.title}"${opts.verse ? `, v.${opts.verse}` : ""})`
    : "";
  const grounding =
    opts.kind === "note"
      ? "this note's body below (what the note says about the phrase)"
      : opts.kind === "tw"
        ? "this term's TW article body below (its definition and senses)"
        : "this question and its expected answer below";

  const revisitItemLabel = opts.title?.trim()
    ? `"${opts.title.trim()}"`
    : "this item";
  const revisitLine = opts.alreadyValidated
    ? `\nREVISIT — this item is ALREADY validated (\`[x]\` in STUDY CONTEXT): the translator already worked through it and their earlier answers validated it. This OVERRIDES the probe sequence below — do NOT re-interrogate from scratch and do NOT re-run the meaning/senses/misreading steps. Your ENTIRE reply this turn: (1) briefly acknowledge they already worked through ${revisitItemLabel} (e.g. "You already worked through this one — the word you chose conveys the source meaning."), then (2) ask if they want to revisit anything specific about it — exactly ONE question, then stop. Only probe the specific aspect they name on a later turn (still one question per turn). Do not restart the whole checklist and do not treat this as a new completion — never emit a new CHECK marker unless they rework the item and validate it again.`
    : "";

  const probeLabel = opts.title?.trim() || "this phrase";

  const body = opts.resourceBody?.trim();
  const quoteLine = opts.resourceQuote?.trim()
    ? `\nQuoted phrase: "${opts.resourceQuote.trim()}"`
    : "";
  const bodyBlock = body
    ? `\n\n### Focused resource body (authoritative — paraphrase this; do not invent beyond it)\n${body}${quoteLine}`
    : `\n\n### Focused resource body\n(Not available in this turn's fetched context — do NOT invent note/article content. Admit the gap and point the user to the panel item, or wait until the body is loaded.)`;

  return `## Single-item check focus (user clicked a checklist item)
The user clicked the checklist item \`${id}\`${label} — a ${kindLabel} — in the resources panel. This turn, check ONLY this item. This OVERRIDES the general checklist walk: do not probe other items until this one is resolved.${revisitLine}
${bodyBlock}

How to probe this item (meaning-based, source-side only):
- HARD RULE — exactly ONE question per turn. Never stack two or three questions in one reply. Stop writing immediately after your first question mark — anything after it will be discarded. The probe sequence unfolds ACROSS turns, one step at a time, each step driven by their previous answer: (1) meaning of the word they chose → (2) other senses that word carries → (3) what their readers could misunderstand → (4) whether a closer word exists.
- NEVER ask "How did you translate X?" — that invites them to paste target-language text you cannot read. Ask for the MEANING of what they used, in the source language: "What does the word you chose for '${probeLabel}' mean in your language?" They answer by describing the meaning in the source/conversation language, never by quoting their translation.
- Ground every question in ${grounding} — paraphrase what it says (e.g. if it addresses an abstract noun / idea you can't touch, stick to *that* guidance). Never invent content or substitute a generic linguistics lecture from training data.
- Probe SEMANTIC RANGE (a later turn, after they describe the meaning): ask whether their word has other meanings, and whether their readers could understand something different from the source sense. Example: if the source means "hit" and their word means both "kill" and "harm", surface that risk — "Does your word have other meanings, like killing instead of hitting?" Then, on the NEXT turn if needed: "Could your readers understand killing instead of hitting?"
- If their answers show the chosen word's meaning drifts from the source sense, suggest — as a QUESTION or option, never a mandate — looking for a word in their language closer to the source meaning: "Is there another word in your language that means only X, without also meaning Y?"
- NEVER ask to see, read, or grade their target-language text. Their answers about meaning are enough to consult on.
- Stay in the source/conversation language, plain everyday words.
- When their answers show they have thought this decision through, append the hidden marker \`<!-- CHECK:${id} -->\` on its own line.`;
}

/**
 * Build the per-item focus block for a turn: parses the CHECKITEM marker from
 * the user message and enriches it from STUDY CONTEXT (title, completed state)
 * and optionally the fetched resource body from the bundle.
 * Returns "" when the message is not a checklist-item click.
 */
export function buildCheckItemFocus(
  message: string,
  studyContext?: string,
  bodySource?: CheckItemBodySource,
): string {
  const marker = parseCheckItemFromMessage(message);
  if (!marker) return "";
  const line = findChecklistLineInStudyContext(
    studyContext,
    marker.kind,
    marker.resourceId,
  );
  const resolved = resolveCheckItemResourceBody(
    marker.kind,
    marker.resourceId,
    bodySource,
  );
  return checkItemFocusInstructions({
    kind: marker.kind,
    resourceId: marker.resourceId,
    title: line?.title,
    verse: line?.verse,
    alreadyValidated: line?.completed ?? false,
    resourceBody: resolved?.body,
    resourceQuote: resolved?.quote,
  });
}

/**
 * Parse `focusHint: note|tw|tq:<id> "title"` from a PANEL STATE block in
 * STUDY CONTEXT. Used when the user focused a panel item without a CHECKITEM click.
 */
export function parseFocusHintFromStudyContext(
  studyContext?: string,
): { kind: ChecklistKind; id: string; title?: string } | null {
  if (!studyContext?.trim()) return null;
  const m = /focusHint:\s*(note|tw|tq):([^\s"]+)(?:\s+"([^"]*)")?/i.exec(
    studyContext,
  );
  if (!m) return null;
  return {
    kind: m[1].toLowerCase() as ChecklistKind,
    id: m[2].trim(),
    title: m[3]?.trim() || undefined,
  };
}

/**
 * Soft focus block when PANEL STATE has a note/tw/tq focusHint but the turn
 * is not a CHECKITEM click. Injects the matching loaded body for grounding.
 */
export function buildPanelFocusResourceHint(
  studyContext: string | undefined,
  bodySource?: CheckItemBodySource,
): string {
  const hint = parseFocusHintFromStudyContext(studyContext);
  if (!hint) return "";
  const resolved = resolveCheckItemResourceBody(hint.kind, hint.id, bodySource);
  if (!resolved?.body) return "";
  const label = hint.title ? ` ("${hint.title}")` : "";
  const quoteLine = resolved.quote
    ? `\nQuoted phrase: "${resolved.quote}"`
    : "";
  return `## Panel focusHint — loaded resource body
PANEL STATE focusHint is \`${hint.kind}:${hint.id}\`${label}. Ground this turn in the following loaded body — paraphrase what it says; do not invent translation principles or linguistics lectures beyond it.${quoteLine}

### Focused resource body (authoritative)
${resolved.body}`;
}

/**
 * Move the focused checklist item to the front of its bundle list so budget
 * caps cannot drop the authoritative body for this turn.
 */
export function pinFocusedCheckItem<T extends CheckItemBodySource>(
  bundle: T,
  kind: ChecklistKind,
  resourceId: string,
): T {
  const id = resourceId.trim();
  if (!id) return bundle;

  if (kind === "note" && bundle.notes?.length) {
    const idx = bundle.notes.findIndex((n) => n.id === id);
    if (idx > 0) {
      const notes = [...bundle.notes];
      const [item] = notes.splice(idx, 1);
      notes.unshift(item);
      return { ...bundle, notes };
    }
  }

  if (kind === "tw" && bundle.tw?.length) {
    const idx = bundle.tw.findIndex(
      (t) => t.path === id || t.path.endsWith(`/${id}`) || id.endsWith(t.path),
    );
    if (idx > 0) {
      const tw = [...bundle.tw];
      const [item] = tw.splice(idx, 1);
      tw.unshift(item);
      return { ...bundle, tw };
    }
  }

  if (kind === "tq" && bundle.tq?.length) {
    const idx = bundle.tq.findIndex((q) => q.id === id);
    if (idx > 0) {
      const tq = [...bundle.tq];
      const [item] = tq.splice(idx, 1);
      tq.unshift(item);
      return { ...bundle, tq };
    }
  }

  return bundle;
}

/** Parse unchecked `[ ] kind:id [v.N] — title` lines from STUDY CONTEXT checklist block. */
export function parseUncheckedFromStudyContext(
  studyContext: string | undefined,
): ParsedCheckMarker[] {
  if (!studyContext?.trim()) return [];
  const re = /^\[ \]\s*(note|tw|tq):(\S+)(?:\s+v\.\S+)?(?:\s*—\s*(.+))?$/gim;
  const seen = new Set<string>();
  const out: ParsedCheckMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(studyContext)) !== null) {
    const kind = m[1].toLowerCase() as ChecklistKind;
    const resourceId = m[2].trim();
    if (!resourceId) continue;
    const key = `${kind}:${resourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = m[3]?.replace(/…$/, "").trim() || undefined;
    out.push(title ? { kind, resourceId, title } : { kind, resourceId });
  }
  return out;
}

/** Unicode-aware whole-word test (Spanish accents etc. count as word chars). */
function textHasTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < 3) return false;
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_-])${escapeRegExp(t)}(?=[^\\p{L}\\p{N}_-]|$)`,
    "iu",
  );
  return re.test(text);
}

/** Candidate match terms for a TW item: title parts + last path segment. */
function twMatchTerms(c: ParsedCheckMarker): string[] {
  const terms: string[] = [];
  if (c.title) {
    for (const part of c.title.split(/[,;/]|\s+y\s+|\s+and\s+/i)) {
      const t = part.trim();
      if (t.length >= 3) terms.push(t);
    }
  }
  const lastSegment = c.resourceId.split("/").pop()?.trim();
  if (lastSegment && lastSegment.length >= 3) terms.push(lastSegment);
  return [...new Set(terms)];
}

function normalizeForSubstring(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Return candidates that were discussed in `text` (prior coach probes and/or
 * the user's answer):
 * - any kind: exact resource id (word boundary; paths with `/` use substring)
 * - tw: the key term itself (STUDY CONTEXT title parts or word-path last segment)
 * - tq: the question text (STUDY CONTEXT title) quoted/paraphrased verbatim
 */
export function findChecklistIdsInText(
  text: string,
  candidates: ParsedCheckMarker[],
): ParsedCheckMarker[] {
  if (!text || candidates.length === 0) return [];
  const normText = normalizeForSubstring(text);
  const out: ParsedCheckMarker[] = [];
  for (const c of candidates) {
    const id = c.resourceId;
    if (!id) continue;

    // 1. Exact resource id / word path in text.
    if (id.includes("/")) {
      if (text.includes(id)) {
        out.push(c);
        continue;
      }
    } else if (
      new RegExp(
        `(?:^|[^A-Za-z0-9_-])${escapeRegExp(id)}(?=[^A-Za-z0-9_-]|$)`,
        "i",
      ).test(text)
    ) {
      out.push(c);
      continue;
    }

    // 2. TW key terms — the coach probes by term ("faith"), never by path.
    if (c.kind === "tw" && twMatchTerms(c).some((t) => textHasTerm(text, t))) {
      out.push(c);
      continue;
    }

    // 3. TQ question text — quoted verbatim (or near-verbatim) in the probe.
    if (
      c.kind === "tq" &&
      c.title &&
      c.title.trim().length >= 12 &&
      normText.includes(normalizeForSubstring(c.title))
    ) {
      out.push(c);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Append missing CHECK markers to a coach reply (deterministic; does not
 * duplicate markers already present in the text).
 */
export function appendCheckMarkersToResponse(
  response: string,
  markers: ParsedCheckMarker[],
): string {
  if (!markers.length) return response;
  const existing = new Set(
    parseCheckMarkers(response).map((m) => `${m.kind}:${m.resourceId}`),
  );
  const toAdd = markers.filter(
    (m) => !existing.has(`${m.kind}:${m.resourceId}`),
  );
  if (toAdd.length === 0) return response;
  const block = toAdd
    .map((m) => buildCheckMarker(m.kind, m.resourceId))
    .join("\n");
  const base = response.trimEnd();
  return base ? `${base}\n${block}` : block;
}

/**
 * True when the user reply looks like a check-session validation answer
 * (affirmative, difficulty note, or short substantive reply) rather than a
 * clear topic change or opt-out.
 */
export function looksLikeCheckingValidation(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.length > 400) return false;
  // Clarification / "I don't understand that note" — not validation yet.
  if (
    /^(no\s+entiendo|no\s+comprendo|i\s+don'?t\s+understand|what\s+does\s+that\s+mean|qu[eé]\s+significa)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  const isQuestion =
    /[¿?]/.test(trimmed) ||
    /^(qu[eé]|c[oó]mo|cu[aá]l|d[oó]nde|por\s+qu[eé]|why|what|how|when|where|which)\b/i.test(
      trimmed,
    );
  if (isQuestion && trimmed.length > 80) return false;
  return true;
}

/**
 * Deterministic validated-item selection for a checking turn.
 * Session-start (Pedir revisión / item click) emits no completions; later
 * user answers complete ids that were genuinely discussed and remain `[ ]`.
 *
 * Scoping rules (over-eager-ticking guard):
 * - When a CHECKITEM-scoped session is active (`focusedItem`), ONLY the
 *   focused item is eligible to tick from that exchange — related items
 *   require their own discussion turns. Once the focused item is `[x]`, the
 *   scope is resolved and the general rules apply again.
 * - Outside item scope, note/TQ items match the prior probe + the user's
 *   answer; TW items tick only when the term appears in the USER's answer —
 *   the coach merely naming a term in its probe is not validation.
 */
export function resolveValidatedCheckMarkers(opts: {
  userMessage: string;
  priorAssistantContent?: string;
  studyContext?: string;
  /** True for Pedir revisión / ready-for-check / first checking turn. */
  isSessionStart?: boolean;
  /** Active CHECKITEM scope (clicked checklist item), when any. */
  focusedItem?: ParsedCheckMarker | null;
}): ParsedCheckMarker[] {
  if (opts.isSessionStart) return [];
  if (!looksLikeCheckingValidation(opts.userMessage)) return [];
  const unchecked = parseUncheckedFromStudyContext(opts.studyContext);
  if (unchecked.length === 0) return [];
  // Match discussed items in the prior probe + the user's answer so TW terms
  // the user names ("I translated godliness as…") also tick.
  const discussedText = [opts.priorAssistantContent ?? "", opts.userMessage]
    .filter(Boolean)
    .join("\n");

  if (opts.focusedItem) {
    const focused = unchecked.find(
      (u) =>
        u.kind === opts.focusedItem!.kind &&
        u.resourceId === opts.focusedItem!.resourceId,
    );
    // Item-scoped session: only the focused item may tick from this exchange.
    if (focused) return findChecklistIdsInText(discussedText, [focused]);
    // Focused item already completed / unknown — scope resolved; fall through.
  }

  const nonTw = unchecked.filter((u) => u.kind !== "tw");
  const tw = unchecked.filter((u) => u.kind === "tw");
  return [
    ...findChecklistIdsInText(discussedText, nonTw),
    ...findChecklistIdsInText(opts.userMessage, tw),
  ];
}

/**
 * Resolve the active CHECKITEM scope for a checking turn: the current message
 * when it is itself a click, else the most recent clicked item in prior user
 * messages. A later general session (re)start — e.g. Pedir revisión, detected
 * via the injected predicate — ends the item scope.
 */
export function findFocusedCheckItem(
  currentMessage: string,
  history: Array<{ role: string; content: string }> | undefined,
  isSessionStartMessage?: (text: string) => boolean,
): ParsedCheckMarker | null {
  const own = parseCheckItemFromMessage(currentMessage);
  if (own) return own;
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "user") continue;
    const item = parseCheckItemFromMessage(msg.content);
    if (item) return item;
    if (isSessionStartMessage?.(msg.content)) return null;
  }
  return null;
}

/**
 * Parse the passage reference from the checklist STUDY CONTEXT header line
 * ("Checking checklist for TIT 1:1-4: 1/3 complete …"). Used to bind the
 * passage on the FIRST checklist-item click, before any sticky CHECKING
 * footer exists in history.
 */
export function extractChecklistReference(
  studyContext: string | undefined,
): string | null {
  if (!studyContext?.trim()) return null;
  const m = /^Checking checklist for\s+(.+?):\s*\d+\/\d+\s+complete/im.exec(
    studyContext,
  );
  return m?.[1]?.trim() || null;
}
