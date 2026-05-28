/**
 * Markdown Chunker — for Translation Words (TW) and Translation Academy (TA) articles.
 *
 * Rules (from DETAILED_SPEC.md CHUNKING RULES):
 *   - Split by heading/paragraph into 256–512 token chunks, overlap 40 tokens.
 *   - Store front-matter fields (title, rc-link) in metadata, NOT in chunk text.
 */

export interface MarkdownChunk {
  text: string;
  heading?: string;
  title?: string; // from front-matter
  rcLink?: string; // from front-matter
  chunkIndex: number;
}

const TARGET_TOKENS = 256;
const MAX_TOKENS = 512;
const OVERLAP_TOKENS = 40;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/**
 * Parse YAML-like front-matter from a Markdown string.
 * Returns { frontMatter, body }.
 */
function parseFrontMatter(md: string): {
  frontMatter: Record<string, string>;
  body: string;
} {
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) return { frontMatter: {}, body: md };

  const raw = fmMatch[1];
  const frontMatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) frontMatter[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return { frontMatter, body: md.slice(fmMatch[0].length) };
}

/**
 * Split markdown body into chunks by headings and paragraphs.
 */
export function chunkMarkdown(
  markdown: string,
  baseChunkIndex = 0,
): MarkdownChunk[] {
  const { frontMatter, body } = parseFrontMatter(markdown);
  const title = frontMatter["title"] ?? "";
  const rcLink =
    frontMatter["rc-link"] ??
    frontMatter["link"] ??
    frontMatter["rc_link"] ??
    "";

  if (!body.trim()) return [];

  // Split on headings to get sections
  const sections = body.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim());

  const chunks: MarkdownChunk[] = [];
  let chunkIndex = baseChunkIndex;
  let overlapBuffer = "";

  for (const section of sections) {
    const headingMatch = section.match(/^(#{1,3})\s+(.+)/m);
    const heading = headingMatch?.[2]?.trim();
    // Strip the heading line for the content
    const content = section.replace(/^#{1,3}\s+.+\n?/, "").trim();
    const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim());

    let current = overlapBuffer;
    for (const para of paragraphs) {
      const paraText = para.trim();
      if (!paraText) continue;

      if (
        estimateTokens(current + " " + paraText) > MAX_TOKENS &&
        current.trim()
      ) {
        chunks.push({
          text: current.trim(),
          heading,
          title: title || undefined,
          rcLink: rcLink || undefined,
          chunkIndex,
        });
        chunkIndex++;
        // Prepare overlap: last OVERLAP_TOKENS worth of words from current
        const words = current.split(/\s+/);
        const overlapWords = Math.floor(OVERLAP_TOKENS / 1.3);
        overlapBuffer = words.slice(-overlapWords).join(" ");
        current = overlapBuffer + " " + paraText;
      } else {
        current = (current + " " + paraText).trim();
      }
    }

    if (current.trim() && estimateTokens(current) > 0) {
      if (
        estimateTokens(current) >= TARGET_TOKENS ||
        sections.indexOf(section) === sections.length - 1
      ) {
        chunks.push({
          text: current.trim(),
          heading,
          title: title || undefined,
          rcLink: rcLink || undefined,
          chunkIndex,
        });
        chunkIndex++;
        const words = current.split(/\s+/);
        const overlapWords = Math.floor(OVERLAP_TOKENS / 1.3);
        overlapBuffer = words.slice(-overlapWords).join(" ");
        current = overlapBuffer;
      } else {
        overlapBuffer = current;
      }
    }
  }

  return chunks;
}
