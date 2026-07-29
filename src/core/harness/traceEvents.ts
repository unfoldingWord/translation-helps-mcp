/**
 * Trace event types for the /debug pipeline X-ray.
 * These are only emitted when debug:true is sent with the chat request.
 *
 * Defined here in src/core to avoid import cycles
 * (web/ can import from src/core, but src/core must never import from web/).
 */

import type { IntentResult } from "./intent.js";
import type { LLMMessage } from "../rag/providers/LLMProvider.js";

export type TraceEvent =
  | { type: "intent"; result: IntentResult; ms: number }
  | {
      type: "route";
      path:
        | "A"
        | "B"
        | "B-ch"
        | "C"
        | "D"
        | "G"
        | "G+"
        | "F"
        | "L"
        | "Q"
        | "QP"
        | "QR"
        | "QO"
        | "R";
      reason: string;
    }
  | {
      type: "llm_call";
      label: string;
      model: string;
      messages: LLMMessage[];
      response?: string;
      streaming: boolean;
      ms: number;
      tokens?: number;
      error?: string;
    }
  | {
      type: "tool_call";
      name: string;
      params: Record<string, unknown>;
      summary?: string;
      resultSnapshot?: unknown;
      ms: number;
      ok: boolean;
      error?: string;
    }
  | { type: "budget"; before: number; after: number; dropped: number }
  | {
      type: "plan";
      intent: string;
      initialFetches: string[];
      rcExpansion: string[];
    }
  | { type: "warm"; reference: string; language: string }
  | { type: "done_trace"; totalMs: number }
  | { type: "ui_emit"; componentType: string };
