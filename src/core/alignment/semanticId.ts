/**
 * src/core/alignment/semanticId.ts
 *
 * Deterministic numeric semantic ID generator.
 * Ported from bt-synergy: packages/resource-parsers/src/utils/semantic-id-generator.ts
 *
 * The same (content + verseRef + occurrence) always produces the same ID,
 * enabling cross-resource alignment matching.
 */

/**
 * Generate a deterministic numeric ID for an original-language token.
 * Tokens with the same text, verse reference, and occurrence number always
 * receive the same ID, making it safe to match across resources.
 */
export function generateSemanticId(
  content: string,
  verseRef: string,
  occurrence = 1,
): number {
  const input = `${verseRef}:${content}:${occurrence}`;
  let hash = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return Math.abs(hash) % 1_000_000;
}
