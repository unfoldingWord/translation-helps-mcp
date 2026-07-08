/**
 * OBS Story Service (issue #32)
 *
 * Fetches Open Bible Stories text (en_obs `content/NN.md`, front matter at
 * `content/front/intro.md`) via the shared catalog→ZIP→cache pipeline and
 * parses it into title + implicit frames.
 *
 * References use the OBS `story:frame` scheme (see obs-reference-parser.ts),
 * NOT the Bible book/chapter/verse scheme — none of the Bible reference
 * parsers are involved.
 */

import { EdgeXRayTracer } from "./edge-xray.js";
import { ZipResourceFetcher2 } from "../services/ZipResourceFetcher2.js";
import { resourceNotAvailable } from "../utils/errorEnvelope.js";
import { logger } from "../utils/logger.js";
import {
  parseOBSReference,
  formatOBSReference,
} from "./obs-reference-parser.js";
import {
  parseOBSStoryMarkdown,
  selectOBSFrames,
  type OBSFrame,
} from "./obs-story-parser.js";

const OBS_SUBJECT = "Open Bible Stories";

export interface OBSStoryResult {
  reference: string;
  language: string;
  story?: number;
  title?: string;
  frames?: OBSFrame[];
  /** Trailing "_A Bible story from: …_" line of the story. */
  bibleReference?: string;
  /** Raw front-matter markdown (only for `front` references). */
  frontMatter?: string;
  citation: {
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  };
  metadata: {
    resourceType: "obs";
    subject: string;
    language: string;
    organization: string;
    license: string;
    framesReturned?: number;
    totalFrames?: number;
  };
}

/** Throw the coded 404 for an unpublished OBS resource, with variant hints. */
async function throwOBSNotAvailable(
  what: string,
  language: string,
  subject: string,
): Promise<never> {
  let languageVariants: string[] = [];
  try {
    const { findLanguageVariants } = await import("./resource-detector.js");
    // OBS repos do not carry the tc-ready topic — pass "" so no topic filter
    // is applied (findLanguageVariants only appends a non-empty topic).
    languageVariants = await findLanguageVariants(
      language.split("-")[0],
      "all",
      "",
      [subject],
    );
  } catch (error) {
    logger.warn("OBS variant discovery failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const message =
    languageVariants.length > 0 && !languageVariants.includes(language)
      ? `No ${what} available for language '${language}'.\n\nAvailable language variants: ${languageVariants.join(", ")}\n\nPlease try one of these language codes instead.`
      : `No ${what} available for language '${language}'.`;

  const extras: Record<string, unknown> = { requestedLanguage: language };
  if (languageVariants.length > 0) extras.languageVariants = languageVariants;
  // Valid request, resource simply isn't published → 404 RESOURCE_NOT_AVAILABLE
  // (issue #30), NOT a server failure.
  throw resourceNotAvailable(message, extras);
}

/**
 * Fetch OBS story content for an OBS reference.
 *
 * Instantiates ZipResourceFetcher2 directly (rather than widening the
 * ZipFetcherProvider interface + LocalZipFetcher): in production the factory
 * always resolves to the R2 provider wrapping this same class, and its
 * network fallback works in local dev too.
 */
export async function fetchOBSStory(options: {
  reference: string;
  language: string;
  organization?: string;
}): Promise<OBSStoryResult> {
  const { reference, language } = options;
  const organization = options.organization || "all";

  const ref = parseOBSReference(reference); // throws on invalid input (→ 400)
  const canonical = formatOBSReference(ref);

  const tracer = new EdgeXRayTracer(`obs-${Date.now()}`, "obs-service");
  const fetcher = new ZipResourceFetcher2(tracer);

  const target = ref.isFront ? { front: true as const } : { story: ref.story! };
  const result = await fetcher.getOBSStoryMarkdown(
    target,
    language,
    organization,
  );

  if (!result.content) {
    await throwOBSNotAvailable("Open Bible Stories", language, OBS_SUBJECT);
  }

  const citation = {
    resource: result.resourceName || "obs",
    organization: result.organization || "unfoldingWord",
    language,
    url: `https://git.door43.org/${result.organization || "unfoldingWord"}/${result.resourceName || `${language}_obs`}`,
    version: result.version || "master",
  };
  const metadata: OBSStoryResult["metadata"] = {
    resourceType: "obs",
    subject: result.subject || OBS_SUBJECT,
    language,
    organization: result.organization || "unfoldingWord",
    license: "CC BY-SA 4.0",
  };

  if (ref.isFront) {
    return {
      reference: canonical,
      language,
      frontMatter: result.content!,
      citation,
      metadata,
    };
  }

  const story = parseOBSStoryMarkdown(result.content!, ref.story!);
  const frames = selectOBSFrames(story, ref);

  // A structurally valid frame that the story doesn't have (e.g. 1:99) is a
  // "not available" outcome with self-correction data, mirroring the Bible
  // tools' verse-not-found handling.
  if (ref.frame !== undefined && ref.frame > 0 && frames.length === 0) {
    // requestedLanguage makes simpleEndpoint/commonErrorHandlers preserve the
    // detailed message on the 404 instead of a generic "not found".
    throw resourceNotAvailable(
      `Story ${ref.story} has ${story.frames.length} frames; frame ${ref.frame} does not exist. Use a frame between 1 and ${story.frames.length}, or "${ref.story}:0" for the story title.`,
      {
        totalFrames: story.frames.length,
        requestedReference: canonical,
        requestedLanguage: language,
      },
    );
  }

  return {
    reference: canonical,
    language,
    story: ref.story,
    title: story.title,
    frames,
    ...(story.bibleReference && { bibleReference: story.bibleReference }),
    citation,
    metadata: {
      ...metadata,
      framesReturned: frames.length,
      totalFrames: story.frames.length,
    },
  };
}
