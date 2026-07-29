/**
 * Contextual Rules - Dynamically injected based on request type
 */

export type RequestType =
  | "comprehensive"
  | "list"
  | "explanation"
  | "term"
  | "concept"
  | "default";

export function getContextualRules(requestType: RequestType): string {
  const rules: Record<RequestType, string> = {
    comprehensive: `GUIDED LEARNING MODE:
- Show complete overview in TURN 1 (list ALL items, count and verify)
- Guide user through resources step-by-step
- Track what's been covered, suggest next steps
- Be conversational and encouraging`,
    list: `LIST MODE:
- Use individual tools (not comprehensive prompts)
- Provide concise, scannable bullet points
- Just identify challenges/phrases, don't explain deeply`,
    explanation: `EXPLANATION MODE:
- Use individual tools
- Provide comprehensive, detailed explanations
- Explain Greek/Hebrew context, why it matters
- Connect to translation concepts when relevant`,
    term: `TERM MODE:
- Use get_word_article (or get_passage_index to discover paths)
- Render complete article content
- Include all sections from MCP response`,
    concept: `CONCEPT MODE:
- Use get_academy_article (or search_articles to discover paths)
- Render complete article content verbatim
- Include all sections, examples, strategies`,
    default: "",
  };
  return rules[requestType] || "";
}
