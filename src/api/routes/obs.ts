/**
 * OBS REST routes:
 *   GET /api/v1/obs         — story text (frames)
 *   GET /api/v1/obs-notes   — translation notes for a story:frame
 *   GET /api/v1/obs-questions — translation questions for a story:frame
 *
 * Query params (all routes): reference=<story:frame>&language=<lang>
 *   reference: OBS reference — "1:1" (single frame), "3:1-3" (frames 1–3 inclusive),
 *     "3" (whole story), "1:0" (story title), "front" (front matter).
 *     Optional "OBS" prefix ("OBS 3:1-3"). Story numbers 1–50; frames are 1-indexed.
 *   language:  BCP-47 code (e.g. "en", "es", "es-419") or ISO 639-2/639-3 alias
 *     (e.g. "spa" → catalog "es", may resolve to "es-419").
 */

import type { RouteContext } from "../worker.js";
import { json, apiError } from "../worker.js";
import { getResourceZipUrl, makeFetcher } from "./helpers.js";
import {
  parseObsReference,
  formatObsReferenceLabel,
  parseObsStoryMarkdown,
  parseObsNotesTsv,
  parseObsQuestionsTsv,
  filterObsStoryFrames,
  obsStoryPath,
  resolveCatalogLanguage,
  type ObsReference,
} from "@translation-helps/door43";

// Subjects used for catalog lookup. Comma-joined aliases cover gateway
// languages that omit the "TSV " prefix (e.g. es-419 OBS TQ).
const OBS_STORY_SUBJECT = "Open Bible Stories";
const OBS_TN_SUBJECT = "TSV OBS Translation Notes,OBS Translation Notes";
const OBS_TQ_SUBJECT =
  "TSV OBS Translation Questions,OBS Translation Questions";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function requireObsParams(url: URL): {
  reference: string;
  language: string;
  obsRef: ObsReference;
  displayReference: string;
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

  return {
    reference,
    language,
    obsRef,
    displayReference: formatObsReferenceLabel(reference),
  };
}

/**
 * Resolve language variant once (es → es-419), then fetch the zip.
 * Avoids getResourceZipUrl re-trying empty base-language catalog searches.
 */
async function resolveObsZip(
  language: string,
  subject: string,
  kv: RouteContext["env"]["TRANSLATION_HELPS_CACHE"],
): Promise<{
  language: string;
  zipUrl: string;
  entry: NonNullable<Awaited<ReturnType<typeof getResourceZipUrl>>>["entry"];
} | null> {
  const { language: resolvedLang } = await resolveCatalogLanguage(language, {
    subject,
    kv,
  });
  const zip = await getResourceZipUrl(
    resolvedLang,
    subject,
    undefined,
    "prod",
    kv,
  );
  if (!zip) return null;
  return { language: resolvedLang, zipUrl: zip.zipUrl, entry: zip.entry };
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

  const { language, obsRef, displayReference } = params;

  if (obsRef.isFront || obsRef.story === null) {
    return json({
      reference: displayReference,
      language,
      story: null,
      frames: [],
      title: "Front matter",
      attribution: null,
      note: "Front matter text is not yet supported.",
    });
  }

  const resolved = await resolveObsZip(
    language,
    OBS_STORY_SUBJECT,
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference: displayReference,
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
      reference: displayReference,
      language: resolved.language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS story ${obsRef.story} not found in resource for language "${resolved.language}".`,
    });
  }

  const story = parseObsStoryMarkdown(obsRef.story, markdown);

  const frames = filterObsStoryFrames(story.frames, obsRef);

  return json({
    reference: displayReference,
    language: resolved.language,
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

  const { language, obsRef, displayReference } = params;

  const resolved = await resolveObsZip(
    language,
    OBS_TN_SUBJECT,
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference: displayReference,
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
      reference: displayReference,
      language: resolved.language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS Translation Notes TSV not found in resource for language "${resolved.language}".`,
    });
  }

  const notes = parseObsNotesTsv(tsv, obsRef);
  return json({
    reference: displayReference,
    language: resolved.language,
    notes,
  });
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

  const { language, obsRef, displayReference } = params;

  const resolved = await resolveObsZip(
    language,
    OBS_TQ_SUBJECT,
    env.TRANSLATION_HELPS_CACHE,
  );
  if (!resolved) {
    return json({
      reference: displayReference,
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
      reference: displayReference,
      language: resolved.language,
      available: false,
      code: "RESOURCE_NOT_AVAILABLE",
      message: `OBS Translation Questions TSV not found in resource for language "${resolved.language}".`,
    });
  }

  const questions = parseObsQuestionsTsv(tsv, obsRef);
  return json({
    reference: displayReference,
    language: resolved.language,
    questions,
  });
}
