/**
 * USFM Chunker — splits USFM scripture text into verse-level chunks.
 *
 * Rules (from DETAILED_SPEC.md CHUNKING RULES):
 *   - Target: verse-level when ≤ 512 tokens.
 *   - Overflow: sliding window 256–512 tokens, overlap 40 tokens.
 *   - Preserve verse markers in chunk text for citation.
 *
 * Token estimation: We use word count × 1.3 as a conservative token
 * approximation (avoids importing a tokenizer at edge).
 */

export interface UsfmChunk {
  text: string;
  verseRef?: string; // "JHN 3:16"
  chunkIndex: number;
}

const MAX_TOKENS = 512;
const SLIDE_SIZE = 256;
const OVERLAP = 40;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/**
 * Extract plain text from USFM, stripping markers.
 * Preserves verse references in the form "v {chapter}:{verse}".
 */
export function extractUsfmText(usfm: string): string {
  return usfm
    .replace(/\\[a-zA-Z*]+(?:\s+[^\\\n]+)?/g, (match) => {
      // Keep verse markers as readable references
      const verseMatch = match.match(/\\v\s+(\d+)/);
      if (verseMatch) return ` [v${verseMatch[1]}] `;
      return " ";
    })
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse book/chapter from USFM header markers.
 * Returns "GEN" / "JHN" style 3-letter code or empty string.
 */
function extractBookCode(usfm: string): string {
  const m = usfm.match(/\\id\s+([A-Z0-9]{2,3})/);
  return m?.[1] ?? "";
}

/**
 * Split plain text into verse-level chunks if ≤ 512 tokens,
 * otherwise use sliding window.
 */
export function chunkUsfm(usfm: string, baseChunkIndex = 0): UsfmChunk[] {
  const bookCode = extractBookCode(usfm);
  const plain = extractUsfmText(usfm);
  const words = plain.split(/\s+/).filter(Boolean);

  if (words.length === 0) return [];

  const chunks: UsfmChunk[] = [];

  if (estimateTokens(plain) <= MAX_TOKENS) {
    chunks.push({
      text: plain,
      verseRef: bookCode || undefined,
      chunkIndex: baseChunkIndex,
    });
    return chunks;
  }

  // Sliding window
  let i = 0;
  let chunkIndex = baseChunkIndex;
  while (i < words.length) {
    const window = words.slice(i, i + SLIDE_SIZE);
    const text = window.join(" ");
    chunks.push({ text, verseRef: bookCode || undefined, chunkIndex });
    i += SLIDE_SIZE - OVERLAP;
    chunkIndex++;
  }

  return chunks;
}
