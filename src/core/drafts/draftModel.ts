/**
 * Translation draft model — segment keys, assemble/retrieve by book/chapter/range.
 * Browser persistence lives in the web draftStore; this module is pure and unit-tested.
 */

import {
  parseReferenceForTool,
  type ToolReference,
} from "@translation-helps/door43";
import { extractReferenceInfo, VALID_USFM_BOOKS } from "../harness/intent.js";

export const DRAFTS_STORAGE_KEY = "th_drafts";
export const DRAFTS_VERSION = 1 as const;

export interface DraftSegmentMeta {
  book: string;
  chapter: string;
  verseStart?: string;
  verseEnd?: string;
}

export interface DraftSegment extends DraftSegmentMeta {
  /** Stable key, e.g. "TIT:1:1-4" or "TIT:1:5" (verse / verse range). */
  key: string;
  /** Human-readable reference label. */
  reference: string;
  text: string;
  updatedAt: number;
}

/**
 * Draft editor / save eligibility: a verse or verse range is required.
 * Book-only (`TIT`) and whole-chapter (`TIT 1`) refs are not draftable.
 * A single verse (`TIT 1:5`) counts as a minimal section and is allowed.
 */
export function isDraftableMeta(
  meta: DraftSegmentMeta | null | undefined,
): boolean {
  if (!meta?.book || meta.chapter == null || meta.chapter === "") return false;
  if (!meta.verseStart) return false;
  const start = parseInt(meta.verseStart, 10);
  return Number.isInteger(start) && start > 0;
}

/** True when a free-text reference is a draftable section (verse or range). */
export function isDraftableRef(reference: string | null | undefined): boolean {
  if (!reference?.trim()) return false;
  return isDraftableMeta(segmentFromReference(reference));
}

/**
 * Assert a segment meta is draftable (has a verse / range).
 * Throws when the reference is book-only or whole-chapter.
 */
export function assertDraftableSegment(
  meta: DraftSegmentMeta,
): asserts meta is DraftSegmentMeta & { verseStart: string } {
  if (!isDraftableMeta(meta)) {
    throw new Error(
      `Draft segments require a verse or verse range (got ${formatSegmentReference(meta)})`,
    );
  }
}

export interface DraftStoreData {
  v: typeof DRAFTS_VERSION;
  segments: Record<string, DraftSegment>;
}

export type DraftRecallScope =
  | { kind: "book"; book: string }
  | { kind: "chapter"; book: string; chapter: string }
  | {
      kind: "range";
      book: string;
      chapter: string;
      verseStart: number;
      verseEnd: number;
    };

/** Build a stable segment key from tool-reference fields. */
export function segmentKeyFromParts(parts: DraftSegmentMeta): string {
  const book = parts.book.toUpperCase();
  const chapter = String(parts.chapter);
  if (!parts.verseStart) return `${book}:${chapter}`;
  const start = String(parts.verseStart);
  const end = parts.verseEnd ? String(parts.verseEnd) : start;
  if (start === end) return `${book}:${chapter}:${start}`;
  return `${book}:${chapter}:${start}-${end}`;
}

/** Display label for a segment (USFM-style). */
export function formatSegmentReference(parts: DraftSegmentMeta): string {
  const book = parts.book.toUpperCase();
  const chapter = String(parts.chapter);
  if (!parts.verseStart) return `${book} ${chapter}`;
  const start = String(parts.verseStart);
  const end = parts.verseEnd ? String(parts.verseEnd) : start;
  if (start === end) return `${book} ${chapter}:${start}`;
  return `${book} ${chapter}:${start}-${end}`;
}

/**
 * Normalize a free-text reference into a draft segment key + meta.
 * Returns null when the reference has no chapter (book-only unsupported for segments).
 */
export function segmentFromReference(reference: string):
  | (DraftSegmentMeta & {
      key: string;
      reference: string;
    })
  | null {
  const parsed = parseReferenceForTool(reference);
  if (!parsed?.book || !parsed.chapter) return null;
  const meta: DraftSegmentMeta = {
    book: parsed.book.toUpperCase(),
    chapter: parsed.chapter,
    verseStart: parsed.verseStart,
    verseEnd:
      parsed.verseStart &&
      parsed.verseEnd &&
      parsed.verseEnd !== parsed.verseStart
        ? parsed.verseEnd
        : undefined,
  };
  const key = segmentKeyFromParts(meta);
  return {
    ...meta,
    key,
    reference: formatSegmentReference(meta),
  };
}

function verseBounds(
  seg: DraftSegmentMeta,
): { start: number; end: number } | null {
  if (!seg.verseStart) return null; // whole chapter
  const start = parseInt(seg.verseStart, 10);
  const end = seg.verseEnd ? parseInt(seg.verseEnd, 10) : start;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end: Math.max(start, end) };
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Convert a ToolReference / free string into a recall scope. */
export function scopeFromReference(reference: string): DraftRecallScope | null {
  const parsed = parseReferenceForTool(reference);
  if (!parsed?.book) return null;
  const book = parsed.book.toUpperCase();
  // Reject parser false-positives ("Ya 1" → YA, "voy 1" → VOY).
  if (!VALID_USFM_BOOKS.has(book)) return null;
  if (!parsed.chapter) return { kind: "book", book };
  if (!parsed.verseStart) {
    return { kind: "chapter", book, chapter: parsed.chapter };
  }
  const start = parseInt(parsed.verseStart, 10);
  const end = parsed.verseEnd ? parseInt(parsed.verseEnd, 10) : start;
  if (Number.isNaN(start))
    return { kind: "chapter", book, chapter: parsed.chapter };
  return {
    kind: "range",
    book,
    chapter: parsed.chapter,
    verseStart: start,
    verseEnd: Number.isNaN(end) ? start : Math.max(start, end),
  };
}

/** Book-only references (e.g. "Titus") — parseReferenceForTool returns null; handle via parseReference. */
export function scopeFromReferenceLoose(
  reference: string,
): DraftRecallScope | null {
  const tight = scopeFromReference(reference);
  if (tight) return tight;
  // Book-only: try USFM via a synthetic chapter parse after stripping trailing words
  const trimmed = reference.trim();
  const bookOnly = parseReferenceForTool(`${trimmed} 1`);
  const book = bookOnly?.book?.toUpperCase();
  if (
    book &&
    VALID_USFM_BOOKS.has(book) &&
    /^\S+$/.test(trimmed.split(/\s+/)[0] ?? "")
  ) {
    // If original had no digits, treat as whole book
    if (!/\d/.test(trimmed)) {
      return { kind: "book", book };
    }
  }
  return null;
}

/**
 * True when `parent` covers the full verse range of `child`
 * (same book + chapter; whole-chapter parents cover any range in the chapter).
 */
export function segmentContainsMeta(
  parent: DraftSegmentMeta,
  child: DraftSegmentMeta,
): boolean {
  if (parent.book.toUpperCase() !== child.book.toUpperCase()) return false;
  if (String(parent.chapter) !== String(child.chapter)) return false;
  const parentBounds = verseBounds(parent);
  if (!parentBounds) return true; // whole chapter
  const childBounds = verseBounds(child);
  if (!childBounds) return false; // child is whole chapter, parent is a range
  return (
    parentBounds.start <= childBounds.start &&
    childBounds.end <= parentBounds.end
  );
}

export type DraftBindingDecision =
  /** Same segment key — refresh the reference label only. */
  | { action: "same" }
  /** New ref is inside the active segment's range — keep the current editor scope. */
  | { action: "keep" }
  /** Switch the editor to this segment (may be a saved parent-range draft). */
  | {
      action: "bind";
      key: string;
      reference: string;
    }
  /**
   * Study ref is book-only or whole-chapter — clear the editor binding.
   * Outline of existing section drafts stays available in the UI.
   */
  | { action: "clear" }
  /** Reference is not segmentable — leave the binding untouched. */
  | { action: "none" };

/**
 * Decide how the Mi traducción editor should react to a study-reference change.
 *
 * Verse drills inside the active draft's range ("what does X mean in verse 1"
 * while drafting 1:1-4) must NOT blank the editor: keep the parent scope.
 * When re-scoping does happen and the new segment is empty but a saved draft
 * covers it, bind to that parent draft instead of an empty editor.
 *
 * Book-only and whole-chapter study refs clear the editor — drafts are
 * section/verse-range only.
 */
export function resolveDraftBinding(opts: {
  reference: string;
  activeKey: string | null;
  activeReference: string | null;
  segments: Record<string, DraftSegment>;
}): DraftBindingDecision {
  const seg = segmentFromReference(opts.reference);
  if (!seg) {
    // Book-only: segmentFromReference returns null; still clear the editor.
    const loose = scopeFromReferenceLoose(opts.reference);
    if (loose?.kind === "book") return { action: "clear" };
    return { action: "none" };
  }

  // Whole chapter (or any meta without a verse) — not draftable.
  if (!isDraftableMeta(seg)) return { action: "clear" };

  if (opts.activeKey === seg.key) return { action: "same" };

  // New reference contained in the active segment's range → keep drafting scope.
  if (opts.activeKey) {
    const active =
      (opts.activeReference
        ? segmentFromReference(opts.activeReference)
        : null) ?? metaFromSegmentKey(opts.activeKey);
    if (active && isDraftableMeta(active) && segmentContainsMeta(active, seg)) {
      return { action: "keep" };
    }
  }

  // Re-scope: prefer a saved draftable draft that covers the new range.
  const exact = opts.segments[seg.key];
  if (!exact?.text?.trim()) {
    const parent = listSegments(opts.segments).find(
      (s) =>
        s.key !== seg.key && isDraftableMeta(s) && segmentContainsMeta(s, seg),
    );
    if (parent) {
      return { action: "bind", key: parent.key, reference: parent.reference };
    }
  }

  return { action: "bind", key: seg.key, reference: opts.reference };
}

/** Parse a stored segment key ("TIT:1:1-4" / "TIT:1") back into meta. */
export function metaFromSegmentKey(key: string): DraftSegmentMeta | null {
  const parts = key.split(":");
  if (parts.length < 2) return null;
  const [book, chapter, verses] = parts;
  if (!book || !chapter) return null;
  if (!verses) return { book: book.toUpperCase(), chapter };
  const m = verses.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return { book: book.toUpperCase(), chapter };
  return {
    book: book.toUpperCase(),
    chapter,
    verseStart: m[1],
    verseEnd: m[2] && m[2] !== m[1] ? m[2] : undefined,
  };
}

export function segmentMatchesScope(
  seg: DraftSegmentMeta,
  scope: DraftRecallScope,
): boolean {
  const book = seg.book.toUpperCase();
  if (scope.kind === "book") return book === scope.book;
  if (book !== scope.book) return false;
  if (seg.chapter !== scope.chapter) return false;
  if (scope.kind === "chapter") return true;
  const bounds = verseBounds(seg);
  if (!bounds) return true; // whole-chapter draft covers any range in that chapter
  return rangesOverlap(
    bounds.start,
    bounds.end,
    scope.verseStart,
    scope.verseEnd,
  );
}

function sortKey(seg: DraftSegment): [string, number, number, number] {
  const book = seg.book.toUpperCase();
  const ch = parseInt(seg.chapter, 10) || 0;
  const bounds = verseBounds(seg);
  const start = bounds?.start ?? 0;
  const end = bounds?.end ?? 0;
  return [book, ch, start, end];
}

export function listSegments(
  segments: Record<string, DraftSegment>,
  filter?: { book?: string; chapter?: string },
): DraftSegment[] {
  let list = Object.values(segments).filter((s) => s.text.trim().length > 0);
  if (filter?.book) {
    const b = filter.book.toUpperCase();
    list = list.filter((s) => s.book.toUpperCase() === b);
  }
  if (filter?.chapter) {
    list = list.filter((s) => s.chapter === filter.chapter);
  }
  return list.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i]! < kb[i]!) return -1;
      if (ka[i]! > kb[i]!) return 1;
    }
    return a.key.localeCompare(b.key);
  });
}

/** Outline grouped by book → chapter for UI navigation. */
export function outlineSegments(segments: Record<string, DraftSegment>): Array<{
  book: string;
  chapters: Array<{ chapter: string; segments: DraftSegment[] }>;
}> {
  const byBook = new Map<string, Map<string, DraftSegment[]>>();
  for (const seg of listSegments(segments)) {
    const book = seg.book.toUpperCase();
    if (!byBook.has(book)) byBook.set(book, new Map());
    const chMap = byBook.get(book)!;
    if (!chMap.has(seg.chapter)) chMap.set(seg.chapter, []);
    chMap.get(seg.chapter)!.push(seg);
  }
  return [...byBook.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([book, chMap]) => ({
      book,
      chapters: [...chMap.entries()]
        .sort(([a], [b]) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))
        .map(([chapter, segs]) => ({ chapter, segments: segs })),
    }));
}

export function assembleDrafts(
  segments: Record<string, DraftSegment>,
  scope: DraftRecallScope,
): DraftSegment[] {
  return listSegments(segments).filter((s) => segmentMatchesScope(s, scope));
}

export function formatAssembledDrafts(
  assembled: DraftSegment[],
  scopeLabel: string,
  emptyMessage?: string,
): string {
  if (assembled.length === 0) {
    return (
      emptyMessage ??
      `No hay borradores guardados para **${scopeLabel}**. Escribe en *Mi traducción* y se guardará automáticamente.`
    );
  }
  const parts = [
    `### Mi traducción — ${scopeLabel}`,
    "",
    ...assembled.flatMap((s) => [`**${s.reference}**`, "", s.text.trim(), ""]),
  ];
  return parts.join("\n").trimEnd();
}

export function emptyDraftStore(): DraftStoreData {
  return { v: DRAFTS_VERSION, segments: {} };
}

export function parseDraftStore(raw: unknown): DraftStoreData | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<DraftStoreData>;
  if (obj.v !== DRAFTS_VERSION) return null;
  if (!obj.segments || typeof obj.segments !== "object") return null;
  const segments: Record<string, DraftSegment> = {};
  for (const [, value] of Object.entries(obj.segments)) {
    if (!value || typeof value !== "object") continue;
    const s = value as Partial<DraftSegment>;
    if (typeof s.text !== "string") continue;
    if (typeof s.book !== "string" || typeof s.chapter !== "string") continue;
    const meta: DraftSegmentMeta = {
      book: s.book.toUpperCase(),
      chapter: String(s.chapter),
      verseStart: typeof s.verseStart === "string" ? s.verseStart : undefined,
      verseEnd: typeof s.verseEnd === "string" ? s.verseEnd : undefined,
    };
    const resolvedKey =
      typeof s.key === "string" && s.key ? s.key : segmentKeyFromParts(meta);
    segments[resolvedKey] = {
      key: resolvedKey,
      book: meta.book,
      chapter: meta.chapter,
      verseStart: meta.verseStart,
      verseEnd: meta.verseEnd,
      reference:
        typeof s.reference === "string" && s.reference
          ? s.reference
          : formatSegmentReference(meta),
      text: s.text,
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
    };
  }
  return { v: DRAFTS_VERSION, segments };
}

/**
 * Detect chat-facing draft recall intents (ES/EN).
 *
 * Only clear recall requests match — e.g. "muéstrame mi traducción de Tito 1",
 * "recupera TIT 1:1-4". Drafting talk ("voy a redactar", "Ya."), coach answers,
 * and bare "mi traducción" / "borrador" must NOT match.
 */
function normalizeRefDashes(s: string): string {
  return s.replace(/[–—]/g, "-");
}

export function detectDraftRecallIntent(message: string): {
  referenceHint: string | null;
  matched: boolean;
} {
  const text = message.trim();
  if (!text) return { matched: false, referenceHint: null };

  const hasShowVerb =
    /\b(muéstrame|muestrame|show\s+me|enséñame|ensename|tráeme|traeme|dame|let\s+me\s+see|pull\s+up)\b/i.test(
      text,
    );
  const hasRetrieveVerb = /\b(recupera(?:r)?|retrieve|recall)\b/i.test(text);
  const hasWhereIs = /\b(d[oó]nde\s+est[aá]|where\s+(?:is|are))\b/i.test(text);
  const hasDraftObject =
    /\b(mi\s+traducci[oó]n|my\s+translation|my\s+draft|mi\s+borrador)\b/i.test(
      text,
    ) ||
    (/\b(el\s+borrador|the\s+draft|borrador)\b/i.test(text) &&
      (hasShowVerb || hasRetrieveVerb || hasWhereIs));

  // Valid Bible ref in the message (chapter required via extractReferenceInfo).
  const extracted = extractReferenceInfo(normalizeRefDashes(text));

  // Clear recall: show/where + draft object, OR retrieve + (draft object | valid ref).
  // Bare "mi traducción" / "borrador" / drafting talk → not recall.
  const isRecall =
    ((hasShowVerb || hasWhereIs) && hasDraftObject) ||
    (hasRetrieveVerb && (hasDraftObject || extracted != null));

  if (!isRecall) return { matched: false, referenceHint: null };

  if (extracted) {
    return { matched: true, referenceHint: extracted.ref };
  }

  // Book-only after de/of/for/para: "muéstrame mi traducción de Tito"
  const bookOnly = text.match(
    /\b(?:de|of|for|para)\s+((?:\d\s+)?[A-Za-zÀ-ÿ.]{2,}(?:\s+[A-Za-zÀ-ÿ.]{2,})?)\s*[.!?¿?]*$/i,
  );
  if (bookOnly?.[1]) {
    const hint = bookOnly[1].trim().replace(/\.$/, "");
    if (scopeFromReferenceLoose(hint)) {
      return { matched: true, referenceHint: hint };
    }
  }

  // Explicit recall without a parseable passage → ask which one (caller may use workspace).
  return { matched: true, referenceHint: null };
}

// ---------------------------------------------------------------------------
// Draft-recall privacy — recall cards are rendered client-side only; the draft
// body must never travel to the server in later /api/chat history payloads.
// ---------------------------------------------------------------------------

/** Intent tag set on locally-rendered draft-recall assistant messages. */
export const DRAFT_RECALL_INTENT = "draft_recall";

/**
 * True when a chat message is a locally-rendered draft recall card.
 * Matches the intent tag, plus the recall markdown heading as a fallback for
 * transcripts restored from storage where message metadata may be partial.
 */
export function isDraftRecallMessage(msg: {
  role?: string;
  intent?: string;
  content?: string;
}): boolean {
  if (msg.role && msg.role !== "assistant") return false;
  if (msg.intent === DRAFT_RECALL_INTENT) return true;
  return (
    typeof msg.content === "string" &&
    /^###\s+Mi traducción\s+—/m.test(msg.content)
  );
}

/** Short placeholder sent to the server instead of the recalled draft body. */
export function redactedDraftRecallContent(reference?: string | null): string {
  const ref = reference?.trim();
  return `[Showed the user their saved draft${ref ? ` for ${ref}` : ""} locally — draft text stays on the device and is not shared.]`;
}

/**
 * Redact draft-recall content for outbound server history.
 * Non-recall messages pass through unchanged.
 */
export function redactDraftRecallForOutbound(msg: {
  role?: string;
  intent?: string;
  content?: string;
  reference?: string;
}): string {
  if (!isDraftRecallMessage(msg)) return msg.content ?? "";
  return redactedDraftRecallContent(msg.reference);
}

export function toolRefToMeta(ref: ToolReference): DraftSegmentMeta {
  return {
    book: ref.book.toUpperCase(),
    chapter: ref.chapter,
    verseStart: ref.verseStart,
    verseEnd:
      ref.verseEnd && ref.verseEnd !== ref.verseStart
        ? ref.verseEnd
        : undefined,
  };
}
