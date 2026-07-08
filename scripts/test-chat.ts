#!/usr/bin/env npx tsx
/**
 * scripts/test-chat.ts
 *
 * CLI test harness for the /api/chat SSE endpoint.
 *
 * Usage:
 *   npx tsx scripts/test-chat.ts              # run all scenarios
 *   npx tsx scripts/test-chat.ts --judge      # enable LLM-as-judge evaluation
 *   npx tsx scripts/test-chat.ts --scenario 1 # run scenario by 1-based index
 *   npx tsx scripts/test-chat.ts --url http://localhost:9000  # custom base URL
 *
 * Requires the Vite dev server (port 8174) to be running:
 *   cd web && npm run dev
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChallengeItem {
  index: number;
  verse: string;
  phrase: string;
  noteText: string;
  category: string;
  sourceType?: "tn" | "tw";
  supportReference?: string;
  wordPath?: string;
  at?: string;
}

interface ToolCallTrace {
  tool: string;
  params: Record<string, unknown>;
  latencyMs: number;
  ok: boolean;
  error?: string;
  summary?: string;
  resultSnapshot?: unknown;
}

interface SseResult {
  /** All token deltas joined into the final assistant text */
  text: string;
  /** Tool calls from the done event */
  toolCalls: ToolCallTrace[];
  /** The full done payload */
  done: Record<string, unknown> | null;
  /** Error message if an error event was received */
  errorMessage: string | null;
  /** Language set via meta event */
  languageSet: string | null;
  /** All status lines received */
  statusLines: string[];
  /** Whether the stream ended with an error event */
  hadError: boolean;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface TurnAssertion {
  noError?: boolean;
  containsText?: string[];
  toolsCalled?: string[];
  noToolsCalled?: boolean;
  languageCode?: string;
  gracefulNoResource?: boolean;
  llmJudge?: string;
}

interface Turn {
  userMessage: string;
  /** Language to send with this turn (overrides scenario default) */
  language?: string;
  assertions?: TurnAssertion;
}

interface Scenario {
  name: string;
  description: string;
  /** Default language code for the scenario (default: 'en') */
  language?: string;
  /** Default model (default: 'gpt-4o-mini' for speed) */
  model?: string;
  turns: Turn[];
}

interface TurnResult {
  turn: number;
  userMessage: string;
  response: string;
  toolCalls: ToolCallTrace[];
  languageSet: string | null;
  hadError: boolean;
  errorMessage: string | null;
  assertions: AssertionResult[];
  durationMs: number;
}

interface AssertionResult {
  label: string;
  passed: boolean;
  detail?: string;
}

interface ScenarioResult {
  scenario: Scenario;
  turns: TurnResult[];
  passed: boolean;
  totalAssertions: number;
  passedAssertions: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const JUDGE_MODE = args.includes("--judge");
const BASE_URL_ARG = (() => {
  const idx = args.indexOf("--url");
  return idx !== -1 ? args[idx + 1] : null;
})();
const SCENARIO_FILTER = (() => {
  const idx = args.indexOf("--scenario");
  return idx !== -1 ? parseInt(args[idx + 1], 10) : null;
})();

const CHAT_URL = `${BASE_URL_ARG ?? "http://localhost:8174"}/api/chat`;
const TIMEOUT_MS = 90_000;
const DEFAULT_MODEL = "gpt-4o-mini"; // faster for testing

// ─────────────────────────────────────────────────────────────────────────────
// ANSI colours
// ─────────────────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function pass(s: string) {
  return `${c.green}✓${c.reset} ${s}`;
}
function fail(s: string) {
  return `${c.red}✗${c.reset} ${s}`;
}
function info(s: string) {
  return `${c.cyan}ℹ${c.reset} ${s}`;
}
function warn(s: string) {
  return `${c.yellow}⚠${c.reset} ${s}`;
}
function header(s: string) {
  return `${c.bold}${c.blue}${s}${c.reset}`;
}
function dim(s: string) {
  return `${c.dim}${s}${c.reset}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE client
// ─────────────────────────────────────────────────────────────────────────────

async function callChat(
  messages: ConversationMessage[],
  language: string,
  model: string,
): Promise<SseResult> {
  const result: SseResult = {
    text: "",
    toolCalls: [],
    done: null,
    errorMessage: null,
    languageSet: null,
    statusLines: [],
    hadError: false,
  };

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, language, model }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("abort")
    ) {
      throw new Error(
        `Cannot connect to ${CHAT_URL}\n` +
          `  Make sure the Vite dev server is running: cd web && npm run dev\n` +
          `  (Expected port: 8174)` +
          (msg.includes("abort") ? "\n  Request timed out after 90s." : ""),
      );
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} from ${CHAT_URL}: ${body.slice(0, 200)}`,
    );
  }

  if (!res.body) {
    throw new Error("No response body from /api/chat");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  const processFrame = (frame: string) => {
    const lines = frame.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (!data) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (event) {
      case "status":
        result.statusLines.push(String(parsed.text ?? ""));
        break;

      case "token":
        result.text += String(parsed.delta ?? "");
        break;

      case "meta":
        if (typeof parsed.setLanguage === "string") {
          result.languageSet = parsed.setLanguage;
        }
        break;

      case "done": {
        result.done = parsed;
        // Merge done.response into text if tokens were not streamed
        const doneResponse =
          typeof parsed.response === "string" ? parsed.response : "";
        if (!result.text && doneResponse) {
          // Strip hidden HTML markers before using as text
          result.text = doneResponse.replace(/<!--[\s\S]*?-->/g, "").trim();
        } else if (doneResponse) {
          // Append any hidden markers stripped version if text came via tokens
          // (preserves the display text as the token stream)
        }
        if (Array.isArray(parsed.toolCalls)) {
          result.toolCalls = parsed.toolCalls as ToolCallTrace[];
        }
        break;
      }

      case "error":
        result.hadError = true;
        result.errorMessage = String(parsed.message ?? "Unknown error");
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const frames = sseBuffer.split("\n\n");
    sseBuffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (frame.trim()) processFrame(frame);
    }
  }

  // Process any remaining buffer
  if (sseBuffer.trim()) processFrame(sseBuffer);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assertion runner
// ─────────────────────────────────────────────────────────────────────────────

function runAssertions(
  sseResult: SseResult,
  assertions: TurnAssertion | undefined,
): AssertionResult[] {
  if (!assertions) return [];
  const results: AssertionResult[] = [];

  if (assertions.noError !== undefined && assertions.noError) {
    results.push({
      label: "noError",
      passed: !sseResult.hadError,
      detail: sseResult.hadError
        ? `Got error: ${sseResult.errorMessage}`
        : undefined,
    });
  }

  if (assertions.containsText) {
    for (const needle of assertions.containsText) {
      const haystack = sseResult.text.toLowerCase();
      const found = haystack.includes(needle.toLowerCase());
      results.push({
        label: `containsText("${needle}")`,
        passed: found,
        detail: found
          ? undefined
          : `Not found in response (${sseResult.text.length} chars)`,
      });
    }
  }

  if (assertions.toolsCalled) {
    const calledNames = new Set(sseResult.toolCalls.map((t) => t.tool));
    for (const toolName of assertions.toolsCalled) {
      const found = calledNames.has(toolName);
      results.push({
        label: `toolCalled("${toolName}")`,
        passed: found,
        detail: found
          ? undefined
          : `Tool not called. Called: [${[...calledNames].join(", ")}]`,
      });
    }
  }

  if (assertions.noToolsCalled !== undefined && assertions.noToolsCalled) {
    const noCalls = sseResult.toolCalls.length === 0;
    results.push({
      label: "noToolsCalled",
      passed: noCalls,
      detail: noCalls
        ? undefined
        : `Expected no tools but got: [${sseResult.toolCalls.map((t) => t.tool).join(", ")}]`,
    });
  }

  if (assertions.languageCode !== undefined) {
    const got = sseResult.languageSet;
    const matches =
      got !== null &&
      got.toLowerCase() === assertions.languageCode.toLowerCase();
    results.push({
      label: `languageCode("${assertions.languageCode}")`,
      passed: matches,
      detail: matches
        ? undefined
        : `Expected language "${assertions.languageCode}", got "${got}"`,
    });
  }

  if (
    assertions.gracefulNoResource !== undefined &&
    assertions.gracefulNoResource
  ) {
    // Graceful = did not crash (no hadError) and produced a non-empty response
    const graceful = !sseResult.hadError && sseResult.text.trim().length > 10;
    results.push({
      label: "gracefulNoResource",
      passed: graceful,
      detail: graceful
        ? undefined
        : sseResult.hadError
          ? `Crashed with error: ${sseResult.errorMessage}`
          : `Response too short or empty (${sseResult.text.length} chars)`,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM-as-judge (optional)
// ─────────────────────────────────────────────────────────────────────────────

async function runLlmJudge(
  userMessage: string,
  response: string,
  judgePrompt: string,
): Promise<AssertionResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return {
      label: `llmJudge`,
      passed: false,
      detail: "OPENAI_API_KEY not set in environment — skipping LLM judge",
    };
  }

  try {
    const system = `You are a quality evaluator for a Bible translation assistant named Ezer.
Score the assistant's response from 1 to 5 based on the following criterion:
${judgePrompt}

Reply ONLY with JSON: {"score": <1-5>, "reason": "<brief explanation>"}`;

    const payload = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `User said: "${userMessage}"\n\nAssistant replied:\n${response.slice(0, 1500)}`,
        },
      ],
      max_tokens: 150,
      temperature: 0,
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) {
      return {
        label: "llmJudge",
        passed: false,
        detail: `Invalid JSON from judge: ${raw}`,
      };
    }
    const parsed = JSON.parse(match[0]) as { score?: number; reason?: string };
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    const passed = score >= 3;
    return {
      label: `llmJudge (score: ${score}/5)`,
      passed,
      detail: `${reason} [criterion: ${judgePrompt.slice(0, 80)}]`,
    };
  } catch (err) {
    return {
      label: "llmJudge",
      passed: false,
      detail: `Judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario runner
// ─────────────────────────────────────────────────────────────────────────────

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const history: ConversationMessage[] = [];
  const turnResults: TurnResult[] = [];
  const model = scenario.model ?? DEFAULT_MODEL;
  const scenarioLanguage = scenario.language ?? "en";

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const language = turn.language ?? scenarioLanguage;
    const startMs = Date.now();

    // Add the user message to history
    history.push({ role: "user", content: turn.userMessage });

    let sseResult: SseResult;
    try {
      sseResult = await callChat([...history], language, model);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const turnResult: TurnResult = {
        turn: i + 1,
        userMessage: turn.userMessage,
        response: "",
        toolCalls: [],
        languageSet: null,
        hadError: true,
        errorMessage: errMsg,
        assertions: [{ label: "connection", passed: false, detail: errMsg }],
        durationMs: Date.now() - startMs,
      };
      turnResults.push(turnResult);
      // If we can't connect, stop the scenario
      if (errMsg.includes("Cannot connect")) {
        break;
      }
      // Add a placeholder assistant message and continue
      history.push({ role: "assistant", content: `[ERROR: ${errMsg}]` });
      continue;
    }

    // Run synchronous assertions
    const assertions = runAssertions(sseResult, turn.assertions);

    // Run LLM judge if requested and enabled
    if (JUDGE_MODE && turn.assertions?.llmJudge) {
      const judgeResult = await runLlmJudge(
        turn.userMessage,
        sseResult.text,
        turn.assertions.llmJudge,
      );
      assertions.push(judgeResult);
    }

    // Determine assistant reply for history
    // Use tokens (sseResult.text) for display; use done.response for history
    // so hidden markers are preserved (they affect subsequent turn classification)
    const doneResponse =
      typeof sseResult.done?.response === "string"
        ? sseResult.done.response
        : sseResult.text;
    const assistantContent = doneResponse || sseResult.text;
    history.push({ role: "assistant", content: assistantContent });

    turnResults.push({
      turn: i + 1,
      userMessage: turn.userMessage,
      response: sseResult.text,
      toolCalls: sseResult.toolCalls,
      languageSet: sseResult.languageSet,
      hadError: sseResult.hadError,
      errorMessage: sseResult.errorMessage,
      assertions,
      durationMs: Date.now() - startMs,
    });
  }

  const totalAssertions = turnResults.reduce(
    (s, t) => s + t.assertions.length,
    0,
  );
  const passedAssertions = turnResults.reduce(
    (s, t) => s + t.assertions.filter((a) => a.passed).length,
    0,
  );

  return {
    scenario,
    turns: turnResults,
    passed: passedAssertions === totalAssertions,
    totalAssertions,
    passedAssertions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output printer
// ─────────────────────────────────────────────────────────────────────────────

function printScenarioResult(result: ScenarioResult, index: number) {
  const { scenario, turns } = result;
  const statusIcon = result.passed
    ? c.green + "●" + c.reset
    : c.red + "●" + c.reset;
  console.log(
    `\n${statusIcon} ${header(`Scenario ${index + 1}: ${scenario.name}`)}`,
  );
  console.log(dim(`  ${scenario.description}`));
  console.log();

  for (const t of turns) {
    console.log(
      `  ${c.bold}Turn ${t.turn}${c.reset} — ${c.cyan}User:${c.reset} ${t.userMessage}`,
    );
    console.log(`  ${c.dim}(${t.durationMs}ms)${c.reset}`);

    // Response excerpt
    const excerpt = t.response
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim()
      .slice(0, 300);
    if (excerpt) {
      console.log(
        `  ${c.magenta}Response:${c.reset} ${excerpt}${excerpt.length < t.response.length ? "…" : ""}`,
      );
    } else if (t.hadError) {
      console.log(`  ${c.red}Error:${c.reset} ${t.errorMessage}`);
    }

    // Tool calls
    if (t.toolCalls.length > 0) {
      const toolNames = t.toolCalls
        .map(
          (tc) =>
            `${tc.ok ? c.green : c.red}${tc.tool}${c.reset}(${tc.latencyMs}ms)`,
        )
        .join(", ");
      console.log(`  ${c.yellow}Tools:${c.reset} ${toolNames}`);
    }

    // Language set
    if (t.languageSet) {
      console.log(`  ${c.blue}Language set:${c.reset} ${t.languageSet}`);
    }

    // Assertions
    if (t.assertions.length > 0) {
      for (const a of t.assertions) {
        const line = a.passed ? pass(a.label) : fail(a.label);
        const detail = a.detail ? dim(` — ${a.detail}`) : "";
        console.log(`    ${line}${detail}`);
      }
    }
    console.log();
  }

  const { passedAssertions, totalAssertions } = result;
  if (totalAssertions > 0) {
    const bar = result.passed ? c.green : c.red;
    console.log(
      `  ${bar}Assertions: ${passedAssertions}/${totalAssertions} passed${c.reset}`,
    );
  } else {
    console.log(dim("  (no assertions defined for this scenario)"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  // ── 1. Greeting flow ─────────────────────────────────────────────────────
  {
    name: "Greeting flow",
    description:
      "Ezer should introduce himself and ask how to address the user.",
    language: "en",
    turns: [
      {
        userMessage: "Hello!",
        assertions: {
          noError: true,
          noToolsCalled: true,
          llmJudge:
            "Did the assistant introduce itself as Ezer or a Bible translation helper and ask for the user's name or how to address them?",
        },
      },
    ],
  },

  // ── 2. English passage request (with language gate) ───────────────────────
  {
    name: "English passage request",
    description:
      "User requests help with John 3:16 in English; system should trigger language gate then fetch passage with tool calls.",
    language: "en",
    turns: [
      {
        userMessage: "Help me translate John 3:16",
        assertions: {
          noError: true,
          // The language gate fires first and asks for language
          llmJudge:
            "Did the assistant ask what strategic language the user wants to use, OR did it provide Bible translation resources for John 3:16?",
        },
      },
      {
        // Answer the language gate
        userMessage: "English",
        assertions: {
          noError: true,
          languageCode: "en",
          llmJudge:
            "Did the assistant provide information about John 3:16 to help with translation (e.g., notes, explanations, or structured passage data)?",
        },
      },
    ],
  },

  // ── 3. Spanish (es-419) passage request ───────────────────────────────────
  {
    name: "Spanish (es-419) passage request",
    description:
      "User asks in Spanish; language gate should resolve to es-419 and fetch Spanish resources.",
    language: "es",
    turns: [
      {
        userMessage: "Ayúdame a traducir Juan 3:16",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant ask what strategic language the user wants to use, or did it provide translation resources for Juan 3:16 in Spanish?",
        },
      },
      {
        userMessage: "Español",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant provide Spanish-language translation notes, key terms, or passage information for Juan 3:16?",
        },
      },
    ],
  },

  // ── 4. Language with no resources (Swahili) ───────────────────────────────
  {
    name: "Language with no resources (Swahili)",
    description:
      "Request a passage in Swahili (sw) — a language likely without TN/TW resources. System must handle gracefully.",
    language: "sw",
    turns: [
      {
        userMessage: "Help me translate John 3:16",
        assertions: {
          noError: true,
        },
      },
      {
        userMessage: "Swahili",
        assertions: {
          noError: true,
          gracefulNoResource: true,
          llmJudge:
            "Did the assistant handle the lack of Swahili resources gracefully, either by acknowledging unavailability or falling back to English/available resources, without crashing?",
        },
      },
    ],
  },

  // ── 5. Open-ended follow-up (What is metonymy?) ───────────────────────────
  {
    name: "Open-ended follow-up (metonymy)",
    description:
      "After a passage context, user asks a conceptual translation question.",
    language: "en",
    turns: [
      {
        userMessage: "Help me translate John 3:16",
        assertions: { noError: true },
      },
      {
        userMessage: "English",
        assertions: { noError: true },
      },
      {
        userMessage: "What is metonymy?",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant explain what metonymy is (a figure of speech where one thing is referred to by the name of something associated with it)?",
        },
      },
    ],
  },

  // ── 6. Phrase drill flow ──────────────────────────────────────────────────
  {
    name: "Phrase drill flow",
    description:
      "Start with a passage, then drill into a specific challenge phrase by sending its index.",
    language: "en",
    turns: [
      {
        userMessage: "Help me translate John 3:16",
        assertions: { noError: true },
      },
      {
        userMessage: "English",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant provide an annotated passage with numbered translation challenges or notes for John 3:16?",
        },
      },
      {
        // Drill into challenge #1 — the drill command is just the number
        userMessage: "1",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant explain a specific translation challenge phrase from John 3:16 in detail?",
        },
      },
    ],
  },

  // ── 7. Conversation continuation (after drill) ────────────────────────────
  {
    name: "Conversation continuation after phrase drill",
    description:
      "After a phrase drill response, ask a follow-up conceptual question.",
    language: "en",
    turns: [
      {
        userMessage: "Help me translate John 3:16",
        assertions: { noError: true },
      },
      {
        userMessage: "English",
        assertions: { noError: true },
      },
      {
        userMessage: "1",
        assertions: { noError: true },
      },
      {
        userMessage: "Why does that matter for translation?",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant give a substantive answer about why that phrase or concept matters for Bible translation, rather than just greeting or asking what passage to discuss?",
        },
      },
    ],
  },

  // ── 8. Rare OT book / language combo ─────────────────────────────────────
  {
    name: "Rare OT book in French",
    description:
      "Request translation help for Obadiah (a short, rarely resourced OT book) in French (fr). Should handle any missing resources gracefully.",
    language: "fr",
    turns: [
      {
        userMessage: "Help me translate Obadiah 1:1",
        assertions: { noError: true },
      },
      {
        userMessage: "French",
        assertions: {
          noError: true,
          gracefulNoResource: true,
          llmJudge:
            "Did the assistant either provide French-language resources for Obadiah, or gracefully explain that resources may be limited, without crashing?",
        },
      },
    ],
  },

  // ── 9. Word study query ───────────────────────────────────────────────────
  {
    name: 'Word study — "grace"',
    description:
      "User asks for the biblical meaning of a key term without a specific reference.",
    language: "en",
    turns: [
      {
        userMessage: 'What does the word "grace" mean in biblical context?',
        assertions: {
          noError: true,
          llmJudge:
            'Did the assistant provide a meaningful explanation of the biblical concept of "grace" (charis/hen), mentioning unmerited favour or similar theological content?',
        },
      },
    ],
  },

  // ── 10. Batch continuation ("next") ──────────────────────────────────────
  {
    name: 'Batch continuation with "next"',
    description:
      'Request a multi-verse passage (John 3 whole chapter) then say "next" to continue to the next batch.',
    language: "en",
    turns: [
      {
        userMessage: "Help me translate John 3",
        assertions: { noError: true },
      },
      {
        userMessage: "English",
        assertions: {
          noError: true,
          llmJudge:
            'Did the assistant provide an annotated passage for John 3 verses, either partially or fully, possibly with a "next" prompt to continue?',
        },
      },
      {
        userMessage: "next",
        assertions: {
          noError: true,
          llmJudge:
            "Did the assistant continue to the next set of verses from John 3, or indicate there are no more batches?",
        },
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    header("\n╔═══════════════════════════════════════════════════════╗"),
  );
  console.log(
    header("║        Translation Helps Chat — Test Harness           ║"),
  );
  console.log(
    header("╚═══════════════════════════════════════════════════════╝"),
  );
  console.log();
  console.log(info(`Endpoint: ${CHAT_URL}`));
  console.log(info(`Model:    ${DEFAULT_MODEL}`));
  console.log(
    info(
      `Judge:    ${JUDGE_MODE ? "enabled (--judge)" : "disabled (add --judge to enable)"}`,
    ),
  );
  console.log(info(`Timeout:  ${TIMEOUT_MS / 1000}s per turn`));
  console.log();

  // Select scenarios
  let scenarios = SCENARIOS;
  if (SCENARIO_FILTER !== null && !isNaN(SCENARIO_FILTER)) {
    const idx = SCENARIO_FILTER - 1;
    if (idx < 0 || idx >= SCENARIOS.length) {
      console.error(
        fail(
          `Scenario ${SCENARIO_FILTER} does not exist (1–${SCENARIOS.length} valid)`,
        ),
      );
      process.exit(1);
    }
    scenarios = [SCENARIOS[idx]];
    console.log(
      info(
        `Running only scenario ${SCENARIO_FILTER}: ${SCENARIOS[idx].name}\n`,
      ),
    );
  } else {
    console.log(info(`Running all ${SCENARIOS.length} scenarios\n`));
  }

  // Run scenarios sequentially (no parallel to avoid overwhelming the server)
  const scenarioResults: ScenarioResult[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    const label = `[${i + 1}/${scenarios.length}] ${scenario.name}`;
    process.stdout.write(`${dim("Running")} ${label}… `);

    const startMs = Date.now();
    let result: ScenarioResult;
    try {
      result = await runScenario(scenario);
    } catch (err) {
      // Connection-level errors abort all tests
      const msg = err instanceof Error ? err.message : String(err);
      console.log(fail("FATAL"));
      console.error("\n" + c.red + msg + c.reset);
      process.exit(2);
    }
    const elapsed = Date.now() - startMs;

    const statusLine = result.passed
      ? c.green + "PASS" + c.reset
      : c.red + "FAIL" + c.reset;
    console.log(`${statusLine} ${dim(`(${elapsed}ms)`)}`);

    scenarioResults.push(result);
  }

  // Detailed output
  const targetResults =
    SCENARIO_FILTER !== null ? scenarioResults : scenarioResults;

  for (let i = 0; i < targetResults.length; i++) {
    const result = targetResults[i];
    const originalIndex = SCENARIO_FILTER !== null ? SCENARIO_FILTER - 1 : i;
    printScenarioResult(result, originalIndex);
  }

  // Summary
  const total = scenarioResults.reduce((s, r) => s + r.totalAssertions, 0);
  const passed = scenarioResults.reduce((s, r) => s + r.passedAssertions, 0);
  const scenariosPassed = scenarioResults.filter((r) => r.passed).length;

  console.log();
  console.log(
    header("═══════════════════════════════════════════════════════"),
  );
  console.log(header("Summary"));
  console.log(
    header("═══════════════════════════════════════════════════════"),
  );

  for (let i = 0; i < scenarioResults.length; i++) {
    const r = scenarioResults[i];
    const icon = r.passed ? c.green + "✓" + c.reset : c.red + "✗" + c.reset;
    const assertSummary =
      r.totalAssertions > 0
        ? dim(` (${r.passedAssertions}/${r.totalAssertions} assertions)`)
        : dim(" (no assertions)");
    const scenarioNum = SCENARIO_FILTER !== null ? SCENARIO_FILTER : i + 1;
    console.log(
      `  ${icon} Scenario ${scenarioNum}: ${r.scenario.name}${assertSummary}`,
    );
  }

  console.log();

  if (total > 0) {
    const pct = Math.round((passed / total) * 100);
    const color =
      passed === total ? c.green : passed > total * 0.5 ? c.yellow : c.red;
    console.log(
      `  ${color}${c.bold}Assertions: ${passed}/${total} passed (${pct}%)${c.reset}`,
    );
  }

  const scenarioColor =
    scenariosPassed === scenarioResults.length ? c.green : c.red;
  console.log(
    `  ${scenarioColor}${c.bold}Scenarios:  ${scenariosPassed}/${scenarioResults.length} passed${c.reset}`,
  );
  console.log();

  // Exit code for CI
  const anyFailed = scenarioResults.some((r) => !r.passed);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(
    fail("Unexpected error:"),
    err instanceof Error ? err.message : err,
  );
  process.exit(2);
});
