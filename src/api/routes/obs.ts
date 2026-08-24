/**
 * OBS REST routes:
 *   GET /api/v1/obs         — story text (frames)
 *   GET /api/v1/obs-notes   — translation notes for a story:frame
 *   GET /api/v1/obs-questions — translation questions for a story:frame
 *
 * Query params (all routes): reference=<story:frame>&language=<lang>
 *   reference: OBS reference — "1:1", "1:0", "front", "obs 1:1"
 *   language:  BCP-47 code  — "en", "es", "fr", etc.
 */

import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { getResourceZipUrl, makeFetcher } from "./helpers.js";
import {
  parseObsReference,
  parseObsStoryMarkdown,
  parseObsNotesTsv,
  parseObsQuestionsTsv,
  obsStoryPath,
  type ObsReference,
} from "@translation-helps/door43";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function requireObsParams(url: URL): {
  reference: string;
  language: string;
  obsRef: ObsReference;
} {
  const reference = url.searchParams.get("reference");
  const language = url.searchParams.get("language");

  if (!reference) throw new Error("Missing required param: reference");
  if (!language) throw new Error("Missing required param: language");

  const obsRef = parseObsReference(reference);
  if (!obsRef) {
    throw new Error(
      `Invalid OBS reference: "${reference}". Use story:frame format (e.g. "1:1", "1:0", "front").`,
    );
  }

  return { reference, language, obsRef };
}

// ---------------------------------------------------------------------------
// /api/v1/obs — OBS story text
// ---------------------------------------------------------------------------

export async function handleObs(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;

  let params: ReturnType<typeof requireObsParams>;
  try {
    params = requireObsParams(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, language, obsRef } = params;

  if (obsRef.isFront || obsRef.story === null) {
    return json({
      reference,
      language,
      story: null,
      frames: [],
      title: "Front matter",
      attribution: null,
      note: "Front matter text is not yet supported.",
    });
  }

  // Fetch the OBS story zip for this language
  const resolved = await getResourceZipUrl(
    language,
    "Open Bible Stories",
    undefined,
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `No Open Bible Stories resource available for language "${language}". Catalog subject "Open Bible Stories" (tc-ready) was not found — check list_resources for OBS availability.`,
    });
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);

  const storyPath = obsStoryPath(obsRef.story);
  const markdown = await fetcher.extractFileFromZip(zip, storyPath);

  if (!markdown) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS story ${obsRef.story} not found in resource for language "${language}".`,
    });
  }

  const story = parseObsStoryMarkdown(obsRef.story, markdown);

  // If a specific frame was requested, filter to that frame.
  // frame === 0 returns the synthetic title frame; frame === null returns all frames.
  const frames =
    obsRef.frame !== null
      ? story.frames.filter((f) => f.index === obsRef.frame)
      : story.frames.filter((f) => f.index > 0); // exclude synthetic title frame for whole-story

  return json({
    reference,
    language,
    story: story.story,
    title: story.title,
    frames,
    attribution: story.attribution,
  });
}

// ---------------------------------------------------------------------------
// /api/v1/obs-notes — OBS translation notes
// ---------------------------------------------------------------------------

export async function handleObsNotes(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;

  let params: ReturnType<typeof requireObsParams>;
  try {
    params = requireObsParams(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, language, obsRef } = params;

  const resolved = await getResourceZipUrl(
    language,
    "TSV OBS Translation Notes",
    undefined,
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `No OBS Translation Notes resource available for language "${language}". Catalog subject "TSV OBS Translation Notes" (tc-ready) was not found.`,
    });
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);

  // The OBS tN resource uses a single TSV file
  const tsvPaths = ["tn_OBS.tsv", "tn_obs.tsv"];
  let tsv: string | null = null;
  for (const p of tsvPaths) {
    tsv = await fetcher.extractFileFromZip(zip, p);
    if (tsv) break;
  }

  if (!tsv) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS Translation Notes TSV not found in resource for language "${language}".`,
    });
  }

  const notes = parseObsNotesTsv(tsv, obsRef);
  return json({ reference, language, notes });
}

// ---------------------------------------------------------------------------
// /api/v1/obs-questions — OBS translation questions
// ---------------------------------------------------------------------------

export async function handleObsQuestions(ctx: RouteContext): Promise<Response> {
  const { url, env, execCtx } = ctx;

  let params: ReturnType<typeof requireObsParams>;
  try {
    params = requireObsParams(url);
  } catch (e) {
    return apiError("BAD_REQUEST", (e as Error).message, 400);
  }

  const { reference, language, obsRef } = params;

  const resolved = await getResourceZipUrl(
    language,
    "TSV OBS Translation Questions",
    undefined,
    "prod",
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `No OBS Translation Questions resource available for language "${language}". Catalog subject "TSV OBS Translation Questions" (tc-ready) was not found.`,
    });
  }

  const fetcher = makeFetcher(env, execCtx);
  const zip = await fetcher.getOrDownloadZip(resolved.zipUrl);

  const tsvPaths = ["tq_OBS.tsv", "tq_obs.tsv"];
  let tsv: string | null = null;
  for (const p of tsvPaths) {
    tsv = await fetcher.extractFileFromZip(zip, p);
    if (tsv) break;
  }

  if (!tsv) {
    return json({
      reference,
      language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS Translation Questions TSV not found in resource for language "${language}".`,
    });
  }

  const questions = parseObsQuestionsTsv(tsv, obsRef);
  return json({ reference, language, questions });
}
