/**
 * `/api/v1/questions` from format 3 books. Like the helps adapter it answers only what the route answers the same way and
 * gives `undefined` for the rest:
 *
 * - Only a chapter the sweep proved equal for this release of the resource (verified.ts, item `BOOK C`) is answered; any
 *   other gives `undefined` (warning "unverified-resource").
 * - A text with links (format 3 rewrites them as ids and keeps no trace of the original form) or a row whose reference is
 *   not a plain `c:v` / `c:a-b` gives `undefined`.
 * - OBS, study questions, other formats, a whole book or a range across chapters stay with the route.
 */
import {
  isCanonicalUsfmBook,
  verseOverlapsQueryRange,
} from "@translation-helps/door43";
import { requireReferenceAndLanguage } from "../../api/routes/helpers";
import { sourceFromPackView } from "../../api/routes/packViews";
import type { Packs3Env } from "../catalogs";
import { warnOnce } from "../keys";
import { withReader } from "../readers";
import type { Packs3Params } from "../answer";
import { isVerified, releaseOfCatalogs } from "../verified";
import { LINKED, refOf } from "./helps";

export type QuestionsParams = {
  reference: string;
  language: string;
  /** Any `format` or `resourceType` means an answer of another shape: format 3 leaves it to the route. */
  other?: boolean;
};

type Row = {
  id: string;
  ref: string;
  from: number;
  to: number;
  cols: Record<string, unknown>;
};
type Resource = { key: string; subject: string; release: string };

function queryOf(params: QuestionsParams) {
  if (params.other) return undefined;
  try {
    const url = new URL("https://packs3.invalid/api/v1/questions");
    url.searchParams.set("reference", params.reference);
    url.searchParams.set("language", params.language);
    const q = requireReferenceAndLanguage(url);
    // The route reads one chapter only; a range across chapters is left to it.
    if (q.endChapter) return undefined;
    if (!isCanonicalUsfmBook(q.book) || !/^\d+$/.test(q.chapter))
      return undefined;
    return q;
  } catch {
    return undefined;
  }
}

export async function questionsFromPacks3(
  env: Packs3Env,
  params: QuestionsParams,
): Promise<Record<string, unknown> | undefined> {
  const q = queryOf(params);
  if (!q) return undefined;
  const code = q.book.toLowerCase();
  const answer = await withReader(env, params.language, async (reader, c) => {
    if (!reader.listed(`book:${code}`)) return undefined;
    const own = c.catalogs.find((x) => x.name !== "common");
    const resources = ((own?.catalog as { resources?: Resource[] })
      ?.resources ?? []) as Resource[];
    const data = (await reader.book(code)) as
      | { questions?: { res?: string; rows?: Row[] } }
      | undefined;
    const table = data?.questions;
    if (!table?.res || !Array.isArray(table.rows)) return undefined;
    const resource = resources.find(
      (r) => r.key === table.res && r.subject === "TSV Translation Questions",
    );
    if (!resource) return undefined;
    if (
      !isVerified(
        c.lang,
        resource.key,
        resource.release,
        "questions",
        `${q.book.toUpperCase()} ${q.chapter}`,
        { releaseOf: releaseOfCatalogs(c.catalogs) },
      )
    ) {
      warnOnce(params.language, "unverified-resource");
      return undefined;
    }
    const questions: Array<Record<string, string>> = [];
    for (const row of table.rows) {
      const at = refOf(row);
      const { question, response } = row.cols;
      if (
        !at ||
        row.cols.isIntro !== undefined ||
        typeof question !== "string" ||
        typeof response !== "string" ||
        LINKED.test(question) ||
        LINKED.test(response)
      )
        return undefined;
      if (at.chapter !== q.chapter) continue;
      if (
        q.verseStart &&
        !verseOverlapsQueryRange(at.verse, q.verseStart, q.verseEnd)
      )
        continue;
      questions.push({
        book: "",
        chapter: at.chapter,
        verse: at.verse,
        id: row.id,
        question: question.trim(),
        response: response.trim(),
      });
    }
    const source = sourceFromPackView(
      {
        questions: { key: resource.key, title: "", version: resource.release },
      },
      "questions",
    );
    if (!source) return undefined;
    return {
      reference: q.reference,
      language: c.lang,
      book: q.book,
      chapter: q.chapter,
      verse: q.verseStart ?? null,
      verseEnd: q.verseEnd ?? null,
      questions,
      source,
      meta: { cache: "pack" },
    };
  });
  return answer ?? undefined;
}

/** Registered in `ADAPTERS` for `/api/v1/questions`. */
export function questionsAdapterParams(params: Packs3Params): QuestionsParams {
  return {
    reference: String(params.reference ?? ""),
    language: String(params.language ?? ""),
    other: params.format !== undefined || params.resourceType !== undefined,
  };
}
