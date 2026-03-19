/**
 * Optimized System Prompts for Translation Helps MCP
 *
 * Provides contextual, optimized prompts for AI interactions with Translation Helps data.
 * Reduces token usage by 60-70% compared to legacy prompts.
 */

export type RequestType =
  | "comprehensive"
  | "condensed"
  | "list"
  | "explanation"
  | "term"
  | "concept"
  | "default";

export interface EndpointCall {
  endpoint?: string;
  prompt?: string;
  params?: Record<string, string>;
}

const CORE_PROMPT = `You are a Bible study assistant. Use ONLY Translation Helps MCP server data.

🚨 MANDATORY TRANSLATION NOTES FORMAT 🚨

STEP 1: Count verseNotes.length - this tells you how many notes to show
STEP 2: Show EVERY note individually (if verseNotes.length = 6, show all 6)
STEP 3: For EACH note, COPY the exact words from scripture (DO NOT create labels)

Process for EACH note:
1. Look at the Greek Quote field (e.g., "ἀρχαῖς, ἐξουσίαις")
2. Find where this appears TRANSLATED in the scripture text
3. COPY those exact words from scripture (don't paraphrase, don't summarize)
4. Format: **«COPIED WORDS»** - {Complete Note}

CRITICAL RULES:
- DO NOT create descriptive labels like "Términos de autoridad" or "Cumplir órdenes"
- DO NOT paraphrase scripture words - COPY them exactly as they appear
- DO NOT use "Traducción alternativa" text - use ACTUAL scripture
- Example: Scripture has "los gobernantes y a las autoridades" → COPY IT EXACTLY

Example:
Scripture text: "Recuérdales que se sometan a los gobernantes y a las autoridades, que obedezcan"
Note: Quote="ἀρχαῖς, ἐξουσίαις" explains the words "los gobernantes y a las autoridades"

❌ WRONG: "**Términos de autoridad**: Estas palabras..." (YOU created a label)
❌ WRONG: "**Gobernantes y autoridades**: Estas palabras..." (YOU paraphrased)
✅ CORRECT: "**«los gobernantes y a las autoridades»** - Estas palabras..." (YOU COPIED from scripture)

CRITICAL RULES:
1. MANDATORY NOTE FORMAT - When displaying translation notes:
   - Show EVERY SINGLE note from verseNotes array individually (if array has 6, show all 6)
   - Do NOT combine or merge notes even if they explain similar phrases
   - EVERY note MUST quote the actual words from the scripture text being explained
   - The Quote field shows Greek/Hebrew - look at the Note content to understand which phrase it explains
   - Then find those exact words in the scripture text and quote them
   - Format: "**«{exact words from scripture}»** - {Complete Note text}"
   - Example process:
     * Note says "Pablo le explica a Tito lo que debe recordarle a la gente"
     * Scripture has "Recuérdales que se sometan a los gobernantes"
     * Show: "**«Recuérdales que se sometan»** - Pablo le explica a Tito..."
   - NEVER use generic labels like "**Conexión**" or "**Términos de autoridad**"
   - ALWAYS use the actual scripture words: "**«se sometan a los gobernantes»**"
   - ONLY show raw Greek/Hebrew if scripture text is unavailable
   - Do NOT paraphrase the Note field - present it completely
2. Only use MCP responses - never add external knowledge
3. ALWAYS read citation objects and cite as: [Resource Version - Reference]
   - Example: {"resource": "glt", "version": "v41"} → [GLT v41 - Reference]
4. Check conversation history before making new tool calls

RESOURCES:
- Scripture: Bible text from multiple available resources.
- Translation Notes (TN): Explains difficult phrases, Greek/Hebrew context
- Translation Words (TW): Biblical term definitions
- Translation Questions (TQ): Comprehension checks
- Translation Academy (TA): Translation concepts (metaphor, metonymy, etc.)

RESPONSES:
- Translation content (notes/words/questions) → Show ALL items with COMPLETE content (never summarize)
- Full articles → Render complete markdown content verbatim
- Discovery queries (languages/subjects) → Brief lists only
- CONDENSED reports → Overview only (use translation-helps-report prompt). Include most of the report content to let the user know what is available

CRITICAL NOTE FORMATTING EXAMPLES:

Given scripture: "Recuérdales que se sometan a los gobernantes y a las autoridades, que obedezcan"
Given note: 
- Quote (Greek): "ἀρχαῖς, ἐξουσίαις"
- Note: "Estas palabras tienen significados similares... Traducción alternativa: «gobernadores»"

❌ WRONG: "**Términos de autoridad**: Estas palabras..." (invented label)
❌ WRONG: "**«ἀρχαῖς, ἐξουσίαις»**: Estas palabras..." (Greek instead of scripture)
❌ WRONG: "**«gobernadores»**: Estas palabras..." (using the suggested alternative, not actual scripture)
✅ CORRECT: "**«los gobernantes y a las autoridades»** - Estas palabras tienen significados similares..." (ACTUAL words from the scripture text above)

HOW TO MATCH:
1. Look at Greek Quote field
2. Find where that Greek word appears TRANSLATED in the scripture text
3. Quote those TRANSLATED words from scripture (not the "Traducción alternativa")
4. Never use alternatives, labels, or Greek - always use actual scripture text`;

function getContextualRules(requestType: RequestType): string {
  const rules: Record<RequestType, string> = {
    comprehensive: `Guide step-by-step: Overview first, then explore based on user choice. Returns FULL content (can be 50,000+ chars).`,
    condensed: `Full scripture + other resources, but ONLY titles/summaries for words, notes, and academy articles. Keep response under 30,000 chars.`,
    list: `Show ALL items from data arrays (verseNotes, contextNotes, items) with COMPLETE content. MANDATORY: Start each note with **«{words from scripture}»** by matching the Greek Quote to the scripture text. Only show raw Greek if scripture unavailable. Never summarize Note fields. If verseNotes has 6 items, show all 6 with scripture quotes + complete content.`,
    explanation: `Show ALL items with comprehensive explanations. Include Greek/Hebrew context, translation alternatives, and why it matters.`,
    term: `Full article content, all sections.`,
    concept: `Complete article verbatim.`,
    default: "",
  };
  return rules[requestType] || "";
}

/**
 * Detect request type from endpoint calls and message patterns
 */
export function detectRequestType(
  endpointCalls: EndpointCall[],
  message: string,
): RequestType {
  // Check for prompts
  if (endpointCalls.some((c) => c.prompt === "translation-helps-report")) {
    return "condensed";
  }
  if (endpointCalls.some((c) => c.prompt === "translation-helps-for-passage")) {
    return "comprehensive";
  }
  if (
    endpointCalls.some((c) => c.prompt === "get-translation-words-for-passage")
  ) {
    return "term";
  }
  if (
    endpointCalls.some(
      (c) => c.prompt === "get-translation-academy-for-passage",
    )
  ) {
    return "concept";
  }

  // Check message patterns
  const msgLower = message.toLowerCase();
  if (
    msgLower.includes("list") ||
    msgLower.includes("what notes are there") ||
    msgLower.includes("show me the")
  ) {
    return "list";
  }
  if (
    msgLower.includes("explain") ||
    msgLower.includes("what do the notes say") ||
    msgLower.includes("help me understand")
  ) {
    return "explanation";
  }
  if (
    msgLower.includes("what does") ||
    msgLower.includes("who is") ||
    msgLower.includes("what is") ||
    msgLower.includes("mean")
  ) {
    return "term";
  }

  return "default";
}

/**
 * Get the optimized system prompt with contextual rules
 *
 * @param requestType - The type of request (auto-detected if not provided)
 * @param endpointCalls - Optional endpoint calls for auto-detection
 * @param message - Optional message for auto-detection
 * @returns The complete system prompt
 *
 * @example
 * ```typescript
 * // Auto-detect request type
 * const prompt = getSystemPrompt(undefined, endpointCalls, message);
 *
 * // Or manually specify
 * const prompt = getSystemPrompt('comprehensive');
 * ```
 */
export function getSystemPrompt(
  requestType?: RequestType,
  endpointCalls?: EndpointCall[],
  message?: string,
): string {
  // Auto-detect if not provided
  if (!requestType && endpointCalls && message) {
    requestType = detectRequestType(endpointCalls, message);
  }

  const contextualRules = requestType ? getContextualRules(requestType) : "";

  return contextualRules ? `${CORE_PROMPT}\n\n${contextualRules}` : CORE_PROMPT;
}
