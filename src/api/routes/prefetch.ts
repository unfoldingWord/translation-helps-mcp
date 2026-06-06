/**
 * GET|POST /api/v1/prefetch?reference=&language=
 *
 * Background cache-hydration endpoint. Called by the MCP `get_passage` tool
 * immediately after returning scripture text to the LLM. Returns 202 Accepted
 * instantly, then uses ctx.waitUntil() to warm the caches the LLM will need for
 * the next workflow steps:
 *
 *   1. Translation Notes  — warms the TN zip, aligned USFM zips (UGNT/UHB + ULT),
 *      and the TA title-map KV entry. Covers get_passage_index + get_note calls.
 *
 *   2. Translation Word Links — warms the TWL zip, same USFM zips (already
 *      in-process from step 1), and the TW title-map KV entry. Covers
 *      get_passage_index word-link rows.
 *
 *   3. Questions — warms the TQ zip. Covers get_questions.
 *
 * All three run in parallel inside waitUntil, errors are swallowed (best-effort).
 * The in-process ZIP cache (module-level Map in ZipResourceFetcher2) means
 * subsequent same-reference calls in the same Worker isolate need zero network I/O.
 */

import type { RouteContext } from "../worker.js";
import { json } from "../worker.js";
import { handleNotes } from "./notes.js";
import { handleWordLinks } from "./wordLinks.js";
import { handleQuestions } from "./questions.js";

export function handlePrefetch(ctx: RouteContext): Response {
  const { url, env, execCtx } = ctx;

  const reference = url.searchParams.get("reference") ?? "";
  const language = url.searchParams.get("language") ?? "";

  if (!reference || !language) {
    return json({ error: "Missing reference or language" }, 400);
  }

  // Build synthetic URLs for each sub-call (handlers read params from url.searchParams)
  function makeUrl(path: string): URL {
    const u = new URL(`http://internal/api/v1${path}`);
    u.searchParams.set("reference", reference);
    u.searchParams.set("language", language);
    return u;
  }

  const warming = Promise.allSettled([
    handleNotes({ url: makeUrl("/notes"), env }),
    handleWordLinks({ url: makeUrl("/word-links"), env }),
    handleQuestions({ url: makeUrl("/questions"), env }),
  ]);

  // Keep the Worker alive until all warming completes
  if (execCtx) {
    execCtx.waitUntil(warming);
  }

  return json({ status: "warming", reference, language }, 202);
}
