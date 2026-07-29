/**
 * PanelState — compact snapshot of the resources side panel for coach awareness.
 *
 * Sent by the client each chat turn; formatted into a stable textual block that
 * the harness injects alongside STUDY CONTEXT. Never includes Mi traducción
 * draft bodies (draft privacy).
 */

/** Tabs the resources side panel can show. */
export type PanelTab =
  | "context"
  | "scripture"
  | "notes"
  | "words"
  | "quiz"
  | "article"
  | "checklist"
  | "questions"
  | "challenges";

export type PanelFocusKind =
  | "note"
  | "tw"
  | "tq"
  | "verse"
  | "quiz"
  | "article"
  | "checklist";

export interface PanelItemRef {
  id: string;
  title?: string;
}

export interface PanelQuizState {
  /** inactive = no quiz loaded; active = awaiting answers; graded = results shown */
  status: "inactive" | "active" | "graded";
  answered?: number;
  total?: number;
  correct?: number;
  passed?: boolean;
}

export interface PanelChecklistState {
  completed: number;
  total: number;
  /** Short titles of unchecked items (token-budgeted). */
  pendingTitles?: string[];
}

export interface PanelFocusHint {
  kind: PanelFocusKind;
  id: string;
  title?: string;
}

/**
 * Structured panel snapshot. Keep fields optional so partial client updates
 * remain valid; `formatPanelStateForPrompt` omits empty sections.
 */
export interface PanelState {
  open: boolean;
  tab: PanelTab | null;
  reference?: string;
  scriptureLoaded?: boolean;
  contextNotes?: { count: number; items?: PanelItemRef[] };
  translationNotes?: { count: number; items?: PanelItemRef[] };
  keyTerms?: { count: number; items?: PanelItemRef[] };
  questions?: { count: number };
  challenges?: { count: number };
  article?: { path: string; title?: string } | null;
  quiz?: PanelQuizState;
  checklist?: PanelChecklistState;
  focusHint?: PanelFocusHint | null;
}

const PANEL_TABS = new Set<string>([
  "context",
  "scripture",
  "notes",
  "words",
  "quiz",
  "article",
  "checklist",
  "questions",
  "challenges",
]);

const FOCUS_KINDS = new Set<string>([
  "note",
  "tw",
  "tq",
  "verse",
  "quiz",
  "article",
  "checklist",
]);

/** Max item titles listed under a count line (token budget). */
const MAX_ITEM_TITLES = 4;
/** Max pending checklist titles. */
const MAX_PENDING = 5;

function asCountBag(
  raw: unknown,
): { count: number; items?: PanelItemRef[] } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const count = typeof obj.count === "number" && obj.count >= 0 ? obj.count : 0;
  if (count === 0 && !Array.isArray(obj.items)) return { count: 0 };
  const items = Array.isArray(obj.items)
    ? obj.items
        .filter(
          (it): it is Record<string, unknown> => !!it && typeof it === "object",
        )
        .map((it) => ({
          id: String(it.id ?? ""),
          ...(typeof it.title === "string" && it.title
            ? { title: it.title.slice(0, 80) }
            : {}),
        }))
        .filter((it) => it.id)
        .slice(0, MAX_ITEM_TITLES)
    : undefined;
  return { count, ...(items && items.length ? { items } : {}) };
}

/**
 * Validate / coerce an unknown client payload into PanelState.
 * Returns null when the payload is missing or not an object.
 */
export function parsePanelState(raw: unknown): PanelState | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const tab =
    typeof obj.tab === "string" && PANEL_TABS.has(obj.tab)
      ? (obj.tab as PanelTab)
      : null;

  let focusHint: PanelFocusHint | null | undefined;
  if (obj.focusHint === null) {
    focusHint = null;
  } else if (obj.focusHint && typeof obj.focusHint === "object") {
    const fh = obj.focusHint as Record<string, unknown>;
    if (
      typeof fh.kind === "string" &&
      FOCUS_KINDS.has(fh.kind) &&
      typeof fh.id === "string"
    ) {
      focusHint = {
        kind: fh.kind as PanelFocusKind,
        id: fh.id.slice(0, 120),
        ...(typeof fh.title === "string" && fh.title
          ? { title: fh.title.slice(0, 80) }
          : {}),
      };
    }
  }

  let quiz: PanelQuizState | undefined;
  if (obj.quiz && typeof obj.quiz === "object") {
    const q = obj.quiz as Record<string, unknown>;
    const status =
      q.status === "active" || q.status === "graded" || q.status === "inactive"
        ? q.status
        : "inactive";
    quiz = {
      status,
      ...(typeof q.answered === "number" ? { answered: q.answered } : {}),
      ...(typeof q.total === "number" ? { total: q.total } : {}),
      ...(typeof q.correct === "number" ? { correct: q.correct } : {}),
      ...(typeof q.passed === "boolean" ? { passed: q.passed } : {}),
    };
  }

  let checklist: PanelChecklistState | undefined;
  if (obj.checklist && typeof obj.checklist === "object") {
    const c = obj.checklist as Record<string, unknown>;
    const completed = typeof c.completed === "number" ? c.completed : 0;
    const total = typeof c.total === "number" ? c.total : 0;
    const pendingTitles = Array.isArray(c.pendingTitles)
      ? c.pendingTitles
          .filter(
            (t): t is string => typeof t === "string" && t.trim().length > 0,
          )
          .map((t) => t.slice(0, 60))
          .slice(0, MAX_PENDING)
      : undefined;
    checklist = {
      completed,
      total,
      ...(pendingTitles && pendingTitles.length ? { pendingTitles } : {}),
    };
  }

  let article: PanelState["article"];
  if (obj.article === null) {
    article = null;
  } else if (obj.article && typeof obj.article === "object") {
    const a = obj.article as Record<string, unknown>;
    if (typeof a.path === "string" && a.path) {
      article = {
        path: a.path.slice(0, 160),
        ...(typeof a.title === "string" && a.title
          ? { title: a.title.slice(0, 80) }
          : {}),
      };
    }
  }

  return {
    open: obj.open === true,
    tab,
    ...(typeof obj.reference === "string" && obj.reference.trim()
      ? { reference: obj.reference.trim().slice(0, 40) }
      : {}),
    ...(typeof obj.scriptureLoaded === "boolean"
      ? { scriptureLoaded: obj.scriptureLoaded }
      : {}),
    ...(asCountBag(obj.contextNotes)
      ? { contextNotes: asCountBag(obj.contextNotes) }
      : {}),
    ...(asCountBag(obj.translationNotes)
      ? { translationNotes: asCountBag(obj.translationNotes) }
      : {}),
    ...(asCountBag(obj.keyTerms) ? { keyTerms: asCountBag(obj.keyTerms) } : {}),
    ...(asCountBag(obj.questions)
      ? { questions: { count: asCountBag(obj.questions)!.count } }
      : {}),
    ...(asCountBag(obj.challenges)
      ? { challenges: { count: asCountBag(obj.challenges)!.count } }
      : {}),
    ...(article !== undefined ? { article } : {}),
    ...(quiz ? { quiz } : {}),
    ...(checklist ? { checklist } : {}),
    ...(focusHint !== undefined ? { focusHint } : {}),
  };
}

function formatItems(items?: PanelItemRef[]): string {
  if (!items?.length) return "";
  const parts = items.map((it) =>
    it.title ? `${it.id} "${it.title}"` : it.id,
  );
  return ` (${parts.join("; ")})`;
}

function formatQuizLine(quiz: PanelQuizState): string {
  if (quiz.status === "inactive") return "quiz: inactive";
  if (quiz.status === "active") {
    const answered = quiz.answered ?? 0;
    const total = quiz.total ?? 0;
    return `quiz: active ${answered}/${total} answered`;
  }
  const correct = quiz.correct ?? 0;
  const total = quiz.total ?? 0;
  const pass =
    typeof quiz.passed === "boolean"
      ? quiz.passed
        ? " passed"
        : " not-passed"
      : "";
  return `quiz: graded ${correct}/${total}${pass}`;
}

/**
 * Compact, stable textual block for coach prompts.
 * Empty / zero counts are still listed so the model knows what is absent.
 */
export function formatPanelStateForPrompt(state: PanelState): string {
  const lines: string[] = ["PANEL STATE:"];
  lines.push(`open: ${state.open ? "true" : "false"}`);
  lines.push(`tab: ${state.tab ?? "none"}`);
  if (state.reference) lines.push(`reference: ${state.reference}`);
  if (state.scriptureLoaded) lines.push("scripture: loaded");

  const ctx = state.contextNotes;
  if (ctx) {
    lines.push(`contextNotes: ${ctx.count}${formatItems(ctx.items)}`);
  }
  const tn = state.translationNotes;
  if (tn) {
    lines.push(`translationNotes: ${tn.count}${formatItems(tn.items)}`);
  }
  const tw = state.keyTerms;
  if (tw) {
    lines.push(`keyTerms: ${tw.count}${formatItems(tw.items)}`);
  }
  if (state.questions) lines.push(`questions: ${state.questions.count}`);
  if (state.challenges) lines.push(`challenges: ${state.challenges.count}`);
  if (state.article) {
    lines.push(
      `article: ${state.article.path}${
        state.article.title ? ` "${state.article.title}"` : ""
      }`,
    );
  } else if (state.article === null) {
    lines.push("article: none");
  }
  if (state.quiz) lines.push(formatQuizLine(state.quiz));
  if (state.checklist) {
    const pending =
      state.checklist.pendingTitles && state.checklist.pendingTitles.length
        ? ` pending: ${state.checklist.pendingTitles.join("; ")}`
        : "";
    lines.push(
      `checklist: ${state.checklist.completed}/${state.checklist.total} complete${pending}`,
    );
  }
  if (state.focusHint) {
    const t = state.focusHint.title ? ` "${state.focusHint.title}"` : "";
    lines.push(`focusHint: ${state.focusHint.kind}:${state.focusHint.id}${t}`);
  } else {
    lines.push("focusHint: none");
  }
  lines.push(
    "Draft workspace (Mi traducción) text is private — never invent draft wording.",
  );
  return lines.join("\n");
}

/**
 * Merge a formatted PANEL STATE block into an existing study-context string.
 * Replaces a prior PANEL STATE block if present; otherwise appends.
 */
export function mergePanelStateIntoStudyContext(
  studyContext: string | undefined,
  panelBlock: string | undefined,
): string | undefined {
  const base = (studyContext ?? "").trim();
  const block = (panelBlock ?? "").trim();
  if (!block) return base || undefined;
  if (!base) return block;
  // Drop a previous PANEL STATE section (from client text snapshot) to avoid dupes.
  const without = base
    .replace(/(?:^|\n+)PANEL STATE:[\s\S]*?(?=\n\n[A-Z]|\n*$)/i, "")
    .replace(/(?:^|\n+)Resources panel showing:[\s\S]*?(?=\n\n|\n*$)/i, "")
    .trim();
  return without ? `${without}\n\n${block}` : block;
}

/**
 * Build a PanelState from already-extracted panel facts (client or tests).
 * Truncates item lists for token budget; never accepts draft text fields.
 */
export function buildPanelState(input: {
  open: boolean;
  tab: PanelTab | null;
  reference?: string | null;
  scriptureLoaded?: boolean;
  contextNotes?: Array<{ id: string; title?: string }>;
  translationNotes?: Array<{ id: string; title?: string }>;
  keyTerms?: Array<{ id: string; term?: string }>;
  questionsCount?: number;
  challengesCount?: number;
  article?: { path: string; title?: string } | null;
  quiz?: PanelQuizState | null;
  checklist?: {
    completed: number;
    total: number;
    pendingTitles?: string[];
  } | null;
  focusHint?: PanelFocusHint | null;
}): PanelState {
  const mapItems = (
    items: Array<{ id: string; title?: string }> | undefined,
  ): { count: number; items?: PanelItemRef[] } | undefined => {
    if (!items) return undefined;
    const refs = items
      .filter((it) => it.id)
      .slice(0, MAX_ITEM_TITLES)
      .map((it) => ({
        id: it.id,
        ...(it.title ? { title: it.title.slice(0, 80) } : {}),
      }));
    return {
      count: items.length,
      ...(refs.length ? { items: refs } : {}),
    };
  };

  const keyTermItems = input.keyTerms
    ?.filter((w) => w.id)
    .slice(0, MAX_ITEM_TITLES)
    .map((w) => ({
      id: w.id,
      ...(w.term ? { title: w.term.slice(0, 80) } : {}),
    }));

  return {
    open: input.open === true,
    tab: input.tab,
    ...(input.reference?.trim()
      ? { reference: input.reference.trim().slice(0, 40) }
      : {}),
    ...(typeof input.scriptureLoaded === "boolean"
      ? { scriptureLoaded: input.scriptureLoaded }
      : {}),
    ...(input.contextNotes
      ? { contextNotes: mapItems(input.contextNotes) }
      : {}),
    ...(input.translationNotes
      ? { translationNotes: mapItems(input.translationNotes) }
      : {}),
    ...(input.keyTerms
      ? {
          keyTerms: {
            count: input.keyTerms.length,
            ...(keyTermItems && keyTermItems.length
              ? { items: keyTermItems }
              : {}),
          },
        }
      : {}),
    ...(typeof input.questionsCount === "number"
      ? { questions: { count: input.questionsCount } }
      : {}),
    ...(typeof input.challengesCount === "number"
      ? { challenges: { count: input.challengesCount } }
      : {}),
    ...(input.article !== undefined ? { article: input.article } : {}),
    ...(input.quiz
      ? { quiz: input.quiz }
      : input.quiz === null
        ? { quiz: { status: "inactive" as const } }
        : {}),
    ...(input.checklist
      ? {
          checklist: {
            completed: input.checklist.completed,
            total: input.checklist.total,
            ...(input.checklist.pendingTitles?.length
              ? {
                  pendingTitles: input.checklist.pendingTitles
                    .slice(0, MAX_PENDING)
                    .map((t) => t.slice(0, 60)),
                }
              : {}),
          },
        }
      : {}),
    ...(input.focusHint !== undefined ? { focusHint: input.focusHint } : {}),
  };
}

/** Prompt guidance when PANEL STATE is present. */
export const PANEL_STATE_PROMPT_GUIDANCE = `## Resources panel awareness
Each turn includes a PANEL STATE block describing what is open on the user's screen (tab, counts, quiz/checklist progress, optional focusHint).
- Refer accurately to loaded panel content ("the context note in the panel…", "the key term on the Terms tab…").
- Ask the user to look at a specific tab or item when helpful.
- Do NOT invent notes, terms, quiz questions, or checklist items that are absent from PANEL STATE / STUDY CONTEXT.
- When focusHint names a note/term, ground coaching in that item's loaded body from the turn context — paraphrase what it says; do not invent translation principles (e.g. abstract-noun lectures) from training data.
- If loaded resources do not cover the question: admit the gap and offer to open/fetch the relevant panel item.
- You cannot see Mi traducción draft text — never claim to have read their wording.
- To steer the panel, append a hidden marker at the end of your reply (never visible prose):
  \`<!-- PANEL:open -->\`, \`<!-- PANEL:focus_tab:context|notes|words|quiz|article|checklist|questions|challenges -->\`,
  \`<!-- PANEL:highlight:note|tw|verse:<id> -->\`, \`<!-- PANEL:scroll_to:note|tw|verse:<id> -->\`.
  Prefer one marker when needed; the harness also opens/focuses tabs when it loads resources.`;
