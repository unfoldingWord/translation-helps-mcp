/**
 * ContextHarness — the central orchestrator for the hybrid retrieval pipeline.
 *
 * Flow:
 *   1. Classify intent (heuristics, no LLM call for deterministic cases)
 *   2. Build resource plan (select minimal resource set)
 *   3. Optional RAG-locate step (fuzzy queries only)
 *   4. Parallel-fetch MCP tools
 *   5. RC-link expansion (TN → TA, TWL → TW)
 *   6. Budget context (cap + dedupe)
 *   7. Compose intent-specific prompt
 *   8. Generate with LLM
 *
 * For open_ended intent: delegates to the agentic tool-calling loop.
 */

import type { LLMProvider } from "../rag/providers/LLMProvider.js";
import {
  classifyIntent,
  resolvePhraseDrillIntent,
  extractChallengesFromHistory,
  type ConversationMessage,
  type IntentResult,
  firstBatchRef,
  nextBatchRef,
} from "./intent.js";
import { selectResources, type ToolCallSpec } from "./resourceSelector.js";
import { applyBudget, type EnrichedBundle } from "./budgeter.js";
import { extractTaPathsFromNotes } from "../resources/rcLinks.js";
import { SYSTEM_BASE, renderEnrichedBundle, intentSystemFragment } from "../rag/PromptFormatter.js";
import { parseReferenceForTool } from "../resources/referenceParser.js";
import { runOverviewPipeline } from "./PassageOverviewAgents.js";
import {
  runAnnotator,
  formatAnnotatedResponse,
  formatDrillSystem,
  type Challenge,
} from "./PassageAnnotator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal callTool interface — matches what skillChat.ts provides. */
export type CallToolFn = (
  tool: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/** Streaming emit callbacks (optional — harness buffers when absent). */
export interface HarnessEmit {
  /** Send a short progress/status line (not part of the final answer). */
  status(text: string): void;
  /** Send a token delta for the in-progress assistant message. */
  token(delta: string): void;
  /** Send a named sub-agent progress update (for the thinking panel in the UI). */
  thinking?(label: string, state: 'working' | 'done'): void;
}

export interface HarnessOptions {
  /** Language code — default "en". */
  language?: string;
  /** Max TA articles to expand per passage (rc-link expansion). */
  maxTaExpansion?: number;
  /** Max TW articles to expand per passage. */
  maxTwExpansion?: number;
  /**
   * Prior conversation turns. Used to detect batch-session continuations
   * ("next", "continue") and to extract the queued next-batch reference from
   * the programmatic footer appended by the harness.
   */
  conversationHistory?: ConversationMessage[];
  /**
   * Optional streaming callbacks. When present, the harness emits `status`
   * lines during fetch/expansion and uses `generateStream` for the final
   * LLM composition step (falling back to `generate` if unavailable).
   */
  emit?: HarnessEmit;
}

/** A single MCP tool invocation recorded during a harness run. */
export interface ToolCallTrace {
  tool: string;
  params: Record<string, unknown>;
  latencyMs: number;
  ok: boolean;
  error?: string;
  /** Lightweight summary derived from the result (e.g. "3 versions", "15 notes"). */
  summary?: string;
  /** Truncated MCP response snapshot for the Tools panel (max ~2 KB). */
  resultSnapshot?: unknown;
}

export interface HarnessResult {
  response: string;
  citations: Array<{ path: string; title?: string }>;
  intent: string;
  mode: "compose" | "rag" | "training-only";
  dataWarning?: string;
  reference?: string;
  /**
   * The reference for the next verse batch, when the response is part of a
   * progressive-disclosure session (passage_overview or batched passage_help).
   * Included so callers / UIs can display a "Next" button.
   */
  nextBatch?: string;
  /**
   * Structured translation challenges from an annotated_passage response.
   * Included so the UI can render clickable "Explore N →" buttons.
   */
  challenges?: Challenge[];
  /**
   * For phrase_drill responses: which challenge index (1-based) was just answered,
   * so the UI can offer a "Next challenge →" button.
   */
  drillIndex?: number;
  /**
   * Total number of challenges in the current annotated passage session,
   * so the UI knows when it's reached the last one.
   */
  totalChallenges?: number;
  /** Every MCP tool call made during this turn, in invocation order. */
  toolCalls?: ToolCallTrace[];
  /**
   * The effective language used to fetch resources, which may differ from the
   * requested language when a variant was resolved (e.g. "es" → "es-419").
   * Callers should emit `setLanguage` when this differs from the input.
   */
  effectiveLanguage?: string;
}

// ---------------------------------------------------------------------------
// ContextHarness
// ---------------------------------------------------------------------------

export class ContextHarness {
  private readonly llm: LLMProvider;
  private readonly callTool: CallToolFn;
  private traceLog: ToolCallTrace[] = [];
  /** Stored during run() so helpers (e.g. agenticFallback) can access history. */
  private conversationHistory: ConversationMessage[] = [];

  constructor(llm: LLMProvider, callTool: CallToolFn) {
    this.llm = llm;
    this.callTool = callTool;
  }

  async run(
    message: string,
    opts: HarnessOptions = {},
  ): Promise<HarnessResult> {
    this.traceLog = []; // reset per-turn
    this.conversationHistory = opts.conversationHistory ?? [];
    const language = opts.language ?? "en";

    // 1. Classify intent — pass history for continuation detection
    let intentResult = classifyIntent(message, opts.conversationHistory);

    // 1b. LLM-based phrase-drill disambiguation.
    //     The sync classifier handles unambiguous numeric picks ("3").
    //     For everything else, when challenges are active in history, ask the
    //     LLM to decide whether the user is selecting a specific challenge.
    //     This replaces the brittle regex/fuzzy match and correctly handles
    //     connector words ("So why is 'world' a metonymy?").
    if (intentResult.intent !== "phrase_drill" && opts.conversationHistory) {
      const activeChallenges = extractChallengesFromHistory(opts.conversationHistory);
      if (activeChallenges && activeChallenges.length > 0) {
        const resolved = await resolvePhraseDrillIntent(
          message,
          activeChallenges,
          opts.conversationHistory,
          this.llm,
        );
        if (resolved) {
          intentResult = {
            intent: "phrase_drill",
            challengeIndex: resolved.index,
            challengePhrase: resolved.phrase,
            confidence: "high",
          };
        }
      }
    }

    // 2. Build resource plan
    const plan = selectResources(intentResult, language);

    const isOverview = plan.intent === "passage_overview";
    // For passage_overview, sub-agents each own their full domain — no caps.
    // For all other intents, apply the configured (or default) limits.
    const maxTa = isOverview ? 20 : (opts.maxTaExpansion ?? 3);
    const maxTw = isOverview ? 15 : (opts.maxTwExpansion ?? 4);

    // 3a. Checklist step continuation — no resource fetches, just advance the session
    if (plan.intent === "checklist_step" && intentResult.nextStep !== undefined) {
      return this.handleChecklistStep(
        intentResult.nextStep,
        intentResult.totalSteps ?? intentResult.nextStep,
        opts.conversationHistory ?? [],
      );
    }

    // 3b. Phrase drill — user selected a challenge from an annotated passage
    if (plan.intent === "phrase_drill" && intentResult.challengeIndex !== undefined) {
      return this.handlePhraseDrill(
        intentResult.challengeIndex,
        intentResult.challengePhrase,
        language,
        opts.conversationHistory ?? [],
      );
    }

    // 3c. Open-ended → agentic loop (imported lazily to avoid circular dep)
    if (plan.intent === "open_ended") {
      return this.agenticFallback(message, language, intentResult);
    }

    // 4. Article-locate if needed (no explicit key available)
    if (plan.articleLocate) {
      const searchResult = await this.safeCallTool("search_articles", {
        query: plan.articleLocate.query,
        language,
        resourceTypes: plan.articleLocate.resourceType
          ? [plan.articleLocate.resourceType]
          : ["ta", "tw"],
        topK: 5,
      });
      const keys = extractArticleKeys(searchResult, plan.intent);
      for (const spec of keys) {
        plan.initialFetches.push(spec);
      }
    }

    if (plan.initialFetches.length === 0) {
      // Nothing to fetch — fall through to training-only
      return {
        response: await this.llm.generate([
          { role: "system", content: SYSTEM_BASE },
          { role: "user", content: message },
        ]),
        citations: [],
        intent: plan.intent,
        mode: "training-only",
        dataWarning:
          "No structured resources could be retrieved for this query. The response relies on model training knowledge.",
        toolCalls: [...this.traceLog],
      };
    }

    // 5. Parallel-fetch
    opts.emit?.status(`Fetching ${plan.initialFetches.length} resource(s)…`);
    const fetchResults = await this.parallelFetch(plan.initialFetches);

    // 6. Build initial EnrichedBundle from fetch results
    const bundle = assembleBundle(fetchResults, plan.initialFetches, language);

    // 7. RC-link expansion
    if (plan.rcExpansion.includes("tn_to_ta")) {
      opts.emit?.status("Expanding translation academy links…");
      const supportRefs = bundle.notes.map(
        (n) => (n as unknown as { supportReference?: string }).supportReference,
      );
      const taPaths = extractTaPathsFromNotes(supportRefs).slice(0, maxTa);
      const taResults = await this.parallelFetch(
        taPaths.map((p) => ({
          tool: "get_academy_article" as const,
          params: { path: p, language },
        })),
      );
      for (let i = 0; i < taPaths.length; i++) {
        const raw = taResults[i];
        const article = extractArticleText(raw);
        if (article) {
          bundle.ta.push({
            id: `ta-${i}`,
            title: taPaths[i].split("/").pop() ?? taPaths[i],
            path: taPaths[i],
            article,
          });
        }
      }
    }

    if (plan.rcExpansion.includes("twl_to_tw")) {
      opts.emit?.status("Expanding translation word links…");
      // bundle.tw entries from get_passage_index have clean paths (e.g. "bible/kt/grace"),
      // not rc:// URIs — use them directly with get_word_article.
      const twPaths = bundle.tw
        .map((t) => (t as unknown as { wordPath?: string }).wordPath ?? t.path)
        .filter((p) => Boolean(p) && !p.startsWith("rc://"))
        .slice(0, maxTw);

      const twResults = await this.parallelFetch(
        twPaths.map((p) => ({
          tool: "get_word_article" as const,
          params: { path: p, language },
        })),
      );
      for (let i = 0; i < twPaths.length; i++) {
        const raw = twResults[i];
        const article = extractArticleText(raw);
        if (article) {
          const existing = bundle.tw.find((t) => t.path === twPaths[i]);
          if (existing) {
            existing.article = article;
          }
        }
      }
    }

    // 8a. annotated_passage → annotator agent (short verse range)
    if (plan.intent === "annotated_passage" && intentResult.reference) {
      opts.emit?.status(`Annotating ${intentResult.reference}\u2026`);

      // Fire get_passage_context in parallel with the LLM annotator call.
      // By this point get_passage has already been called (cache is warm).
      const contextPromise = this.safeCallTool("get_passage_context", {
        reference: intentResult.reference,
        language,
      });

      const [annotated, contextRaw] = await Promise.all([
        runAnnotator(bundle, intentResult.reference, language, this.llm),
        contextPromise,
      ]);

      const passageContext = extractPassageContext(contextRaw);
      const responseText = formatAnnotatedResponse(annotated, intentResult.reference, language, passageContext);

      // Stream the formatted response word-by-word so the user sees progressive
      // output rather than waiting for the full annotated passage to appear at once.
      if (opts.emit?.token) {
        const words = responseText.split(/(\s+)/);
        for (const word of words) {
          opts.emit.token(word);
        }
      }

      // Embed structured challenge data as a hidden HTML comment for phrase_drill detection
      const challengeJson = JSON.stringify(annotated.challenges);
      const hidden = `\n<!-- CHALLENGES:${annotated.challenges.length} ${challengeJson} -->`;

      return {
        response: responseText + hidden,
        challenges: annotated.challenges,
        citations: [],
        intent: plan.intent,
        mode: "compose",
        dataWarning: bundle.dataWarning,
        reference: intentResult.reference,
        toolCalls: [...this.traceLog],
      };
    }

    // 8b. passage_overview → sub-agent pipeline (no budget caps; each agent owns its domain)
    if (isOverview && intentResult.reference) {
      const { response: overviewResponse, citations: overviewCitations } =
        await runOverviewPipeline(bundle, intentResult.reference, language, this.llm, opts.emit);

      // Count the total steps in the checklist so the footer can show Step 1/N.
      // The orchestrator always emits "☐ N." markers; count them.
      const stepCount = (overviewResponse.match(/☐ \d+\./g) ?? []).length || 5;

      // Ensure the response already contains the [Step 1/N] footer from the
      // orchestrator. If not (LLM didn't follow format exactly), append it.
      const hasFooter = /\[Step \d+\/\d+\]/i.test(overviewResponse);
      const response = hasFooter
        ? overviewResponse
        : overviewResponse + `\n\n---\n*[Step 1/${stepCount}] — Say **"next"** when ready to continue.*`;

      return {
        response,
        citations: overviewCitations,
        intent: plan.intent,
        mode: "compose",
        reference: intentResult.reference,
        toolCalls: [...this.traceLog],
      };
    }

    // 9. Apply budget caps (passage_help and all other intents)
    const budgeted = applyBudget(bundle);

    // 10. Compose prompt (intent-specific) and generate
    opts.emit?.status("Composing answer…");
    const systemPrompt = buildSystemPrompt(budgeted, intentResult);
    let response: string;
    if (opts.emit && this.llm.generateStream) {
      const chunks: string[] = [];
      for await (const delta of this.llm.generateStream([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ])) {
        opts.emit.token(delta);
        chunks.push(delta);
      }
      response = chunks.join("");
    } else {
      response = await this.llm.generate([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ]);
    }

    const citations = collectCitations(budgeted);
    const mode: HarnessResult["mode"] =
      bundle.metadata.cacheStatus !== "miss" || citations.length > 0
        ? "compose"
        : "training-only";

    // 11. Append batch-progress footer (deterministic — not generated by LLM)
    let nextBatch: string | undefined;
    if (plan.intent === "passage_help" && intentResult.reference) {
      const parsed = parseReferenceForTool(intentResult.reference);
      if (parsed?.verseEnd) {
        // Only add footer when we are working through a verse range (batch mode)
        const next = nextBatchRef(intentResult.reference);
        if (next) {
          nextBatch = next;
          response += `\n\n---\n*Batch: ${intentResult.reference} | Say "next" for ${next}*`;
        }
      }
    }

    return {
      response,
      citations,
      intent: plan.intent,
      mode,
      dataWarning: bundle.dataWarning,
      reference: intentResult.reference,
      nextBatch,
      toolCalls: [...this.traceLog],
      effectiveLanguage: bundle.metadata.effectiveLanguage,
    };
  }

  // -------------------------------------------------------------------------
  // Agentic fallback
  // -------------------------------------------------------------------------

  private async agenticFallback(
    message: string,
    language: string,
    intentResult: IntentResult,
  ): Promise<HarnessResult> {
    // Import agentic loop lazily
    const { runAgenticLoop } = await import("./agenticLoop.js");
    // Pass conversation history so the LLM can see the active passage/drill context
    // and call the right tools (e.g. get_academy_article for "what is personification?")
    const result = await runAgenticLoop(
      message,
      language,
      this.llm,
      this.callTool,
      this.conversationHistory as Array<{ role: "user" | "assistant" | "system"; content: string }>,
    );
    return {
      ...result,
      intent: intentResult.intent,
    };
  }

  // -------------------------------------------------------------------------
  // Checklist step presenter
  // -------------------------------------------------------------------------

  /**
   * Present the next step in a guided checklist session.
   *
   * No new resource fetches are needed — the full analysis lives in the
   * conversation history from the passage_overview turn. The LLM reads the
   * history and presents only the next unchecked item, concisely.
   */
  private async handleChecklistStep(
    nextStep: number,
    totalSteps: number,
    history: ConversationMessage[],
  ): Promise<HarnessResult> {
    const isLastStep = nextStep >= totalSteps;

    const systemPrompt = `You are a Bible translation coach leading a structured lesson.

The conversation history contains a checklist of ${totalSteps} steps and the full analysis.
Your job is to present **Step ${nextStep}** now.

Rules:
- Find the ☐ ${nextStep}. item in the checklist.
- Present it fully in **80–120 words** — direct, actionable, concrete.
- Update the checklist display: mark steps 1–${nextStep - 1} as ✅, show **☐ ${nextStep}.** as bold/active, leave ☐ ${nextStep + 1}${nextStep + 1 <= totalSteps ? "–" + totalSteps : ""} as is.
- End your response with ONE short question or engagement prompt for the translator.
- After that, add: ---
  ${isLastStep
      ? "*✅ All steps complete! Ask me anything about this passage.*"
      : `*[Step ${nextStep}/${totalSteps}] — Say **"next"** when ready to continue.*`
    }

Do NOT repeat the step content from earlier turns. Present only this step's material.
Keep it SHORT. Quality over quantity.`;

    const messages: ConversationMessage[] = [
      ...history,
      { role: "user", content: "next" },
    ];

    const response = await this.llm.generate([
      { role: "system", content: systemPrompt },
      ...messages,
    ]);

    return {
      response,
      citations: [],
      intent: "checklist_step",
      mode: "compose",
    };
  }

  // -------------------------------------------------------------------------
  // Phrase drill handler
  // -------------------------------------------------------------------------

  /**
   * Handle phrase_drill intent — the user picked a specific challenge from
   * the annotated passage. Fetches TW article and TA principle on demand,
   * then generates a focused 80-150 word explanation.
   */
  private async handlePhraseDrill(
    challengeIndex: number,
    challengePhrase: string | undefined,
    language: string,
    history: ConversationMessage[],
  ): Promise<HarnessResult> {
    // Read challenges from history.
    // Cast to Challenge since ChallengeEntry and Challenge are structurally equivalent
    // at runtime — the only difference is that ChallengeEntry.category is typed as string.
    const challenges = extractChallengesFromHistory(history) as Challenge[] | null;
    const challenge = challenges?.find((c) => c.index === challengeIndex);

    if (!challenge) {
      return {
        response: `I couldn't find challenge #${challengeIndex}. Please try again or type the phrase you want to explore.`,
        citations: [],
        intent: "phrase_drill",
        mode: "training-only",
      };
    }

    // Parallel-fetch TW article and TA principle on demand
    const fetches: Array<Promise<unknown>> = [];
    const fetchLabels: string[] = [];

    if (challenge.wordPath) {
      // Strip any rc:// prefix to get the clean path (e.g. "bible/kt/grace")
      const path = challenge.wordPath.startsWith("rc://")
        ? challenge.wordPath.replace(/^rc:\/\/[^/]+\/tw\/dict\//, "")
        : challenge.wordPath;
      fetches.push(this.safeCallTool("get_word_article", { path, language }));
      fetchLabels.push("tw");
    }
    if (challenge.supportReference && challenge.supportReference.includes("ta/man")) {
      const taPath = challenge.supportReference
        .replace(/^rc:\/\/\*\/ta\/man\//, "")
        .replace(/^rc:\/\/[^/]+\/ta\/man\//, "");
      fetches.push(this.safeCallTool("get_academy_article", { path: taPath, language }));
      fetchLabels.push("ta");
    }

    const fetchResults = await Promise.allSettled(fetches);

    // Collect article texts
    let twArticle = "";
    let taArticle = "";
    fetchResults.forEach((res, i) => {
      if (res.status !== "fulfilled" || !res.value) return;
      const text = extractArticleText(res.value);
      if (fetchLabels[i] === "tw") twArticle = text ?? "";
      else taArticle = text ?? "";
    });

    // Extract UST/GST verse text from the annotated passage that is already in
    // conversation history — so the drill can compare GLT phrase with simplified rendering.
    const ustVerseText = extractUstVerseFromHistory(history, challenge.verse);

    // Build a richly-grounded context block.  Order matters: exact resources first,
    // then derivative/expansion content, so the LLM cites them rather than inventing.
    const contextParts: string[] = [];

    // 1. The exact phrase under examination
    contextParts.push(
      `PHRASE: "${challenge.phrase}" — verse ${challenge.verse}\nCATEGORY: ${challenge.category}`,
    );

    // 2. Verbatim Translation Note (highest authority — cite this directly)
    if (challenge.rawNoteText) {
      const quoteLine = challenge.rawQuote ? `\nOriginal-language quote this note covers: "${challenge.rawQuote}"` : "";
      contextParts.push(`TRANSLATION NOTE (verbatim):\n${challenge.rawNoteText}${quoteLine}`);
    } else if (challenge.noteText) {
      contextParts.push(`TRANSLATION NOTE SUMMARY:\n${challenge.noteText}`);
    }

    // 3. Alternate Translation suggested by the note
    if (challenge.at) {
      contextParts.push(`ALTERNATE TRANSLATION suggested by the note: "${challenge.at}"`);
    }

    // 4. Simplified Text (UST/GST) rendering of the same verse — shows the meaning shift
    if (ustVerseText) {
      contextParts.push(`SIMPLIFIED TEXT (UST/GST) rendering of v.${challenge.verse}:\n${ustVerseText}`);
    }

    // 5. Translation Word definition article (key-term drills)
    if (twArticle) {
      contextParts.push(`TRANSLATION WORD DEFINITION:\n${twArticle.slice(0, 1200)}`);
    }

    // 6. Translation Academy principle article (strategy/figure-of-speech drills)
    if (taArticle) {
      contextParts.push(`TRANSLATION ACADEMY ARTICLE:\n${taArticle.slice(0, 1500)}`);
    }

    const systemPrompt = formatDrillSystem(challenge, language);
    const userMessage = contextParts.join("\n\n---\n\n");

    // Include the recent conversation so the LLM can see the annotated passage
    // (with GLT/UST texts) and continue the thread naturally.
    const recentHistory = history.slice(-6) as Array<{ role: "user" | "assistant" | "system"; content: string }>;

    const response = await this.llm.generate([
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: userMessage },
    ]);

    const citations: Array<{ path: string; title?: string }> = [];
    if (challenge.wordPath) citations.push({ path: challenge.wordPath, title: challenge.phrase });
    if (challenge.supportReference) citations.push({ path: challenge.supportReference });

    // Append a hidden marker so the next turn can detect the active phrase-drill
    // session even after the original CHALLENGES comment has scrolled beyond
    // the hasActivePassageSession look-back window.
    const drillMarker = `\n<!-- PHRASE_DRILL:${challengeIndex}/${challenges?.length ?? 0} -->`;

    return {
      response: response + drillMarker,
      citations,
      intent: "phrase_drill",
      mode: "compose",
      drillIndex: challengeIndex,
      totalChallenges: challenges?.length,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async safeCallTool(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const start = Date.now();
    try {
      const result = await this.callTool(tool, params);
      this.traceLog.push({
        tool,
        params,
        latencyMs: Date.now() - start,
        ok: true,
        summary: summarizeResult(tool, result),
        resultSnapshot: snapshotResult(result),
      });
      return result;
    } catch (e) {
      this.traceLog.push({
        tool,
        params,
        latencyMs: Date.now() - start,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  private async parallelFetch(specs: ToolCallSpec[]): Promise<unknown[]> {
    const results = await Promise.allSettled(
      specs.map((s) => this.safeCallTool(s.tool, s.params as Record<string, unknown>)),
    );
    return results.map((r) => (r.status === "fulfilled" ? r.value : null));
  }
}

// ---------------------------------------------------------------------------
// Phrase-drill helpers
// ---------------------------------------------------------------------------

/**
 * Scan the conversation history for the most recently shown annotated passage
 * and extract the UST/GST line for the given verse number.
 *
 * The annotated passage is rendered with lines like:
 *   "GST — 12 Cuando Dios nos salva…"  (or "UST — 12 …")
 * We extract the text after the verse number so it can be passed to the drill
 * as a comparison reference.
 */
function extractUstVerseFromHistory(
  history: ConversationMessage[],
  verse: string,
): string | undefined {
  // Walk history backwards to find the annotated passage assistant message
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!content.includes("<!-- CHALLENGES:")) continue;

    // Look for a line that starts with a simplified text label followed by the verse number
    // Patterns: "GST — 12 text…" / "UST — 12 text…" / "GST — 12. text…"
    const versePattern = new RegExp(
      `(?:GST|UST|Simplified)[^\\n]*?\\b${verse}\\b[.:]?\\s+([^\\n]{20,})`,
      "i",
    );
    const m = content.match(versePattern);
    if (m?.[1]) return m[1].trim().replace(/<!--.*?-->/gs, "").trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Assembly helpers
// ---------------------------------------------------------------------------

/** Resource type abbreviation labels (intentionally terse — no English descriptions). */
const SCRIPTURE_LABELS: Record<string, string> = {
  ult: "ULT",
  ust: "UST",
  glt: "GLT",
  gst: "GST",
  ugnt: "UGNT",
  uhb: "UHB",
  obs: "OBS",
};

/** Human-readable labels for version roles (from get_passage_context). */
const ROLE_LABELS: Record<string, string> = {
  literal: "Literal Translation",
  simplified: "Simplified Translation",
  original: "Original Language Text",
};

function assembleBundle(
  results: unknown[],
  specs: ToolCallSpec[],
  language: string,
): EnrichedBundle {
  const bundle: EnrichedBundle = {
    scripture: { versions: [], format: "plain" },
    scriptures: [],
    notes: [],
    tw: [],
    ta: [],
    tq: [],
    metadata: {
      cacheStatus: "miss",
      license: "CC BY-SA 4.0",
      language,
      reference: "",
      provenance: [],
    },
  };

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const raw = results[i];
    if (!raw || typeof raw !== "object") continue;

    const data = extractPayload(raw);
    if (!data) continue;

    switch (spec.tool) {
      // ── New workflow tools ───────────────────────────────────────────────

      case "get_passage": {
        // Returns: { reference, language, versions[] } — scripture text only
        const r = data as Record<string, unknown>;
        const versions = (r["versions"] as Array<{
          resourceType: string; role: string; text: string; source?: string;
        }>) ?? [];
        if (versions.length > 0) {
          bundle.metadata.reference = String((spec.params as Record<string, unknown>).reference ?? "");
          // Capture effective language in case the server resolved a variant
          if (r["language"]) bundle.metadata.effectiveLanguage = String(r["language"]);
          bundle.scripture = { versions: versions as never, format: "plain" };

          // Defense-in-depth: if every version is the original language (Greek/Hebrew),
          // the requested language has no translation. Set a warning rather than silently
          // presenting original-language text as if it were a translation.
          const allOriginal = versions.every((v) => v.role === "original");
          if (allOriginal && versions.length > 0) {
            bundle.dataWarning =
              "No scripture translation found for the selected language. " +
              "Showing original language text (Greek/Hebrew) only.";
          }

          for (const v of versions) {
            if (!bundle.scriptures.some((s) => s.resourceType === v.resourceType)) {
              bundle.scriptures.push({
                resourceType: v.resourceType,
                label: SCRIPTURE_LABELS[v.resourceType] ??
                  ROLE_LABELS[v.role] ??
                  v.resourceType.toUpperCase(),
                text: v.text,
                format: "plain",
              });
            }
          }
        }
        break;
      }

      case "get_note": {
        // Returns: { reference, notes[] } — full note bodies (same shape as fetch_translation_notes)
        const r = data as Record<string, unknown>;
        const notes = (r["notes"] as unknown[]) ?? [];
        bundle.metadata.reference = String(r["reference"] ?? (spec.params as Record<string, unknown>).reference ?? "");
        for (const n of notes) {
          const note = n as Record<string, unknown>;
          if (!bundle.notes.some((existing) => existing.id === String(note["id"] ?? ""))) {
            bundle.notes.push({
              id: String(note["id"] ?? ""),
              text: String(note["note"] ?? ""),
              quote: note["quote"] ? String(note["quote"]) : undefined,
              verse: note["verse"] ? String(note["verse"]) : undefined,
              externalReference: note["supportReference"]
                ? { path: String(note["supportReference"]) }
                : undefined,
              ...(note["supportReference"]
                ? { supportReference: String(note["supportReference"]) }
                : {}),
            });
          }
        }
        break;
      }

      case "get_passage_index": {
        // Returns: { notes[], words[], issues[], keyTerms[] }
        // Use words[] to seed bundle.tw for RC expansion; notes[] are compact (no bodies).
        const r = data as Record<string, unknown>;
        const words = (r["words"] as Array<Record<string, unknown>>) ?? [];
        for (const w of words) {
          const twArticle = w["twArticle"] as Record<string, unknown> | null;
          if (!twArticle?.["path"]) continue;
          const path = String(twArticle["path"]);
          if (bundle.tw.some((t) => t.path === path)) continue;
          const quote = w["quote"] as Record<string, unknown> | undefined;
          const ref = String(w["reference"] ?? "");
          const vs = ref.includes(":") ? ref.split(":")[1] : undefined;
          bundle.tw.push({
            id: `tw-${path}`,
            title: String(twArticle["title"] ?? path.split("/").pop() ?? path),
            path,
            origWords: String(quote?.["original"] ?? ""),
            wordPath: path, // already clean slug, not rc:// URI
            verse: vs,
          });
        }
        break;
      }

      case "get_word_article": {
        // Returns: { path, language, article }
        const r = data as Record<string, unknown>;
        const path = String(r["path"] ?? (spec.params as Record<string, unknown>).path ?? "")
          .replace(/\/[^/]+\.md$/, ""); // strip .md suffix if present
        const article = String(r["article"] ?? "");
        if (article && path) {
          const existing = bundle.tw.find((t) => t.path === path || path.includes(t.path));
          if (existing) {
            existing.article = article;
          } else {
            bundle.tw.push({
              id: `tw-${path}`,
              title: path.split("/").pop() ?? path,
              path,
              article,
            });
          }
        }
        break;
      }

      case "get_academy_article": {
        // Returns: { path, language, article }
        const r = data as Record<string, unknown>;
        const path = String(r["path"] ?? (spec.params as Record<string, unknown>).path ?? "")
          .replace(/\/[^/]+\.md$/, "");
        const article = String(r["article"] ?? "");
        if (article && path) {
          bundle.ta.push({
            id: `ta-${path}`,
            title: path.split("/").pop() ?? path,
            path,
            article,
          });
        }
        break;
      }

      case "get_questions": {
        // Returns: { reference, questions[] }
        const r = data as Record<string, unknown>;
        const questions = (r["questions"] as unknown[]) ?? [];
        bundle.tq = bundle.tq ?? [];
        for (const q of questions) {
          const qObj = q as Record<string, unknown>;
          bundle.tq.push({
            id: String(qObj["id"] ?? ""),
            question: String(qObj["question"] ?? ""),
            response: qObj["response"] ? String(qObj["response"]) : undefined,
            verse: String(qObj["verse"] ?? qObj["chapter"] ?? ""),
          });
        }
        break;
      }

    }
  }

  return bundle;
}

/** Extract the actual payload from a tool response (handles MCP wrapper). */
function extractPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // MCP tool responses often have a { content: [{type: "text", text: "..."}] } shape
  if (Array.isArray(obj["content"])) {
    const first = (obj["content"] as unknown[])[0] as Record<string, unknown>;
    if (first?.["type"] === "text" && typeof first["text"] === "string") {
      try {
        return JSON.parse(first["text"]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  // Direct object payload
  if (
    "notes" in obj ||
    "words" in obj ||
    "wordLinks" in obj ||
    "links" in obj ||
    "article" in obj ||
    "text" in obj ||
    "versions" in obj ||
    "questions" in obj ||
    "resources" in obj ||
    "languages" in obj ||
    "issues" in obj ||
    "keyTerms" in obj ||
    "availability" in obj ||
    "context" in obj
  ) {
    return obj;
  }
  return null;
}

/** Extract the context array from a get_passage_context response. */
function extractPassageContext(
  raw: unknown,
): Array<{ scope: "book" | "chapter"; title: string; body: string }> | undefined {
  const data = extractPayload(raw);
  if (!data) return undefined;
  const context = data["context"] as
    | Array<{ scope: string; title: string; body: string }>
    | undefined;
  if (!Array.isArray(context) || context.length === 0) return undefined;
  return context as Array<{ scope: "book" | "chapter"; title: string; body: string }>;
}

function extractArticleText(raw: unknown): string | null {
  const data = extractPayload(raw);
  if (!data) return null;
  const article = data["article"];
  return typeof article === "string" && article.length > 0 ? article : null;
}

function extractArticleKeys(
  searchResult: unknown,
  intent: string,
): ToolCallSpec[] {
  if (!searchResult || typeof searchResult !== "object") return [];
  const r = searchResult as Record<string, unknown>;
  const results = r["results"] as Array<{ path: string; resourceType: "ta" | "tw"; title: string }> | undefined;
  if (!results?.length) return [];

  const specs: ToolCallSpec[] = [];
  for (const hit of results.slice(0, 3)) {
    if (hit.resourceType === "ta" || intent === "methodology") {
      specs.push({ tool: "get_academy_article", params: { path: hit.path, language: String(r["language"] ?? "en") } });
    } else if (hit.resourceType === "tw" || intent === "word_study") {
      specs.push({ tool: "get_word_article", params: { path: hit.path, language: String(r["language"] ?? "en") } });
    }
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

function buildSystemPrompt(bundle: EnrichedBundle, intentResult: IntentResult): string {
  const context = renderEnrichedBundle(bundle);
  const intentBlock = intentSystemFragment(intentResult.intent);
  return `${SYSTEM_BASE}\n\n${intentBlock}\n\n${context}`;
}

function collectCitations(bundle: EnrichedBundle): Array<{ path: string; title?: string }> {
  const citations: Array<{ path: string; title?: string }> = [];

  // Cite each fetched scripture translation
  for (const s of bundle.scriptures ?? []) {
    citations.push({
      path: `scripture/${s.resourceType}/${bundle.metadata.reference}`,
      title: s.label,
    });
  }
  if (citations.length === 0 && bundle.scripture.versions?.length) {
    citations.push({ path: `scripture/${bundle.metadata.reference}`, title: "Scripture" });
  }
  for (const note of bundle.notes.slice(0, 5)) {
    citations.push({ path: `tn/${bundle.metadata.reference}/${note.id}`, title: "Translation Note" });
  }
  for (const tw of bundle.tw.slice(0, 3)) {
    citations.push({ path: tw.path, title: tw.title });
  }
  for (const ta of bundle.ta.slice(0, 2)) {
    citations.push({ path: ta.path, title: ta.title });
  }
  return citations;
}

/** Produce a one-line summary string from a tool result for display in the trace panel. */
/**
 * Build a compact snapshot of the MCP result for display in the Tools panel.
 * Arrays are truncated to 3 items; strings to 400 chars — keeps SSE payload small.
 */
function snapshotResult(result: unknown, depth = 0): unknown {
  if (result === null || result === undefined) return result;
  if (typeof result === "string") {
    return result.length > 400 ? result.slice(0, 400) + "…" : result;
  }
  if (typeof result !== "object") return result;
  if (Array.isArray(result)) {
    const items = result.slice(0, 3).map((item) => snapshotResult(item, depth + 1));
    return result.length > 3 ? [...items, `…+${result.length - 3} more`] : items;
  }
  if (depth > 2) return "…";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    out[k] = snapshotResult(v, depth + 1);
  }
  return out;
}

function summarizeResult(tool: string, result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;

  // New workflow tools
  if (tool === "get_passage") {
    const versions = r["versions"] as unknown[] | undefined;
    return versions?.length ? `${versions.length} version(s)` : undefined;
  }
  if (tool === "get_passage_context") {
    const context = r["context"] as unknown[] | undefined;
    return context?.length !== undefined ? `${context.length} context note(s)` : undefined;
  }
  if (tool === "get_note") {
    const notes = r["notes"] as unknown[] | undefined;
    return notes?.length !== undefined ? `${notes.length} note(s)` : undefined;
  }
  if (tool === "get_passage_index") {
    const words = r["words"] as unknown[] | undefined;
    const notes = r["notes"] as unknown[] | undefined;
    return `${notes?.length ?? 0} note(s), ${words?.length ?? 0} word link(s)`;
  }
  if (tool === "get_academy_article" || tool === "get_word_article") {
    const text = r["article"] as string | undefined;
    return text ? `${Math.round(text.length / 100) * 100} chars` : undefined;
  }
  if (tool === "get_questions") {
    const qs = r["questions"] as unknown[] | undefined;
    return qs?.length !== undefined ? `${qs.length} question(s)` : undefined;
  }

  if (tool === "search_articles") {
    const results = r["results"] as unknown[] | undefined;
    return results?.length !== undefined ? `${results.length} result(s)` : undefined;
  }
  if (tool === "list_languages") {
    const langs = r["languages"] as unknown[] | undefined;
    return langs?.length !== undefined ? `${langs.length} language(s)` : undefined;
  }
  if (tool === "list_resources_for_language") {
    const resources = r["resources"] as unknown[] | undefined;
    return resources?.length !== undefined ? `${resources.length} resource(s)` : undefined;
  }
  return undefined;
}
