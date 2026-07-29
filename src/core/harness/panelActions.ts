/**
 * PanelAction — typed imperative commands for the resources side panel.
 *
 * Preferred transport: SSE `event: panel_action` with JSON payload (parallel
 * to `ui` events). The harness also accepts tight HTML-comment trailers from
 * the LLM (`<!-- PANEL:… -->`) which are parsed into the same action shapes.
 */

import type { UIComponent } from "./uiComponents.js";
import type { PanelTab } from "./panelState.js";

export type PanelActionType =
  | "panel.open"
  | "panel.focus_tab"
  | "panel.highlight"
  | "panel.scroll_to";

export type PanelHighlightKind = "note" | "tw" | "verse" | "tq" | "article";

export type PanelAction =
  | { type: "panel.open" }
  | { type: "panel.focus_tab"; tab: PanelTab }
  | {
      type: "panel.highlight";
      kind: PanelHighlightKind;
      id: string;
      /** Optional display phrase (e.g. verse highlight). */
      phrase?: string;
    }
  | {
      type: "panel.scroll_to";
      kind: PanelHighlightKind;
      id: string;
    };

const FOCUSABLE_TABS = new Set<string>([
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

const HIGHLIGHT_KINDS = new Set<string>([
  "note",
  "tw",
  "verse",
  "tq",
  "article",
]);

/** Map a UI component type to the panel tab that should receive focus. */
export function tabForUiComponent(component: UIComponent): PanelTab | null {
  switch (component.type) {
    case "passage_context":
      return "context";
    case "scripture_text":
    case "scripture_panel":
      return "scripture";
    case "translation_notes":
      return "notes";
    case "translation_words":
      return "words";
    case "context_quiz":
      return "quiz";
    case "academy_article":
    case "ta_article_preview":
      return "article";
    case "translation_questions":
      return "questions";
    case "challenge_cards":
    case "phrase_drill":
      return "challenges";
    default:
      return null;
  }
}

/**
 * Deterministic companion actions when a UI component is emitted.
 * Always opens the panel; focuses the matching tab (quiz only when active).
 */
export function panelActionsForUiComponent(
  component: UIComponent,
): PanelAction[] {
  const actions: PanelAction[] = [{ type: "panel.open" }];
  const tab = tabForUiComponent(component);

  if (component.type === "context_quiz") {
    // Active quizzes grab focus; graded results leave the current tab alone
    // unless nothing else is guiding (still open the panel).
    if (component.status === "active" && tab) {
      actions.push({ type: "panel.focus_tab", tab });
    }
    return actions;
  }

  // Scripture lives in the sticky header — open panel but don't steal tab focus
  // away from context/notes when those arrive in the same turn. Prefer context
  // when passage_context is the companion; for scripture-only, leave tab as-is.
  if (
    component.type === "scripture_text" ||
    component.type === "scripture_panel"
  ) {
    return actions;
  }

  if (tab) {
    actions.push({ type: "panel.focus_tab", tab });
  }
  return actions;
}

/** Narrow unknown JSON into a PanelAction (SSE payload). */
export function parsePanelAction(raw: unknown): PanelAction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (type === "panel.open") return { type: "panel.open" };
  if (type === "panel.focus_tab") {
    const tab = typeof obj.tab === "string" ? obj.tab : "";
    if (!FOCUSABLE_TABS.has(tab)) return null;
    return { type: "panel.focus_tab", tab: tab as PanelTab };
  }
  if (type === "panel.highlight" || type === "panel.scroll_to") {
    const kind = typeof obj.kind === "string" ? obj.kind : "";
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!HIGHLIGHT_KINDS.has(kind) || !id) return null;
    if (type === "panel.highlight") {
      return {
        type: "panel.highlight",
        kind: kind as PanelHighlightKind,
        id: id.slice(0, 160),
        ...(typeof obj.phrase === "string" && obj.phrase
          ? { phrase: obj.phrase.slice(0, 120) }
          : {}),
      };
    }
    return {
      type: "panel.scroll_to",
      kind: kind as PanelHighlightKind,
      id: id.slice(0, 160),
    };
  }
  return null;
}

/**
 * Build a hidden HTML-comment marker for an action (LLM trailer / tests).
 * Examples:
 *   <!-- PANEL:open -->
 *   <!-- PANEL:focus_tab:context -->
 *   <!-- PANEL:highlight:note:front-intro -->
 *   <!-- PANEL:scroll_to:tw:bible/kt/grace -->
 */
export function formatPanelActionMarker(action: PanelAction): string {
  switch (action.type) {
    case "panel.open":
      return "<!-- PANEL:open -->";
    case "panel.focus_tab":
      return `<!-- PANEL:focus_tab:${action.tab} -->`;
    case "panel.highlight":
      return action.phrase
        ? `<!-- PANEL:highlight:${action.kind}:${action.id}|${action.phrase} -->`
        : `<!-- PANEL:highlight:${action.kind}:${action.id} -->`;
    case "panel.scroll_to":
      return `<!-- PANEL:scroll_to:${action.kind}:${action.id} -->`;
  }
}

const PANEL_MARKER_RE = /<!--\s*PANEL:([^>]+?)\s*-->/gi;

function actionFromMarkerBody(body: string): PanelAction | null {
  const raw = body.trim();
  if (!raw) return null;
  if (/^open$/i.test(raw)) return { type: "panel.open" };

  const focus = /^focus_tab:([a-z_]+)$/i.exec(raw);
  if (focus && FOCUSABLE_TABS.has(focus[1].toLowerCase())) {
    return { type: "panel.focus_tab", tab: focus[1].toLowerCase() as PanelTab };
  }

  const highlight = /^highlight:([a-z]+):([^|>]+)(?:\|(.*))?$/i.exec(raw);
  if (highlight) {
    const kind = highlight[1].toLowerCase();
    const id = highlight[2].trim();
    const phrase = (highlight[3] ?? "").trim();
    if (HIGHLIGHT_KINDS.has(kind) && id) {
      return {
        type: "panel.highlight",
        kind: kind as PanelHighlightKind,
        id,
        ...(phrase ? { phrase } : {}),
      };
    }
  }

  const scroll = /^scroll_to:([a-z]+):(.+)$/i.exec(raw);
  if (scroll) {
    const kind = scroll[1].toLowerCase();
    const id = scroll[2].trim();
    if (HIGHLIGHT_KINDS.has(kind) && id) {
      return {
        type: "panel.scroll_to",
        kind: kind as PanelHighlightKind,
        id,
      };
    }
  }

  return null;
}

/**
 * Extract PANEL markers from assistant text into typed actions.
 * Returns cleaned text with those markers removed (other HTML comments kept).
 */
export function extractPanelActionsFromText(text: string): {
  actions: PanelAction[];
  cleaned: string;
} {
  if (!text) return { actions: [], cleaned: text };
  const actions: PanelAction[] = [];
  const cleaned = text.replace(PANEL_MARKER_RE, (full, body: string) => {
    const action = actionFromMarkerBody(body);
    if (!action) return full;
    actions.push(action);
    return "";
  });

  return {
    actions,
    cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trimEnd(),
  };
}

/**
 * Deduplicate actions while preserving order (last focus_tab wins per stream).
 * open is kept once at the front if any open is present.
 */
export function coalescePanelActions(actions: PanelAction[]): PanelAction[] {
  if (actions.length === 0) return [];
  let open = false;
  let focus: PanelAction | null = null;
  const rest: PanelAction[] = [];
  for (const a of actions) {
    if (a.type === "panel.open") {
      open = true;
      continue;
    }
    if (a.type === "panel.focus_tab") {
      focus = a;
      continue;
    }
    rest.push(a);
  }
  const out: PanelAction[] = [];
  if (open) out.push({ type: "panel.open" });
  if (focus) out.push(focus);
  out.push(...rest);
  return out;
}
