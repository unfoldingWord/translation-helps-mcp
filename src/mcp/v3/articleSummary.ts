/**
 * detail:"summary" for th_get_article.
 *
 * Translation Words keeps Definition and Translation Suggestions.
 * Translation Academy keeps the question it answers, when the data has one,
 * and its first section (Description, or the first section that is not an
 * examples list). Other sections, including examples, stay out.
 * When those sections are missing, the summary is the first 1500 characters.
 */

const SUMMARY_LIMIT = 1500;

export const SUMMARY_CUT_NOTE =
  "Summary is cut to the first 1500 characters; the expected sections were not found.";

export interface ArticleSummary {
  article: string;
  note?: string;
}

interface Section {
  level: number;
  heading: string;
  block: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function headingName(heading: string): string {
  return fold(heading.trim().replace(/[:.]\s*$/, ""));
}

function isDefinition(heading: string): boolean {
  const name = headingName(heading);
  return name === "definition" || name === "definicion";
}

function isSuggestions(heading: string): boolean {
  const name = headingName(heading);
  return (
    name.includes("translation suggestion") || name.includes("sugerencias")
  );
}

function isDescription(heading: string): boolean {
  const name = headingName(heading);
  return name === "description" || name === "descripcion";
}

function isExamples(heading: string): boolean {
  const name = fold(heading);
  return name.includes("example") || name.includes("ejemplo");
}

function sectionsOf(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const marks: Array<{ index: number; level: number; heading: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = HEADING.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    marks.push({ index, level: match[1].length, heading: match[2].trim() });
  }

  const sections: Section[] = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark || mark.level === 1) continue;
    let end = lines.length;
    for (let j = i + 1; j < marks.length; j++) {
      const next = marks[j];
      if (next && next.level <= mark.level) {
        end = next.index;
        break;
      }
    }
    sections.push({
      level: mark.level,
      heading: mark.heading,
      block: lines.slice(mark.index, end).join("\n").trim(),
    });
  }
  return sections;
}

function inlineQuestion(article: string): string | undefined {
  const patterns = [
    /this page answers the question:\s*\**\s*(.+?)\s*\**\s*$/im,
    /esta p[aá]gina responde(?: a)? la pregunta:\s*\**\s*(.+?)\s*\**\s*$/im,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(article);
    const text = match?.[1]?.replace(/\*+/g, "").trim();
    if (text) return text;
  }
  return undefined;
}

function withoutQuestionLine(block: string): string {
  return block
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/answers the question:|responde(?: a)? la pregunta:/i.test(line),
    )
    .join("\n")
    .trim();
}

function cleanSubtitle(raw: string | undefined): string | undefined {
  const text = raw?.replace(/^#+\s*/, "").trim();
  return text || undefined;
}

function cut(article: string): ArticleSummary {
  return {
    article: article.slice(0, SUMMARY_LIMIT),
    note: SUMMARY_CUT_NOTE,
  };
}

function titled(title: string, parts: string[]): string {
  const body = parts.filter(Boolean);
  const head = title.trim() ? [`# ${title.trim()}`] : [];
  return [...head, ...body].join("\n\n").trim();
}

/**
 * Build the summary. `subtitle` is the Translation Academy question when
 * the catalog stored it apart from the article body.
 */
export function summarizeArticle(
  kind: "tw" | "ta",
  title: string,
  article: string,
  subtitle?: string,
): ArticleSummary {
  const sections = sectionsOf(article);
  if (kind === "tw") {
    const definition = sections.find((section) =>
      isDefinition(section.heading),
    );
    const suggestions = sections.find((section) =>
      isSuggestions(section.heading),
    );
    if (!definition && !suggestions) return cut(article);
    return {
      article: titled(title, [
        definition?.block ?? "",
        suggestions?.block ?? "",
      ]),
    };
  }

  const topLevel = sections.reduce(
    (level, section) => Math.min(level, section.level),
    7,
  );
  const top = sections.filter((section) => section.level === topLevel);
  const first =
    top.find((section) => isDescription(section.heading)) ??
    top.find((section) => !isExamples(section.heading));
  if (!first) return cut(article);

  const question = cleanSubtitle(subtitle) ?? inlineQuestion(article);
  return {
    article: titled(title, [question ?? "", withoutQuestionLine(first.block)]),
  };
}
