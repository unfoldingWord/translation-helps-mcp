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
  buildChecklistMarker,
  buildBatchMarker,
  ensureCheckingSessionFooter,
  hasQuizFollowOnRequest,
  historyHasQuizCleared,
  isExplicitQuizRequest,
  isWordArticleRequest,
  stripQuizOptOutPhrases,
  type ConversationMessage,
  type IntentResult,
  nextBatchRef,
} from "./intent.js";
import { selectResources, type ToolCallSpec } from "./resourceSelector.js";
import { applyBudget, type EnrichedBundle } from "./budgeter.js";
import { extractTaPathsFromNotes } from "@translation-helps/door43";
import {
  SYSTEM_BASE,
  renderEnrichedBundle,
  intentSystemFragment,
} from "../rag/PromptFormatter.js";
import { parseReferenceForTool } from "@translation-helps/door43";
import { runOverviewPipeline } from "./PassageOverviewAgents.js";
import {
  runAnnotator,
  formatAnnotatedResponse,
  composeAnnotatedGuideReply,
  formatDrillSystem,
  type Challenge,
} from "./PassageAnnotator.js";
import {
  CHAT_WORD_BUDGETS,
  closerKindForIntent,
  enforceReplyBudget,
  maxTokensForWordBudget,
  truncateAtFirstQuestion,
  wordBudgetForIntent,
} from "./chatPacing.js";
import { stripCoachScaffoldLabels } from "./coachPedagogy.js";
import {
  buildCheckItemFocus,
  buildPanelFocusResourceHint,
  extractChecklistReference,
  parseCheckItemFromMessage,
  parseFocusHintFromStudyContext,
  pinFocusedCheckItem,
} from "../checklist/checkingChecklist.js";
import {
  languagePairPromptGuidance,
  resolveLanguagePair,
} from "./languagePair.js";
import {
  generateQuiz,
  buildQuizMarker,
  fallbackQuizOfferFooter,
} from "./QuizAgents.js";
import {
  buildQuizOfferMarker,
  quizKindMarksReadiness,
  type QuizKind,
} from "./onDemandQuiz.js";
import {
  buildQuizScopeMarker,
  deriveReadiness,
  isBookSettled,
  isChapterSettled,
  parseRefParts,
  quizScopeForReference,
} from "./contextReadiness.js";
import { inferPassageContextScope, type UIComponent } from "./uiComponents.js";
import {
  DEFAULT_WORKFLOW_MODE,
  parseWorkflowMode,
  shouldOfferContextQuiz,
  workflowModePromptBias,
  type WorkflowMode,
} from "./workflowMode.js";

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
  thinking?(label: string, state: "working" | "done"): void;
  /** Emit a structured UI component for the frontend to render. */
  ui?(component: UIComponent): void;
  /** Imperative resources-panel command (open / focus / highlight / scroll). */
  panelAction?(action: import("./panelActions.js").PanelAction): void;
  /** Emit a live trace event (only present when debug mode is active). */
  trace?(ev: import("./traceEvents.js").TraceEvent): void;
}

export interface HarnessOptions {
  /**
   * Source language: Door43 fetches (ULT/UST/TN/TW/TA) AND coach conversation locale.
   * Default "en".
   */
  language?: string;
  /**
   * Target / receptor language — UX metadata only ("translating into X").
   * Not used as coach reply locale; LLM does not read target drafts.
   */
  targetLanguage?: string;
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
   * Active chat workflow mode (study | translate | check).
   * Biases prompts and auto context-quiz offers; intents still work across modes.
   */
  workflowMode?: WorkflowMode | string;
  /**
   * Compact client study-session snapshot (loaded passage, checklist
   * ticked/unticked lines, outline). Injected into the system prompt so the
   * coach can prioritize unchecked checklist items and never re-ask `[x]` ones.
   */
  studyContext?: string;
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
   * The effective source/resource language used to fetch, which may differ from
   * the requested source when a variant was resolved (e.g. "es" → "es-419").
   * Callers should emit `setSourceLanguage` when this differs from the input.
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
  /** Stored during run() so safeCallTool can emit trace events. */
  private emit: HarnessEmit | undefined;
  /** Receptor label metadata only (optional); coach always uses source `language`. */
  private targetLanguage = "";
  /** Active workflow mode for prompt bias + quiz gating. */
  private workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE;

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
    this.emit = opts.emit;
    this.workflowMode = parseWorkflowMode(opts.workflowMode);
    // `language` = source (resources + coach). `targetLanguage` = receptor metadata only.
    const language = opts.language ?? "en";
    const targetLanguage = opts.targetLanguage?.trim() || language;
    this.targetLanguage = opts.targetLanguage?.trim() || "";
    const langPair = resolveLanguagePair({
      sourceLanguage: language,
      targetLanguage,
    });
    // Tracks whether any UI components were actually emitted this turn.
    // Used to gate the "Workbench is active" system prompt so the LLM only
    // references cards that genuinely exist in the user's panel.
    let componentsEmitted = 0;

    // 1. Classify intent — pass history for continuation detection
    let intentResult = classifyIntent(message, opts.conversationHistory);

    // 1a. Compound quiz-skip + follow-on ("omitir… y muéstrame el artículo…"):
    //     honor the residual intent (same contract as skillChat Path Q).
    if (
      intentResult.intent === "quiz_skip" &&
      hasQuizFollowOnRequest(message)
    ) {
      const residualMsg = stripQuizOptOutPhrases(message) || message;
      intentResult = classifyIntent(residualMsg);
    }

    // 1b. LLM-based phrase-drill disambiguation.
    //     The sync classifier handles unambiguous numeric picks ("3").
    //     For everything else, when challenges are active in history, ask the
    //     LLM to decide whether the user is selecting a specific challenge.
    //     This replaces the brittle regex/fuzzy match and correctly handles
    //     connector words ("So why is 'world' a metonymy?").
    //     Never steal explicit word/article / quiz / methodology asks.
    const skipPhraseDrill =
      intentResult.intent === "phrase_drill" ||
      intentResult.intent === "word_study" ||
      intentResult.intent === "methodology" ||
      intentResult.intent === "quiz_skip" ||
      intentResult.intent === "quiz_answer" ||
      intentResult.intent === "checking" ||
      isWordArticleRequest(message);
    if (!skipPhraseDrill && opts.conversationHistory) {
      const activeChallenges = extractChallengesFromHistory(
        opts.conversationHistory,
      );
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

    // 1c. Checklist-item click (CHECKITEM) — bind the checklist passage
    //     reference from STUDY CONTEXT when the click message itself has no
    //     parseable reference (first click of a session, before any sticky
    //     CHECKING footer exists). Without this, the checking plan has no
    //     reference → no initial fetches → training-only reply.
    const checkItemMarker =
      intentResult.intent === "checking"
        ? parseCheckItemFromMessage(message)
        : null;
    if (checkItemMarker && !intentResult.reference) {
      const checklistRef = extractChecklistReference(opts.studyContext);
      if (checklistRef) {
        intentResult = {
          ...intentResult,
          reference: checklistRef,
          confidence: "high",
        };
      }
    }

    // 2. Build resource plan
    const plan = selectResources(intentResult, language);

    // 2b. Item-check turns must always be grounded in the focused item's
    //     resources. get_note (whole-passage) covers clicked TN items; a
    //     clicked TW item additionally fetches its article directly.
    if (checkItemMarker?.kind === "tw" && plan.intent === "checking") {
      const path = checkItemMarker.resourceId;
      const alreadyPlanned = plan.initialFetches.some(
        (s) =>
          s.tool === "get_word_article" &&
          (s.params as { path?: string }).path === path,
      );
      if (path.includes("/") && !alreadyPlanned) {
        plan.initialFetches.push({
          tool: "get_word_article",
          params: { path, language },
        });
      }
    }

    // Emit plan trace after resource plan is built
    opts.emit?.trace?.({
      type: "plan",
      intent: plan.intent,
      initialFetches: plan.initialFetches.map((s) => s.tool),
      rcExpansion: plan.rcExpansion,
    });

    const isOverview = plan.intent === "passage_overview";
    // For passage_overview, sub-agents each own their full domain — no caps.
    // For all other intents, apply the configured (or default) limits.
    const maxTa = isOverview ? 20 : (opts.maxTaExpansion ?? 3);
    const maxTw = isOverview ? 15 : (opts.maxTwExpansion ?? 4);

    // 3a0. Quiz turns are handled in skillChat Path Q (never fetch resources here).
    if (plan.intent === "quiz_answer" || plan.intent === "quiz_skip") {
      return {
        response: "",
        citations: [],
        intent: plan.intent,
        mode: "compose",
        toolCalls: [...this.traceLog],
      };
    }

    // 3a. Checklist step continuation — no resource fetches, just advance the session
    if (
      plan.intent === "checklist_step" &&
      intentResult.nextStep !== undefined
    ) {
      return this.handleChecklistStep(
        intentResult.nextStep,
        intentResult.totalSteps ?? intentResult.nextStep,
        opts.conversationHistory ?? [],
        language,
      );
    }

    // 3b. Phrase drill — user selected a challenge from an annotated passage
    if (
      plan.intent === "phrase_drill" &&
      intentResult.challengeIndex !== undefined
    ) {
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
      opts.emit?.status("Locating article…");
      const resourceTypes = plan.articleLocate.resourceType
        ? [plan.articleLocate.resourceType]
        : ["ta", "tw"];
      let searchResult = await this.safeCallTool("search_articles", {
        query: plan.articleLocate.query,
        language,
        resourceTypes,
        topK: 5,
      });
      let keys = extractArticleKeys(searchResult, plan.intent, language);
      let locatedInEnglish = false;
      // Study-language catalog miss: for Spanish beginners, prefer staying on
      // TN/GST with a short apology rather than dumping English TW/TA mid-flow.
      // Other languages may still locate in English once.
      const preferStayOnPanel =
        plan.intent === "word_study" && language.toLowerCase().startsWith("es");
      if (keys.length === 0 && language !== "en" && !preferStayOnPanel) {
        opts.emit?.status(
          "No article hits in study language; searching English…",
        );
        searchResult = await this.safeCallTool("search_articles", {
          query: plan.articleLocate.query,
          language: "en",
          resourceTypes,
          topK: 5,
        });
        keys = extractArticleKeys(searchResult, plan.intent, "en");
        locatedInEnglish = keys.length > 0;
      }
      for (const spec of keys) {
        plan.initialFetches.push(spec);
      }
      if (locatedInEnglish) {
        plan.twEnFallback = true;
      }
    }

    if (plan.initialFetches.length === 0) {
      // Word-study with no locate/fetch hits — honest miss (never training-only fabricate).
      if (plan.intent === "word_study") {
        const termLabel =
          intentResult.term?.trim() || plan.articleLocate?.query || "that term";
        const honest = language.toLowerCase().startsWith("es")
          ? `No hay un artículo de palabras clave (Translation Words) en \`${language}\` para **${termLabel}**. ` +
            `Sigamos con la nota y el texto simplificado (GST) en el panel — ahí puedes ver el sentido sin cambiar al inglés. ` +
            `¿Qué parte de esa palabra o nota te cuesta traducir?`
          : `I couldn't retrieve a Translation Words article for **${termLabel}**. ` +
            (language !== "en"
              ? `No TW catalog entry was found for \`${language}\`. `
              : "") +
            `Let's stay with the note and simplified text in the panel. What about this term feels hard to translate?`;
        if (opts.emit?.token) {
          for (const word of honest.split(/(\s+)/)) opts.emit.token(word);
        }
        return {
          response: honest,
          citations: [],
          intent: plan.intent,
          mode: "compose",
          dataWarning: `No TW article retrieved for "${termLabel}".`,
          toolCalls: [...this.traceLog],
        };
      }
      // Nothing to fetch — fall through to training-only.
      // Keep recent history so prior passage/notes context is still available.
      const recentHistory = this.conversationHistory
        .slice(-8)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content.replace(/<!--[\s\S]*?-->/g, "").trim(),
        }))
        .filter((m) => m.content.length > 0);
      return {
        response: await this.llm.generate([
          { role: "system", content: SYSTEM_BASE },
          ...recentHistory,
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

    // 6b. Auto-retry get_passage with "en" when the selected language has no scripture.
    //     This prevents an empty/error response when a stale or unsupported language code
    //     was used. The retry only re-fetches the scripture; notes and other resources
    //     remain in the original language (they have their own server-side fallbacks).
    if (language !== "en" && bundle.scriptures.length === 0) {
      const passageSpec = plan.initialFetches.find(
        (s) => s.tool === "get_passage",
      );
      if (passageSpec) {
        opts.emit?.status(
          "No scripture found for selected language, trying English…",
        );
        const fallbackSpec: ToolCallSpec = {
          ...passageSpec,
          params: {
            ...(passageSpec.params as Record<string, unknown>),
            language: "en",
          } as (typeof passageSpec)["params"],
        };
        const [fallbackResult] = await this.parallelFetch([fallbackSpec]);
        const fallbackBundle = assembleBundle(
          [fallbackResult],
          [fallbackSpec],
          "en",
        );
        if (fallbackBundle.scriptures.length > 0) {
          bundle.scripture = fallbackBundle.scripture;
          bundle.scriptures = fallbackBundle.scriptures;
          bundle.metadata.effectiveLanguage = "en";
          bundle.dataWarning =
            `No scripture translation found for language "${language}". ` +
            `Showing English (en) as fallback.`;
        }
      }
    }

    // 6c. Auto-retry get_note (and get_passage_index) when the selected language has
    //     no translation notes. First try the effectiveLanguage from get_passage (e.g.
    //     "es-419" when "es" was requested) — this is the expected variant, not a
    //     degradation. Only fall back to English if the variant also yields nothing.
    if (language !== "en" && bundle.notes.length === 0) {
      const noteSpec = plan.initialFetches.find((s) => s.tool === "get_note");
      const indexSpec = plan.initialFetches.find(
        (s) => s.tool === "get_passage_index",
      );
      if (noteSpec || indexSpec) {
        // Step 1: try the variant language resolved by get_passage (e.g. "es-419")
        const variantLang = (bundle.metadata as Record<string, unknown>)
          ?.effectiveLanguage as string | undefined;

        let variantSucceeded = false;
        if (variantLang && variantLang !== language) {
          const variantSpecs: ToolCallSpec[] = [];
          if (noteSpec) {
            variantSpecs.push({
              ...noteSpec,
              params: {
                ...(noteSpec.params as Record<string, unknown>),
                language: variantLang,
              } as (typeof noteSpec)["params"],
            });
          }
          if (indexSpec) {
            variantSpecs.push({
              ...indexSpec,
              params: {
                ...(indexSpec.params as Record<string, unknown>),
                language: variantLang,
              } as (typeof indexSpec)["params"],
            });
          }
          const variantResults = await this.parallelFetch(variantSpecs);
          const variantBundle = assembleBundle(
            variantResults,
            variantSpecs,
            variantLang,
          );
          if (variantBundle.notes.length > 0) {
            bundle.notes = variantBundle.notes;
            variantSucceeded = true;
            // Variant is the expected resolved language — no degradation warning.
          }
        }

        // Step 2: only try English if variant also yielded nothing
        if (!variantSucceeded) {
          opts.emit?.status(
            "No notes found for selected language, checking English notes…",
          );
          const fallbackSpecs: ToolCallSpec[] = [];
          if (noteSpec) {
            fallbackSpecs.push({
              ...noteSpec,
              params: {
                ...(noteSpec.params as Record<string, unknown>),
                language: "en",
              } as (typeof noteSpec)["params"],
            });
          }
          if (indexSpec) {
            fallbackSpecs.push({
              ...indexSpec,
              params: {
                ...(indexSpec.params as Record<string, unknown>),
                language: "en",
              } as (typeof indexSpec)["params"],
            });
          }
          const fallbackResults = await this.parallelFetch(fallbackSpecs);
          const fallbackBundle = assembleBundle(
            fallbackResults,
            fallbackSpecs,
            "en",
          );
          if (fallbackBundle.notes.length > 0) {
            bundle.notes = fallbackBundle.notes;
            // Don't override effectiveLanguage — scripture stays in selected lang.
            // Append to dataWarning so it's visible in the UI.
            const noteWarning = `Translation notes not available in language "${language}". Showing English notes.`;
            bundle.dataWarning = bundle.dataWarning
              ? `${bundle.dataWarning} ${noteWarning}`
              : noteWarning;
          }
        }
      }
    }

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

      // get_passage_context is already in the initial fetch plan (book/chapter
      // intros live on bundle.passageContext and emit as passage_context UI).
      // Annotator + coach brief use source/conversation language (same as resources).
      const annotated = await runAnnotator(
        bundle,
        intentResult.reference,
        language,
        this.llm,
      );

      const passageContextForText = bundle.passageContext?.notes.map((n) => ({
        scope: n.scope,
        title: n.title ?? (n.scope === "book" ? "Book intro" : "Chapter intro"),
        body: n.noteText,
      }));
      // When the frontend supports UI components, skip the numbered list in the text —
      // the challenge_cards component will render it interactively instead.
      const hasUiSupport = typeof opts.emit?.ui === "function";
      const tnCount = hasUiSupport
        ? bundle.notes.length
        : annotated.challenges.filter((c) => c.sourceType === "tn").length;
      const twCount = hasUiSupport
        ? bundle.tw.filter((t) => t.title).length
        : annotated.challenges.filter((c) => c.sourceType === "tw").length;

      // Opt-in context / practice quiz — generate BEFORE the coach brief so the
      // optional offer can be folded into the same LLM reply (no second call).
      // When readiness is already settled, offer as practice (no READY / QUIZSCOPE).
      // Pacing: suppress after a recent QUIZ:cleared unless the user asks again.
      let quizQuestions: Awaited<ReturnType<typeof generateQuiz>> = [];
      const modeBlocksQuiz =
        !shouldOfferContextQuiz(this.workflowMode) &&
        !isExplicitQuizRequest(message);
      const readinessScope = quizScopeForReference(intentResult.reference);
      const readinessState = deriveReadiness(this.conversationHistory);
      const readinessSettled = readinessScope
        ? readinessScope.level === "book"
          ? isBookSettled(readinessState, readinessScope.book)
          : isChapterSettled(
              readinessState,
              readinessScope.book,
              readinessScope.chapter!,
            )
        : false;
      const refParts = parseRefParts(intentResult.reference);
      const isVerseScoped = Boolean(refParts?.verseStart);
      // Settled → practice/passage (on-demand); unsettled verse → context
      // (chapter readiness); unsettled book/chapter → context.
      const offerKind: QuizKind = readinessSettled
        ? isVerseScoped
          ? "passage"
          : "practice"
        : "context";
      const suppressQuizOffer =
        modeBlocksQuiz ||
        (historyHasQuizCleared(this.conversationHistory) &&
          !isExplicitQuizRequest(message));
      if (!suppressQuizOffer) {
        try {
          opts.emit?.thinking?.("Context quiz", "working");
          quizQuestions = await generateQuiz(
            bundle,
            intentResult.reference,
            language,
            this.llm,
          );
          opts.emit?.thinking?.("Context quiz", "done");
        } catch {
          opts.emit?.thinking?.("Context quiz", "done");
          quizQuestions = [];
        }
      } else {
        opts.emit?.status(
          modeBlocksQuiz
            ? "Skipping context quiz offer (Check mode)…"
            : "Skipping context quiz offer (previously cleared)…",
        );
      }
      const optionalQuizQuestions =
        quizQuestions.length >= 3 ? quizQuestions.length : undefined;

      const responseText = hasUiSupport
        ? await composeAnnotatedGuideReply(this.llm, {
            reference: intentResult.reference,
            language,
            tnCount,
            twCount,
            challenges: annotated.challenges,
            recentTurns: [
              ...this.conversationHistory.slice(-5),
              { role: "user", content: message },
            ],
            workflowModeBias: workflowModePromptBias(this.workflowMode),
            optionalQuizQuestions,
          })
        : (() => {
            const brief = formatAnnotatedResponse(
              annotated,
              intentResult.reference,
              language,
              passageContextForText,
              false,
            );
            // Non-UI path has no brief LLM call to fold into — use named fallback.
            return optionalQuizQuestions
              ? `${brief}\n\n---\n${fallbackQuizOfferFooter(language, optionalQuizQuestions)}`
              : brief;
          })();

      // Emit structured UI components FIRST so the workbench populates immediately
      // while the text is still streaming.  We ALWAYS emit bundle components when
      // UI support is present — even when the annotator produced zero challenges —
      // so the workbench always shows the scripture text, words, questions, and context.
      // challenge_cards is only added when there is at least one challenge.
      if (hasUiSupport) {
        // 1. Emit scripture_text + context + notes + words + questions via helper.
        //    Always emit notes alongside challenge_cards so the study stream can
        //    show the full resource set (challenges are a curated entry point).
        componentsEmitted += emitBundleComponents(
          bundle,
          intentResult.reference,
          opts.emit!,
          {
            skipNotes: false,
            highlightPhrase: annotated.challenges[0]?.phrase,
          },
        );

        // 2. Challenge cards — only when the annotator surfaced at least one challenge.
        if (annotated.challenges.length > 0) {
          opts.emit!.ui!({
            type: "challenge_cards",
            challenges: annotated.challenges,
          });
          opts.emit!.trace?.({
            type: "ui_emit",
            componentType: "challenge_cards",
          });
          componentsEmitted++;
        }
      }

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

      // Markers only — offer wording is already in responseText (folded or fallback).
      // QUIZSCOPE only for readiness-eligible context quizzes; practice/passage
      // get a QUIZOFFER companion so an affirmative can regenerate if needed.
      const quizSuffix =
        quizQuestions.length >= 3
          ? buildQuizMarker(0, quizQuestions, offerKind) +
            (readinessScope && quizKindMarksReadiness(offerKind)
              ? buildQuizScopeMarker(readinessScope)
              : buildQuizOfferMarker(
                  offerKind,
                  intentResult.reference,
                  isVerseScoped ? "passage" : "context",
                ))
          : "";

      return {
        response: responseText + hidden + quizSuffix,
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
      // Emit bundle components (scripture + notes + words) before kicking off the
      // multi-agent pipeline so the workbench is populated while text streams.
      if (opts.emit?.ui) {
        componentsEmitted += emitBundleComponents(
          bundle,
          intentResult.reference,
          opts.emit,
        );
      }

      const { response: overviewResponse, citations: overviewCitations } =
        await runOverviewPipeline(
          bundle,
          intentResult.reference,
          language,
          this.llm,
          opts.emit,
          // Study mode reframes the checklist as a panel-first study path.
          this.workflowMode,
        );

      // Count the total steps in the checklist (orchestrator emits "☐ N." markers).
      const stepCount = (overviewResponse.match(/☐ \d+\./g) ?? []).length || 5;

      // Strip any visible [Step N/M] footers the LLM may have emitted and inject
      // a hidden CHECKLIST marker + a natural closing question instead.
      const normalized = normalizeChecklistFooter(
        overviewResponse,
        1,
        stepCount,
      );
      const hasNaturalClose = /[¿?]\s*$/.test(normalized.trim());
      const response =
        (hasNaturalClose
          ? normalized
          : normalized.replace(/\s+$/, "") +
            `\n\n${checklistContinuePhrase(language)}`) +
        `\n${buildChecklistMarker(1, stepCount)}`;

      return {
        response,
        citations: overviewCitations,
        intent: plan.intent,
        mode: "compose",
        reference: intentResult.reference,
        toolCalls: [...this.traceLog],
      };
    }

    // 9. Emit structured UI components for the workbench before LLM generation.
    //    This populates the right panel while the explanation streams in the left panel.
    //    word_study / methodology may have articles with no passage reference — still surface them.
    if (opts.emit?.ui) {
      if (intentResult.reference) {
        componentsEmitted += emitBundleComponents(
          bundle,
          intentResult.reference,
          opts.emit,
        );
      } else {
        componentsEmitted += emitArticleOnlyComponents(bundle, opts.emit);
      }
    }

    // 9a2. Disclose EN locate fallback when search ran against English catalog.
    if (
      plan.intent === "word_study" &&
      plan.twEnFallback &&
      bundle.tw.some((t) => Boolean(t.article?.trim()))
    ) {
      const disclosure = language.toLowerCase().startsWith("es")
        ? `No hay Translation Words en \`${language}\`; usando EN.`
        : `No Translation Words catalog for "${language}"; using English.`;
      bundle.dataWarning = bundle.dataWarning
        ? `${bundle.dataWarning} ${disclosure}`
        : disclosure;
    }

    // 9b. Word-study: if study-language TW fetch missed, retry English once —
    //     except Spanish study languages, where we prefer TN/GST + apology.
    if (
      plan.intent === "word_study" &&
      language !== "en" &&
      !language.toLowerCase().startsWith("es") &&
      !bundle.tw.some((t) => Boolean(t.article?.trim()))
    ) {
      const twSpecs = plan.initialFetches.filter(
        (s) => s.tool === "get_word_article",
      );
      if (twSpecs.length > 0) {
        opts.emit?.status("Retrying word article in English…");
        const enSpecs = twSpecs.map((s) => ({
          ...s,
          params: {
            ...(s.params as Record<string, unknown>),
            language: "en",
          } as (typeof s)["params"],
        }));
        const enResults = await this.parallelFetch(enSpecs);
        const enBundle = assembleBundle(enResults, enSpecs, "en");
        for (const tw of enBundle.tw) {
          if (!tw.article?.trim()) continue;
          const existing = bundle.tw.find((t) => t.path === tw.path);
          if (existing) existing.article = tw.article;
          else bundle.tw.push(tw);
        }
        if (bundle.tw.some((t) => t.article?.trim())) {
          const disclosure = `Translation Words article not available in "${language}"; showing English.`;
          bundle.dataWarning = bundle.dataWarning
            ? `${bundle.dataWarning} ${disclosure}`
            : disclosure;
          // Re-emit UI now that we have article bodies.
          if (opts.emit?.ui && !intentResult.reference) {
            componentsEmitted += emitArticleOnlyComponents(bundle, opts.emit);
          }
        }
      }
    }

    // 9c. Word-study miss: article locate/fetch returned nothing — answer honestly
    //     instead of letting the LLM invent a dictionary entry.
    if (
      plan.intent === "word_study" &&
      !bundle.tw.some((t) => Boolean(t.article?.trim()))
    ) {
      const termLabel = intentResult.term?.trim() || "that term";
      const honest = language.toLowerCase().startsWith("es")
        ? `No hay un artículo de palabras clave (Translation Words) en \`${language}\` para **${termLabel}**. ` +
          `Sigamos con la nota y el texto simplificado (GST) en el panel. ` +
          `¿Qué parte de esa palabra te cuesta traducir?`
        : `I couldn't retrieve a Translation Words article for **${termLabel}**. ` +
          `It may be filed under a different catalog name, or unavailable in this language. ` +
          `Let's stay with the note and simplified text in the panel. What feels hard about this term?`;
      if (opts.emit?.token) {
        for (const word of honest.split(/(\s+)/)) opts.emit.token(word);
      }
      return {
        response: honest,
        citations: [],
        intent: plan.intent,
        mode: "compose",
        dataWarning: `No TW article retrieved for "${termLabel}".`,
        toolCalls: [...this.traceLog],
      };
    }

    // 10. Apply budget caps (passage_help and all other intents).
    //     Pin a clicked checklist item (or PANEL STATE focusHint) first so its
    //     body survives the cap and stays available for grounding.
    const panelFocusHint =
      plan.intent === "checking" && !checkItemMarker
        ? parseFocusHintFromStudyContext(opts.studyContext)
        : null;
    const pinKind = checkItemMarker?.kind ?? panelFocusHint?.kind;
    const pinId = checkItemMarker?.resourceId ?? panelFocusHint?.id;
    const focusedForBudget =
      plan.intent === "checking" && pinKind && pinId
        ? pinFocusedCheckItem(bundle, pinKind, pinId)
        : bundle;
    const budgetBefore =
      focusedForBudget.notes.length +
      focusedForBudget.tw.length +
      focusedForBudget.ta.length +
      (focusedForBudget.tq?.length ?? 0);
    const budgeted = applyBudget(focusedForBudget);
    const budgetAfter =
      budgeted.notes.length +
      budgeted.tw.length +
      budgeted.ta.length +
      (budgeted.tq?.length ?? 0);
    opts.emit?.trace?.({
      type: "budget",
      before: budgetBefore,
      after: budgetAfter,
      dropped: budgetBefore - budgetAfter,
    });

    // 11. Compose prompt (intent-specific) and generate
    opts.emit?.status("Composing answer…");
    // Only tell the LLM the workbench is active when components were actually
    // emitted this turn — prevents the LLM from referencing non-existent cards.
    // Checklist-item click: focus the checking prompt on exactly that item
    // (semantic-range probing; revisit acknowledgment for completed items)
    // and inject the focused note/TW/TQ body so coaching cannot invent beyond it.
    // Soft fallback: PANEL STATE focusHint body when there is no CHECKITEM click.
    const checkItemFocus =
      plan.intent === "checking"
        ? buildCheckItemFocus(message, opts.studyContext, budgeted) ||
          buildPanelFocusResourceHint(opts.studyContext, budgeted)
        : "";
    const systemPrompt = buildSystemPrompt(
      budgeted,
      intentResult,
      componentsEmitted > 0,
      langPair,
      this.workflowMode,
      opts.studyContext,
      checkItemFocus,
    );
    // Deterministic EN-TW disclosure prefix (do not rely solely on the LLM).
    const twEnPrefix =
      plan.intent === "word_study" &&
      bundle.dataWarning &&
      /usando|English|showing English|using English/i.test(bundle.dataWarning)
        ? language.toLowerCase().startsWith("es")
          ? `> ${bundle.dataWarning}\n\n`
          : `> ${bundle.dataWarning}\n\n`
        : "";
    const pacedBudget = wordBudgetForIntent(plan.intent);
    const genOpts =
      pacedBudget != null
        ? { maxTokens: maxTokensForWordBudget(pacedBudget) }
        : undefined;

    // For paced (long-help) intents: generate fully → enforce word budget →
    // then emit tokens. Matches annotated_passage so the user never sees a
    // multi-page dump that is later truncated.
    let response: string;
    if (pacedBudget != null) {
      const raw = await this.llm.generate(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        genOpts,
      );
      const paced = enforceReplyBudget(raw, {
        budget: pacedBudget,
        language,
        closerKind: closerKindForIntent(plan.intent),
      });
      response = twEnPrefix + paced.text;
      if (opts.emit?.token) {
        for (const word of response.split(/(\s+)/)) opts.emit.token(word);
      }
    } else if (plan.intent === "checking") {
      // Checking pedagogy: exactly ONE probe question per turn. Prompt-only
      // rules don't hold, so generate fully → keep only up to the first
      // question → then emit tokens (never stream a reply that gets cut).
      const raw = await this.llm.generate([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ]);
      response = twEnPrefix + truncateAtFirstQuestion(raw).text;
      if (opts.emit?.token) {
        for (const word of response.split(/(\s+)/)) opts.emit.token(word);
      }
    } else if (opts.emit && this.llm.generateStream) {
      if (twEnPrefix) opts.emit.token(twEnPrefix);
      const chunks: string[] = [];
      for await (const delta of this.llm.generateStream([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ])) {
        opts.emit.token(delta);
        chunks.push(delta);
      }
      response = twEnPrefix + chunks.join("");
    } else {
      if (twEnPrefix && opts.emit?.token) opts.emit.token(twEnPrefix);
      response =
        twEnPrefix +
        (await this.llm.generate([
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ]));
    }

    // Non-paced streaming paths skip enforceReplyBudget — still drop English
    // prompt scaffolding that models sometimes echo. (Checking replies were
    // already stripped + first-question-truncated above.)
    if (pacedBudget == null && plan.intent !== "checking") {
      response = stripCoachScaffoldLabels(response);
    }

    const citations = collectCitations(budgeted);
    const mode: HarnessResult["mode"] =
      bundle.metadata.cacheStatus !== "miss" || citations.length > 0
        ? "compose"
        : "training-only";

    // 12. Append batch-progress marker + natural closing question
    let nextBatch: string | undefined;
    if (plan.intent === "passage_help" && intentResult.reference) {
      const parsed = parseReferenceForTool(intentResult.reference);
      if (parsed?.verseEnd) {
        // Only when we are working through a verse range (batch mode)
        const next = nextBatchRef(intentResult.reference);
        if (next) {
          nextBatch = next;
          response +=
            `\n\n${batchContinuePhrase(language, next)}` +
            `\n${buildBatchMarker(next)}`;
        }
      }
    }

    // Sticky checking session footer so validation replies stay on Path checking.
    if (plan.intent === "checking" && intentResult.reference) {
      response = ensureCheckingSessionFooter(response, intentResult.reference);
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
    // Wrap callTool so every agentic tool invocation emits X-ray tool_call traces.
    const tracedCallTool: CallToolFn = (tool, params) =>
      this.safeCallTool(tool, params);
    const result = await runAgenticLoop(
      message,
      language,
      this.llm,
      tracedCallTool,
      this.conversationHistory as Array<{
        role: "user" | "assistant" | "system";
        content: string;
      }>,
      this.targetLanguage || undefined,
    );
    return {
      ...result,
      intent: intentResult.intent,
      toolCalls: [...this.traceLog],
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
    language: string,
  ): Promise<HarnessResult> {
    const isLastStep = nextStep >= totalSteps;
    const lang = language?.trim() || "en";

    const systemPrompt = `You are a Bible translation consultant leading a structured lesson — consult with CANA questions, don't lecture or grade unknown receptor-language form.

The conversation history contains a checklist of ${totalSteps} steps and the full analysis.
Your job is to present **Step ${nextStep}** now.

LANGUAGE: Write ALL human-readable text in the user's study language (${lang}).
Keep these checklist tokens EXACTLY as written (parsed by the app): ☐ N.  ✅
Do NOT write [Step N/M] footers, "say next", "di next", or any keyword instructions.

Rules:
- Find the ☐ ${nextStep}. item in the checklist.
- Present it fully in **80–120 words** — direct, actionable, concrete — in ${lang}.
- Point to panel resources when relevant; do not re-dump the full passage or all notes.
- Update the checklist display: mark steps 1–${nextStep - 1} as ✅, show **☐ ${nextStep}.** as bold/active, leave ☐ ${nextStep + 1}${nextStep + 1 <= totalSteps ? "–" + totalSteps : ""} as is.
- End with exactly ONE consultant question — in ${lang}:
  ${
    isLastStep
      ? `- Ask how they would render a key source item, what feels hard, invite a draft in Mi traducción, or pick a section/verse (no keyword).`
      : `- Name what comes next (e.g. the title of step ${nextStep + 1}), or ask what's hard / how they'd translate a flagged phrase / invite a draft, so they can reply naturally ("ok", "vamos", "la sección 2", etc.).`
  }

Do NOT repeat the step content from earlier turns. Present only this step's material.
Do NOT rewrite a full model translation unless they explicitly ask.
Keep it SHORT. Quality over quantity.`;

    const messages: ConversationMessage[] = [
      ...history,
      { role: "user", content: `Continue with step ${nextStep}` },
    ];

    let response = await this.llm.generate([
      { role: "system", content: systemPrompt },
      ...messages,
    ]);

    // Strip any legacy visible footers the model may still emit; inject hidden marker.
    response = normalizeChecklistFooter(response, nextStep, totalSteps);
    if (!/<!-- CHECKLIST:\d+\/\d+ -->/.test(response)) {
      response =
        response.replace(/\s+$/, "") +
        `\n${buildChecklistMarker(nextStep, totalSteps)}`;
    }
    if (
      isLastStep &&
      !/[¿?]\s*$/.test(response.replace(/<!--[\s\S]*?-->/g, "").trim())
    ) {
      response =
        response.replace(/<!-- CHECKLIST:[\s\S]*?-->/, "").replace(/\s+$/, "") +
        `\n\n${checklistCompletePhrase(lang)}\n${buildChecklistMarker(nextStep, totalSteps)}`;
    }

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
    const challenges = extractChallengesFromHistory(history) as
      | Challenge[]
      | null;
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
    if (
      challenge.supportReference &&
      challenge.supportReference.includes("ta/man")
    ) {
      const taPath = challenge.supportReference
        .replace(/^rc:\/\/\*\/ta\/man\//, "")
        .replace(/^rc:\/\/[^/]+\/ta\/man\//, "");
      fetches.push(
        this.safeCallTool("get_academy_article", { path: taPath, language }),
      );
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
      const quoteLine = challenge.rawQuote
        ? `\nOriginal-language quote this note covers: "${challenge.rawQuote}"`
        : "";
      contextParts.push(
        `TRANSLATION NOTE (verbatim):\n${challenge.rawNoteText}${quoteLine}`,
      );
    } else if (challenge.noteText) {
      contextParts.push(`TRANSLATION NOTE SUMMARY:\n${challenge.noteText}`);
    }

    // 3. Alternate Translation suggested by the note
    if (challenge.at) {
      contextParts.push(
        `ALTERNATE TRANSLATION suggested by the note: "${challenge.at}"`,
      );
    }

    // 4. Simplified Text (UST/GST) rendering of the same verse — shows the meaning shift
    if (ustVerseText) {
      contextParts.push(
        `SIMPLIFIED TEXT (UST/GST) rendering of v.${challenge.verse}:\n${ustVerseText}`,
      );
    }

    // 5. Translation Word definition article (key-term drills)
    if (twArticle) {
      contextParts.push(
        `TRANSLATION WORD DEFINITION:\n${twArticle.slice(0, 1200)}`,
      );
    }

    // 6. Translation Academy principle article (strategy/figure-of-speech drills)
    if (taArticle) {
      contextParts.push(
        `TRANSLATION ACADEMY ARTICLE:\n${taArticle.slice(0, 1500)}`,
      );
    }

    const systemPrompt = formatDrillSystem(challenge, language);
    const userMessage = contextParts.join("\n\n---\n\n");

    // Include the recent conversation so the LLM can see the annotated passage
    // (with GLT/UST texts) and continue the thread naturally.
    const recentHistory = history.slice(-6) as Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }>;

    const drillBudget = CHAT_WORD_BUDGETS.phrase_drill;
    const rawResponse = await this.llm.generate(
      [
        { role: "system", content: systemPrompt },
        ...recentHistory,
        { role: "user", content: userMessage },
      ],
      { maxTokens: maxTokensForWordBudget(drillBudget) },
    );
    const paced = enforceReplyBudget(rawResponse, {
      budget: drillBudget,
      language,
      closerKind: "drill",
    });

    const citations: Array<{ path: string; title?: string }> = [];
    if (challenge.wordPath)
      citations.push({ path: challenge.wordPath, title: challenge.phrase });
    if (challenge.supportReference)
      citations.push({ path: challenge.supportReference });

    // Append a hidden marker so the next turn can detect the active phrase-drill
    // session even after the original CHALLENGES comment has scrolled beyond
    // the hasActivePassageSession look-back window.
    const drillMarker = `\n<!-- PHRASE_DRILL:${challengeIndex}/${challenges?.length ?? 0} -->`;

    // Emit phrase_drill UI component so the workbench shows the focused drill card.
    if (this.emit?.ui && challenge) {
      this.emit.ui({
        type: "phrase_drill",
        challenge,
        noteText: challenge.rawNoteText ?? challenge.noteText ?? "",
        atSuggestion: challenge.at,
      });
      this.emit.trace?.({ type: "ui_emit", componentType: "phrase_drill" });
    }

    if (this.emit?.token) {
      for (const word of paced.text.split(/(\s+)/)) this.emit.token(word);
    }

    return {
      response: paced.text + drillMarker,
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
      const ms = Date.now() - start;
      const summary = summarizeResult(tool, result);
      const resultSnapshot = snapshotResult(result);
      this.traceLog.push({
        tool,
        params,
        latencyMs: ms,
        ok: true,
        summary,
        resultSnapshot,
      });
      this.emit?.trace?.({
        type: "tool_call",
        name: tool,
        params,
        summary,
        resultSnapshot,
        ms,
        ok: true,
      });
      return result;
    } catch (e) {
      const ms = Date.now() - start;
      const error = e instanceof Error ? e.message : String(e);
      this.traceLog.push({
        tool,
        params,
        latencyMs: ms,
        ok: false,
        error,
      });
      this.emit?.trace?.({
        type: "tool_call",
        name: tool,
        params,
        ms,
        ok: false,
        error,
      });
      return null;
    }
  }

  private async parallelFetch(specs: ToolCallSpec[]): Promise<unknown[]> {
    const results = await Promise.allSettled(
      specs.map((s) =>
        this.safeCallTool(s.tool, s.params as Record<string, unknown>),
      ),
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
    if (m?.[1])
      return m[1]
        .trim()
        .replace(/<!--.*?-->/gs, "")
        .trim();
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
        const versions =
          (r["versions"] as Array<{
            resourceType: string;
            role: string;
            text: string;
            source?: string;
          }>) ?? [];
        if (versions.length > 0) {
          bundle.metadata.reference = String(
            (spec.params as Record<string, unknown>).reference ?? "",
          );
          // Capture effective language in case the server resolved a variant
          if (r["language"])
            bundle.metadata.effectiveLanguage = String(r["language"]);
          bundle.scripture = { versions: versions as never, format: "plain" };

          // Defense-in-depth: if every version is the original language (Greek/Hebrew),
          // the requested language has no translation available.
          // Leave bundle.scriptures EMPTY in that case so the English fallback at
          // step 6b (bundle.scriptures.length === 0) can fire. Without this guard,
          // original-language versions would populate bundle.scriptures and the
          // fallback would never trigger, leaving the user with only Greek/Hebrew.
          const allOriginal = versions.every((v) => v.role === "original");
          if (allOriginal) {
            bundle.dataWarning =
              "No scripture translation found for the selected language. " +
              "Showing original language text (Greek/Hebrew) only.";
            // bundle.scriptures intentionally left empty — fallback will populate it.
          } else {
            for (const v of versions) {
              if (
                !bundle.scriptures.some(
                  (s) => s.resourceType === v.resourceType,
                )
              ) {
                bundle.scriptures.push({
                  resourceType: v.resourceType,
                  label:
                    SCRIPTURE_LABELS[v.resourceType] ??
                    ROLE_LABELS[v.role] ??
                    v.resourceType.toUpperCase(),
                  text: v.text,
                  format: "plain",
                });
              }
            }
          }
        }
        break;
      }

      case "get_note": {
        // Returns: { reference, notes[] } — full note bodies (same shape as fetch_translation_notes)
        const r = data as Record<string, unknown>;
        const notes = (r["notes"] as unknown[]) ?? [];
        bundle.metadata.reference = String(
          r["reference"] ??
            (spec.params as Record<string, unknown>).reference ??
            "",
        );
        for (const n of notes) {
          const note = n as Record<string, unknown>;
          if (
            !bundle.notes.some(
              (existing) => existing.id === String(note["id"] ?? ""),
            )
          ) {
            bundle.notes.push({
              id: String(note["id"] ?? ""),
              text: String(note["note"] ?? ""),
              quote: note["quote"] ? String(note["quote"]) : undefined,
              gatewayQuote: extractGatewayQuote(note["gatewayQuote"]),
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
        const path = String(
          r["path"] ?? (spec.params as Record<string, unknown>).path ?? "",
        ).replace(/\/[^/]+\.md$/, ""); // strip .md suffix if present
        const article = String(r["article"] ?? "");
        if (article && path) {
          const existing = bundle.tw.find(
            (t) => t.path === path || path.includes(t.path),
          );
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
        const path = String(
          r["path"] ?? (spec.params as Record<string, unknown>).path ?? "",
        ).replace(/\/[^/]+\.md$/, "");
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

      case "get_passage_context": {
        // Returns: { reference, context[], availability? } — book/chapter intros
        const ref = String(
          (data as Record<string, unknown>)["reference"] ??
            (spec.params as Record<string, unknown>).reference ??
            "",
        );
        const parsed = parsePassageContextPayload(data, ref);
        if (parsed && parsed.notes.length > 0) {
          bundle.passageContext = parsed;
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
    if (
      (first?.["type"] === "text" || typeof first?.["text"] === "string") &&
      typeof first["text"] === "string"
    ) {
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
    "results" in obj ||
    "issues" in obj ||
    "keyTerms" in obj ||
    "availability" in obj ||
    "context" in obj
  ) {
    return obj;
  }
  return null;
}

/** Normalize a get_passage_context payload into bundle.passageContext shape. */
function parsePassageContextPayload(
  data: Record<string, unknown>,
  fallbackReference: string,
): NonNullable<EnrichedBundle["passageContext"]> | undefined {
  const context = data["context"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(context) || context.length === 0) return undefined;

  const notes = context
    .map((n, index) => {
      const noteText = String(
        n["note"] ?? n["noteText"] ?? n["body"] ?? n["text"] ?? "",
      )
        .trim()
        .replace(/\\n/g, "\n")
        .replace(/<br\s*\/?>/gi, "\n");
      if (!noteText) return null;
      const scope: "book" | "chapter" =
        n["scope"] === "book" || String(n["chapter"] ?? "") === "front"
          ? "book"
          : "chapter";
      const titleRaw = n["title"] ? String(n["title"]).trim() : "";
      return {
        id: String(n["id"] ?? `intro-${scope}-${index}`).trim(),
        scope,
        ...(titleRaw ? { title: titleRaw } : {}),
        noteText,
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);

  if (notes.length === 0) return undefined;

  const reference = String(data["reference"] ?? fallbackReference ?? "").trim();
  const availabilityRaw = data["availability"] as
    | Array<Record<string, unknown>>
    | undefined;
  const availability = Array.isArray(availabilityRaw)
    ? availabilityRaw.map((a) => ({
        type: String(a["type"] ?? ""),
        abbreviation: a["abbreviation"] ? String(a["abbreviation"]) : undefined,
        subject: a["subject"] ? String(a["subject"]) : undefined,
        role: a["role"] ? String(a["role"]) : undefined,
      }))
    : undefined;

  return {
    reference,
    scope: inferPassageContextScope(reference),
    notes,
    ...(availability && availability.length > 0 ? { availability } : {}),
  };
}

/** Extract passage context from a raw tool response (MCP-wrapped or direct). */
function extractPassageContextBundle(
  raw: unknown,
  fallbackReference = "",
): NonNullable<EnrichedBundle["passageContext"]> | undefined {
  const data = extractPayload(raw);
  if (!data) return undefined;
  return parsePassageContextPayload(data, fallbackReference);
}

/**
 * Build a passage_context UIComponent from a successful get_passage_context fetch.
 * Exported for unit tests.
 */
export function buildPassageContextComponent(
  reference: string,
  raw: unknown,
): Extract<UIComponent, { type: "passage_context" }> | null {
  const parsed = extractPassageContextBundle(raw, reference);
  if (!parsed || parsed.notes.length === 0) return null;
  return {
    type: "passage_context",
    reference: parsed.reference || reference,
    scope: parsed.scope,
    notes: parsed.notes,
    ...(parsed.availability ? { availability: parsed.availability } : {}),
  };
}

/**
 * Narrow a raw `gatewayQuote` field from the notes payload
 * (`{ original, aligned }` — see /api/v1/notes enrichment).
 * Returns undefined when absent/malformed so older KV-cached payloads
 * without the field degrade gracefully.
 */
function extractGatewayQuote(
  raw: unknown,
): { original?: string; aligned?: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const gq = raw as Record<string, unknown>;
  const original =
    typeof gq["original"] === "string" ? gq["original"] : undefined;
  const aligned = typeof gq["aligned"] === "string" ? gq["aligned"] : undefined;
  if (original === undefined && aligned === undefined) return undefined;
  return { original, aligned };
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
  language: string,
): ToolCallSpec[] {
  if (!searchResult || typeof searchResult !== "object") return [];
  // Prefer payload unwrap (MCP content[] / structuredContent) so catalog hits
  // are not missed when search_articles is wrapped.
  const r =
    extractPayload(searchResult) ?? (searchResult as Record<string, unknown>);
  const results = (r["results"] ??
    (searchResult as Record<string, unknown>)["results"]) as
    | Array<{ path: string; resourceType: "ta" | "tw"; title: string }>
    | undefined;
  if (!results?.length) return [];

  const lang = language || String(r["language"] ?? "en");
  const specs: ToolCallSpec[] = [];
  for (const hit of results.slice(0, 3)) {
    if (hit.resourceType === "ta" || intent === "methodology") {
      specs.push({
        tool: "get_academy_article",
        params: { path: hit.path, language: lang },
      });
    } else if (hit.resourceType === "tw" || intent === "word_study") {
      specs.push({
        tool: "get_word_article",
        params: { path: hit.path, language: lang },
      });
    }
  }
  return specs;
}

/**
 * Emit TW / TA article cards when there is no passage reference
 * (e.g. standalone word_study or methodology).
 */
function emitArticleOnlyComponents(
  bundle: EnrichedBundle,
  emit: HarnessEmit,
): number {
  if (!emit.ui) return 0;
  let count = 0;

  const wordsWithArticles = bundle.tw.filter((t) => t.article?.trim());
  if (wordsWithArticles.length > 0) {
    emit.ui({
      type: "translation_words",
      reference: wordsWithArticles[0].title || wordsWithArticles[0].path,
      words: wordsWithArticles.map((w) => ({
        id: w.id,
        term: w.title,
        definition: w.article ? w.article.slice(0, 2000) : undefined,
        verse: w.verse,
        origWords: w.origWords,
        wordPath: w.wordPath ?? w.path,
      })),
    });
    emit.trace?.({ type: "ui_emit", componentType: "translation_words" });
    count++;
  }

  for (const ta of bundle.ta.filter((a) => a.article?.trim()).slice(0, 1)) {
    emit.ui({
      type: "academy_article",
      path: ta.path,
      title: ta.title,
      markdown: ta.article ?? "",
      language: bundle.metadata.effectiveLanguage,
    });
    emit.trace?.({ type: "ui_emit", componentType: "academy_article" });
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// UI component emission helper
// ---------------------------------------------------------------------------

/** Original-language scripture resource labels (rendered RTL, distinct styling). */
const ORIGINAL_SCRIPTURE_LABELS = new Set(["UGNT", "UHB"]);

/**
 * Emit structured UIComponents for the resource workbench from an assembled bundle.
 *
 * Emits:
 *   - `scripture_text`        — rich tabbed scripture viewer (all fetched versions)
 *   - `passage_context`       — book/chapter intro notes (retained across drills)
 *   - `translation_notes`     — TN entries with quotes, categories, TA links (skippable)
 *   - `translation_words`     — TW key-term definitions
 *   - `translation_questions` — TQ comprehension questions
 *
 * Called before LLM generation so the right-panel workbench populates while the
 * explanation text is still streaming in the left panel.
 */
function emitBundleComponents(
  bundle: EnrichedBundle,
  reference: string,
  emit: HarnessEmit,
  opts: { skipNotes?: boolean; highlightPhrase?: string } = {},
): number {
  if (!emit.ui) return 0;
  let count = 0;

  // scripture_text — tabbed scripture panel with RTL support
  if (bundle.scriptures.length > 0) {
    emit.ui({
      type: "scripture_text",
      reference,
      versions: bundle.scriptures.map((s) => ({
        label: s.label,
        text: s.text,
        direction: ORIGINAL_SCRIPTURE_LABELS.has(s.label) ? "rtl" : "ltr",
        resourceType: s.resourceType,
      })),
      highlightPhrase: opts.highlightPhrase,
    });
    emit.trace?.({ type: "ui_emit", componentType: "scripture_text" });
    count++;
  }

  // passage_context — book/chapter orientation (distinct from verse TN)
  if (bundle.passageContext && bundle.passageContext.notes.length > 0) {
    emit.ui({
      type: "passage_context",
      reference: bundle.passageContext.reference || reference,
      scope: bundle.passageContext.scope,
      notes: bundle.passageContext.notes,
      ...(bundle.passageContext.availability
        ? { availability: bundle.passageContext.availability }
        : {}),
    });
    emit.trace?.({ type: "ui_emit", componentType: "passage_context" });
    count++;
  }

  // translation_notes — skip when challenge_cards covers them (annotated_passage)
  if (!opts.skipNotes && bundle.notes.length > 0) {
    emit.ui({
      type: "translation_notes",
      reference,
      notes: bundle.notes.map((n) => ({
        id: n.id,
        quote: n.quote,
        gatewayQuote: n.gatewayQuote,
        noteText: n.text,
        supportReference: n.supportReference,
        verse: n.verse,
      })),
    });
    emit.trace?.({ type: "ui_emit", componentType: "translation_notes" });
    count++;
  }

  // translation_words — key terms (include even without articles for basic listing)
  const wordsToEmit = bundle.tw.filter((t) => t.title);
  if (wordsToEmit.length > 0) {
    emit.ui({
      type: "translation_words",
      reference,
      words: wordsToEmit.map((w) => ({
        id: w.id,
        term: w.title,
        definition: w.article ? w.article.slice(0, 500) : undefined,
        verse: w.verse,
        origWords: w.origWords,
        wordPath: w.wordPath,
      })),
    });
    emit.trace?.({ type: "ui_emit", componentType: "translation_words" });
    count++;
  }

  // translation_questions — comprehension checks
  if (bundle.tq && bundle.tq.length > 0) {
    emit.ui({
      type: "translation_questions",
      reference,
      questions: bundle.tq.map((q) => ({
        id: q.id,
        question: q.question,
        response: q.response,
        verse: q.verse,
      })),
    });
    emit.trace?.({ type: "ui_emit", componentType: "translation_questions" });
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  bundle: EnrichedBundle,
  intentResult: IntentResult,
  hasUiSupport = false,
  langPair?: ReturnType<typeof resolveLanguagePair>,
  workflowMode: WorkflowMode = DEFAULT_WORKFLOW_MODE,
  studyContext?: string,
  checkItemFocus?: string,
): string {
  const context = renderEnrichedBundle(bundle);
  const intentBlock = intentSystemFragment(intentResult.intent);
  const modeBias = workflowModePromptBias(workflowMode);

  // When UI components are active the frontend already displays the
  // scripture text, translation notes, and key terms as structured cards.
  // Instruct the LLM not to dump the full passage — but still ground coaching
  // in the note/article bodies provided in the context / focus blocks below.
  const workbenchHint = hasUiSupport
    ? `\n\n## Important — Study resources are on screen
The user's screen shows the scripture passage (pinned header) and translation resources as interactive cards in the **resources side panel**.
Read the PANEL STATE block each turn (open/tab/counts/quiz/checklist/focusHint) and refer accurately to what is loaded.
Point them to the text/notes **in the panel** ("lee el texto en el panel…" / "read the text in the panel…") instead of re-dumping whole passages or listing every note.
Do NOT quote or reproduce the full scripture text in your response.
Do NOT dump a full list of all translation notes or key-term definitions — but DO ground coaching in the specific note/TW/TQ/TA bodies provided in the context or focused-resource block below (short quote or close paraphrase of *that* resource).
Do NOT invent panel content or translation principles that are absent from PANEL STATE / STUDY CONTEXT / the loaded resource bodies.
When focusHint / a focused resource body is present, stick to what that note or article says — never substitute a generic linguistics lecture (e.g. inventing abstract-noun advice).
If the loaded resources do not cover the user's question: say so briefly and offer to open/fetch the relevant panel note or article.
You cannot see Mi traducción draft text — never claim to have read their wording.
Coach with concise commentary, reference phrases by name, ask what feels hard, and invite drafts in **Mi traducción**.
Optional panel steer (hidden trailer only): \`<!-- PANEL:focus_tab:context -->\`, \`<!-- PANEL:highlight:note:<id> -->\`.`
    : "";

  const pairHint = langPair
    ? `\n\n## Language pair\n${languagePairPromptGuidance(langPair)}`
    : "";

  // Session state from the client — includes the Checking-checklist `[x]`/`[ ]`
  // lines and PANEL STATE. Critical for checking turns: probe only `[ ]` items.
  const studyHint = studyContext?.trim()
    ? `\n\n## STUDY CONTEXT (session state)\n${studyContext.trim()}\nChecklist lines starting with [x] are ALREADY validated — never re-ask those items. Probe only [ ] items. PANEL STATE describes the live resources panel — do not invent content missing from it. When focusHint names a note/term, ground this turn in that item's loaded body from the context below.`
    : "";

  // Single-item focus when the user clicked a Checking-checklist item.
  const focusHint = checkItemFocus?.trim()
    ? `\n\n${checkItemFocus.trim()}`
    : "";

  // Light checking-turn reinforcement (even without a CHECKITEM click).
  const checkingGroundHint =
    intentResult.intent === "checking"
      ? `\n\n## Checking turn — resource grounding
Walk the Checking checklist from loaded TN / TW / TQ only. Paraphrase what the loaded note or article says; do not invent translation principles or abstract-noun / grammar lectures from training data. If a focused resource body is present above, that body is authoritative for this turn.`
      : "";

  return `${SYSTEM_BASE}${workbenchHint}${pairHint}${studyHint}${focusHint}${checkingGroundHint}\n\n${modeBias}\n\n${intentBlock}\n\n${context}`;
}

function collectCitations(
  bundle: EnrichedBundle,
): Array<{ path: string; title?: string }> {
  const citations: Array<{ path: string; title?: string }> = [];

  // Cite each fetched scripture translation
  for (const s of bundle.scriptures ?? []) {
    citations.push({
      path: `scripture/${s.resourceType}/${bundle.metadata.reference}`,
      title: s.label,
    });
  }
  if (citations.length === 0 && bundle.scripture.versions?.length) {
    citations.push({
      path: `scripture/${bundle.metadata.reference}`,
      title: "Scripture",
    });
  }
  for (const note of bundle.notes.slice(0, 5)) {
    citations.push({
      path: `tn/${bundle.metadata.reference}/${note.id}`,
      title: "Translation Note",
    });
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
    const items = result
      .slice(0, 3)
      .map((item) => snapshotResult(item, depth + 1));
    return result.length > 3
      ? [...items, `…+${result.length - 3} more`]
      : items;
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
  const cache =
    r["meta"] && typeof r["meta"] === "object"
      ? String((r["meta"] as Record<string, unknown>)["cache"] ?? "")
      : "";
  const cacheTag = cache ? ` [${cache}]` : "";

  // New workflow tools
  if (tool === "get_passage") {
    const versions = r["versions"] as unknown[] | undefined;
    return versions?.length
      ? `${versions.length} version(s)${cacheTag}`
      : undefined;
  }
  if (tool === "get_passage_context") {
    const context = r["context"] as unknown[] | undefined;
    return context?.length !== undefined
      ? `${context.length} context note(s)${cacheTag}`
      : undefined;
  }
  if (tool === "get_note") {
    const notes = r["notes"] as unknown[] | undefined;
    return notes?.length !== undefined
      ? `${notes.length} note(s)${cacheTag}`
      : undefined;
  }
  if (tool === "get_passage_index") {
    const words = r["words"] as unknown[] | undefined;
    const notes = r["notes"] as unknown[] | undefined;
    return `${notes?.length ?? 0} note(s), ${words?.length ?? 0} word link(s)${cacheTag}`;
  }
  if (tool === "get_academy_article" || tool === "get_word_article") {
    const text = r["article"] as string | undefined;
    return text
      ? `${Math.round(text.length / 100) * 100} chars${cacheTag}`
      : undefined;
  }
  if (tool === "get_questions") {
    const qs = r["questions"] as unknown[] | undefined;
    return qs?.length !== undefined
      ? `${qs.length} question(s)${cacheTag}`
      : undefined;
  }

  if (tool === "search_articles") {
    const results = r["results"] as unknown[] | undefined;
    return results?.length !== undefined
      ? `${results.length} result(s)${cacheTag}`
      : undefined;
  }
  if (tool === "list_languages") {
    const langs = r["languages"] as unknown[] | undefined;
    return langs?.length !== undefined
      ? `${langs.length} language(s)`
      : undefined;
  }
  if (tool === "list_resources") {
    const resources = (r["available"] ?? r["resources"]) as
      | unknown[]
      | undefined;
    return resources?.length !== undefined
      ? `${resources.length} resource(s)`
      : undefined;
  }
  return undefined;
}

/** Localized natural continue question — no trigger keywords. */
function checklistContinuePhrase(language: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return "¿Seguimos con el siguiente paso, o prefieres empezar con una sección o unos versículos concretos?";
  }
  return "Shall we continue with the next step, or would you rather start with a specific section or verses?";
}

/** Localized "All steps complete" closing question. */
function checklistCompletePhrase(language: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  if (code === "es") {
    return "¡Listo con el recorrido! ¿Con qué sección o desafío quieres empezar a traducir?";
  }
  return "That's the full path! Which section or challenge would you like to start translating?";
}

/** Localized natural batch-continuation question. */
function batchContinuePhrase(language: string, nextRef: string): string {
  const code = language.trim().toLowerCase().split(/[-_]/)[0] ?? "en";
  const versePart = nextRef.includes(":")
    ? (nextRef.split(":")[1] ?? nextRef)
    : nextRef;
  if (code === "es") {
    return `¿Continuamos con los versículos ${versePart}?`;
  }
  return `Shall we continue with verses ${versePart}?`;
}

/**
 * Strip legacy visible [Step N/M] / [Paso N/M] footers (and trailing ---)
 * so session state can live in a hidden <!-- CHECKLIST --> marker instead.
 * `step`/`total` are unused except to keep the call site explicit.
 */
function normalizeChecklistFooter(
  text: string,
  _step?: number,
  _total?: number,
): string {
  let out = text;
  // Drop --- + *[Step N/M] — …* footers (and localized Step synonyms)
  out = out.replace(
    /\n*---\n*\*\[(?:Step|Paso|Étape|Etape)\s*\d+\s*\/\s*\d+\][^\n]*\*?\s*/gi,
    "\n",
  );
  // Drop bare *[Step N/M]…* lines without ---
  out = out.replace(
    /\n*\*\[(?:Step|Paso|Étape|Etape)\s*\d+\s*\/\s*\d+\][^\n]*\*?\s*/gi,
    "\n",
  );
  // Drop leftover hidden markers so caller can re-append a fresh one
  out = out.replace(/\n*<!-- CHECKLIST:\d+\/\d+ -->\s*/g, "\n");
  return out.replace(/\s+$/, "");
}
