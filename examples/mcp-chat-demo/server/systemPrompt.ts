import type { McpToolDefinition } from "./mcpHttp.js";

const MAX_DESC = 420;

function summarizeTool(t: McpToolDefinition): string {
  const d = (t.description ?? "").replace(/\s+/g, " ").trim();
  const short = d.length > MAX_DESC ? `${d.slice(0, MAX_DESC)}…` : d;
  return `- **${t.name}**: ${short}`;
}

export function buildSystemPrompt(tools: McpToolDefinition[]): string {
  const lines = tools.map(summarizeTool);
  return `You are a helpful assistant for Bible translation workflows using Door43 / Translation Helps tools.

Use the provided functions to fetch scripture, notes, questions, translation words, and discovery lists when needed.

Rules:
- Use **3-letter book codes** in references (JHN, TIT, GEN), never full book names.
- For translation notes, questions, and word links in non-English, **omit organization** unless the user names a specific Door43 owner.
- Prefer **fetch_scripture** for Bible text; **fetch_translation_notes** for TN; **fetch_translation_word_links** then **fetch_translation_word** with **path** for terms.

Available tools:
${lines.join("\n")}`;
}
