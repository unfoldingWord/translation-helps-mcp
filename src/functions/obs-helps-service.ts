/**
 * OBS Helps Service (issue #32)
 *
 * One shared implementation for the four OBS helps resources — they differ
 * only by DCS subject, repo, and two nearly-identical TSV layouts:
 *
 *   tn → tn_OBS.tsv  (Reference ID Tags SupportReference Quote Occurrence Note)
 *   sn → sn_OBS.tsv  (same columns as tn)
 *   tq → tq_OBS.tsv  (Reference ID Tags Quote Occurrence Question Response)
 *   sq → sq_OBS.tsv  (same columns as tq; carries `front` rows and frame
 *                     ranges like 1:1-8)
 *
 * Each is ONE TSV per language covering all 50 stories, so rows are filtered
 * by story:frame overlap (obs-tsv-filter.ts) rather than per-book lookup.
 */

import { parseTSV } from "../config/RouteGenerator.js";
import { EdgeXRayTracer } from "./edge-xray.js";
import { ZipResourceFetcher2 } from "../services/ZipResourceFetcher2.js";
import { resourceNotAvailable } from "../utils/errorEnvelope.js";
import { logger } from "../utils/logger.js";
import {
  parseOBSReference,
  formatOBSReference,
} from "./obs-reference-parser.js";
import { filterOBSTSVRows } from "./obs-tsv-filter.js";

export type OBSHelpsType = "tn" | "tq" | "sn" | "sq";

const HELPS_META: Record<
  OBSHelpsType,
  { subject: string; label: string; kind: "notes" | "questions" }
> = {
  tn: {
    subject: "TSV OBS Translation Notes",
    label: "OBS translation notes",
    kind: "notes",
  },
  tq: {
    subject: "TSV OBS Translation Questions",
    label: "OBS translation questions",
    kind: "questions",
  },
  sn: {
    subject: "TSV OBS Study Notes",
    label: "OBS study notes",
    kind: "notes",
  },
  sq: {
    subject: "TSV OBS Study Questions",
    label: "OBS study questions",
    kind: "questions",
  },
};

export interface OBSHelpsResult {
  reference: string;
  language: string;
  resourceType: OBSHelpsType;
  /** Matched rows: notes keep TSV casing (Note/Quote); questions are lowercased
   *  (question/response) to match the shapes the shared formatters read. */
  items: Array<Record<string, string>>;
  citation: {
    resource: string;
    organization: string;
    language: string;
    url: string;
    version: string;
  };
  metadata: {
    resourceType: OBSHelpsType;
    subject: string;
    language: string;
    organization: string;
    license: string;
    totalItems: number;
  };
}

/** Fetch and filter one OBS helps resource for an OBS reference. */
export async function fetchOBSHelps(options: {
  resourceType: OBSHelpsType;
  reference: string;
  language: string;
  organization?: string;
}): Promise<OBSHelpsResult> {
  const { resourceType, reference, language } = options;
  const organization = options.organization || "all";
  const meta = HELPS_META[resourceType];

  const ref = parseOBSReference(reference); // throws on invalid input (→ 400)
  const canonical = formatOBSReference(ref);

  // Direct ZipResourceFetcher2 (not ZipFetcherFactory) — see obs-service.ts.
  const tracer = new EdgeXRayTracer(
    `obs-${resourceType}-${Date.now()}`,
    "obs-helps-service",
  );
  const fetcher = new ZipResourceFetcher2(tracer);

  const result = await fetcher.getOBSTSVContent(
    resourceType,
    language,
    organization,
  );

  if (!result.content) {
    // Valid request, resource simply isn't published → 404 RESOURCE_NOT_AVAILABLE
    // (issue #30), NOT a server failure. Include variant hints when they exist.
    let languageVariants: string[] = [];
    try {
      const { findLanguageVariants } = await import("./resource-detector.js");
      // OBS repos do not carry the tc-ready topic — "" disables the filter.
      languageVariants = await findLanguageVariants(
        language.split("-")[0],
        "all",
        "",
        [meta.subject],
      );
    } catch (error) {
      logger.warn("OBS variant discovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const message =
      languageVariants.length > 0 && !languageVariants.includes(language)
        ? `No ${meta.label} available for language '${language}'.\n\nAvailable language variants: ${languageVariants.join(", ")}\n\nPlease try one of these language codes instead.`
        : `No ${meta.label} available for language '${language}'.`;
    const extras: Record<string, unknown> = { requestedLanguage: language };
    if (languageVariants.length > 0) extras.languageVariants = languageVariants;
    throw resourceNotAvailable(message, extras);
  }

  const allRows = parseTSV(result.content);
  const matched = filterOBSTSVRows(allRows, ref);
  logger.info(
    `[OBS ${resourceType}] ${matched.length}/${allRows.length} rows match ${canonical}`,
  );

  if (matched.length === 0) {
    // Published resource, valid reference, no rows for it — same "not
    // available" outcome the Bible helps endpoints signal (issue #30).
    // requestedLanguage makes simpleEndpoint/commonErrorHandlers preserve the
    // detailed message on the 404 instead of a generic "not found".
    throw resourceNotAvailable(
      `No ${meta.label} found for ${canonical}. OBS references use story:frame (stories 1-50), e.g. "1:1", "1:0" for a story title, or "front" for front matter.`,
      { requestedReference: canonical, requestedLanguage: language },
    );
  }

  const items = matched.map((row) =>
    meta.kind === "questions"
      ? {
          reference: row.Reference,
          id: row.ID,
          tags: row.Tags || "",
          quote: row.Quote || "",
          occurrence: row.Occurrence || "",
          question: row.Question || "",
          response: row.Response || "",
        }
      : {
          Reference: row.Reference,
          ID: row.ID,
          Tags: row.Tags || "",
          SupportReference: row.SupportReference || "",
          Quote: row.Quote || "",
          Occurrence: row.Occurrence || "",
          Note: row.Note || "",
        },
  );

  const owner = result.organization || "unfoldingWord";
  const repo = result.resourceName || `${language}_obs-${resourceType}`;
  return {
    reference: canonical,
    language,
    resourceType,
    items,
    citation: {
      resource: repo,
      organization: owner,
      language,
      url: `https://git.door43.org/${owner}/${repo}`,
      version: result.version || "master",
    },
    metadata: {
      resourceType,
      subject: result.subject || meta.subject,
      language,
      organization: owner,
      license: "CC BY-SA 4.0",
      totalItems: items.length,
    },
  };
}
