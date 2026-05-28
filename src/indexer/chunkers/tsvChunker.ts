/**
 * TSV Chunker — one TSV row per chunk (translation notes, questions, word links).
 *
 * Rules (from DETAILED_SPEC.md CHUNKING RULES):
 *   - One TSV row per chunk.
 *   - If a note exceeds 512 tokens, chunk at sentence boundaries.
 *   - Preserve ID column as part of chunk text.
 *
 * Expected TSV columns for Translation Notes (en_tn):
 *   Book  Chapter  Verse  ID  SupportReference  OrigWords  Occurrence  Note
 *
 * Expected TSV columns for Translation Questions (en_tq):
 *   Book  Chapter  Verse  ID  Tags  Quote  Occurrence  Question  Response
 *
 * Expected TSV columns for Translation Word Links (en_twl):
 *   Book  Chapter  Verse  ID  Tags  OrigWords  Occurrence  TWLink
 *
 * We parse generically: first row is the header, subsequent rows are data.
 */

export interface TsvChunk {
  text: string;
  reference?: string; // "JHN 3:16"
  id?: string; // TSV ID column
  supportRef?: string; // rc:// URI from SupportReference column
  chunkIndex: number;
}

const MAX_TOKENS = 512;
const SENTENCE_OVERLAP = 1; // sentences overlap to preserve context

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function splitAtSentences(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const chunks: string[] = [];
  let current: string[] = [];
  let tokens = 0;

  for (const sent of sentences) {
    const t = estimateTokens(sent);
    if (tokens + t > maxTokens && current.length > 0) {
      chunks.push(current.join(" ").trim());
      // Overlap: keep last sentence
      current = [current[current.length - SENTENCE_OVERLAP] ?? ""];
      tokens = estimateTokens(current[0]);
    }
    current.push(sent);
    tokens += t;
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks.filter(Boolean);
}

/**
 * Parse a TSV string and return chunks, one per row (split if too long).
 */
export function chunkTsv(tsv: string, baseChunkIndex = 0): TsvChunk[] {
  const lines = tsv.split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const bookIdx = header.indexOf("book");
  const chapterIdx = header.indexOf("chapter");
  const verseIdx = header.indexOf("verse");
  const idIdx = header.indexOf("id");
  const noteIdx = header.indexOf("note");
  const questionIdx = header.indexOf("question");
  const responseIdx = header.indexOf("response");
  const supportRefIdx = header.indexOf("supportreference");
  const twlinkIdx = header.indexOf("twlink");

  const chunks: TsvChunk[] = [];
  let chunkIndex = baseChunkIndex;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split("\t");
    const book = bookIdx >= 0 ? cols[bookIdx]?.trim() : "";
    const chapter = chapterIdx >= 0 ? cols[chapterIdx]?.trim() : "";
    const verse = verseIdx >= 0 ? cols[verseIdx]?.trim() : "";
    const id = idIdx >= 0 ? cols[idIdx]?.trim() : undefined;
    const supportRef =
      supportRefIdx >= 0 ? cols[supportRefIdx]?.trim() : undefined;
    const twLink = twlinkIdx >= 0 ? cols[twlinkIdx]?.trim() : undefined;

    const reference =
      book && chapter && verse ? `${book} ${chapter}:${verse}` : undefined;

    // Build chunk text: prefer note, then question+response, then entire row
    let text = "";
    if (noteIdx >= 0 && cols[noteIdx]) {
      text = [id, cols[noteIdx]].filter(Boolean).join(": ");
    } else if (questionIdx >= 0 && cols[questionIdx]) {
      const question = cols[questionIdx]?.trim() ?? "";
      const response = responseIdx >= 0 ? cols[responseIdx]?.trim() : "";
      text = [id, question, response].filter(Boolean).join(" ");
    } else if (twlinkIdx >= 0 && twLink) {
      text = [id, twLink, ...cols.slice(5)].filter(Boolean).join(" ");
    } else {
      text = cols.filter(Boolean).join(" ");
    }

    if (!text.trim()) continue;

    if (estimateTokens(text) > MAX_TOKENS) {
      const subChunks = splitAtSentences(text, MAX_TOKENS);
      for (const sub of subChunks) {
        chunks.push({
          text: sub,
          reference,
          id,
          supportRef: supportRef || twLink,
          chunkIndex,
        });
        chunkIndex++;
      }
    } else {
      chunks.push({
        text,
        reference,
        id,
        supportRef: supportRef || twLink,
        chunkIndex,
      });
      chunkIndex++;
    }
  }

  return chunks;
}
