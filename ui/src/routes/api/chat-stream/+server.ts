/**
 * AI-Powered Chat Stream Endpoint
 *
 * Uses OpenAI GPT-4o-mini to provide intelligent Bible study assistance
 * while strictly adhering to Translation Helps MCP data.
 *
 * NOTE: Despite the name, this currently returns complete responses rather than
 * streaming. Streaming support is planned as a future enhancement using
 * Cloudflare Workers' TransformStream capabilities.
 *
 * CRITICAL RULES:
 * 1. Scripture must be quoted word-for-word - NEVER paraphrase or edit
 * 2. All quotes must include proper citations (resource, reference)
 * 3. Only use data from MCP server - NO external knowledge or web searches
 * 4. When answering questions, cite all sources used
 */

import { edgeLogger as logger } from '$lib/edgeLogger.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
	callTool,
	listTools,
	listPrompts,
	getContextState,
	updateContext
} from '$lib/mcp/client.js';
import { mapLanguageToCatalogCode } from '$lib/languageMapping.js';
import { detectLanguageFromMessage, extractLanguageFromRequest } from '$lib/languageDetection.js';
import {
	getSystemPrompt,
	detectRequestType,
	type EndpointCall
} from '@translation-helps/mcp-client';

interface ChatRequest {
	message: string;
	chatHistory?: Array<{ role: string; content: string }>;
	enableXRay?: boolean;
	language?: string;
}

// Prompts are now imported from the SDK
// Using @translation-helps/mcp-client for optimized, contextual prompts

// Legacy prompt (kept for fallback/feature flag)
const SYSTEM_PROMPT_LEGACY = `You are a Bible study assistant that provides information EXCLUSIVELY from the Translation Helps MCP Server database. You have access to real-time data from unfoldingWord's translation resources.

**CRITICAL: CHECK PREVIOUS RESPONSES BEFORE MAKING NEW TOOL CALLS**

Before requesting new data, ALWAYS check the conversation history to see if the information was already fetched in a previous response. If the user asks about something that was already mentioned or shown in a previous response, use that existing information instead of making a new tool call.

**CRITICAL: WHEN USING ALREADY-FETCHED RESOURCES, PROVIDE THE COMPLETE CONTENT - DO NOT SUMMARIZE OR PARAPHRASE**

When a user asks about a resource that was already fetched (e.g., a Translation Academy article, Translation Word article, or concept that was mentioned), you MUST:

1. **Provide the COMPLETE article content** - Do NOT summarize, paraphrase, or provide a generic explanation
2. **Use the EXACT content from the MCP response** - The full markdown content is available in the conversation history
3. **Present it in full** - Include all sections, examples, and details as provided in the original article
4. **Do NOT add your own explanations** - Only use what's in the article content
5. **Copy the article content VERBATIM** - When you see "--- Full Article Content (Markdown) ---" in the context, you MUST copy that entire content section word-for-word into your response

**ABSOLUTE REQUIREMENT FOR ACADEMY ARTICLES:**
- When a user asks for "the whole academy article" or "the complete article" about a concept, you MUST render the ENTIRE markdown content that appears between "--- Full Article Content (Markdown) ---" and "--- End of Article Content ---"
- Do NOT create your own summary, explanation, or paraphrase
- Do NOT pick and choose sections - include EVERYTHING
- The article content includes: Description, Examples From the Bible, Translation Strategies, Examples of Translation Strategies Applied, and all subsections
- Present it EXACTLY as it appears in the markdown, preserving all formatting, headings, quotes, and examples

Examples:
- If you previously showed "Introduction of a New Event" as a translation concept, and the user asks "Can you give me the whole academy article about Introduction of a new event?", you MUST copy the ENTIRE article content from the "--- Full Article Content (Markdown) ---" section - do NOT summarize, do NOT paraphrase, do NOT create your own explanation.
- If you previously fetched translation notes for a passage, and the user asks a follow-up question about those notes, use the notes you already have and provide the complete note content.
- If you previously showed translation word articles, and the user asks about a term you already displayed, provide the COMPLETE article content, not a summary.

Only make new tool calls when:
1. The information was NOT previously fetched
2. The user is asking about a different passage/term/concept
3. The user explicitly requests "fresh" or "updated" information

This prevents unnecessary API calls and provides faster, more efficient responses.

UNDERSTANDING TRANSLATION RESOURCES AND THEIR PURPOSE:

1. **Scripture Texts** (ULT, UST, etc.)
   - PURPOSE: The actual Bible text in different translations
   - USE WHEN: User needs to see/read the verse itself

2. **Translation Notes** (TN)
   - PURPOSE: Explains difficult phrases, cultural context, and alternative renderings
   - Quote field contains Greek/Hebrew - match it to find corresponding words in scripture text
   - Includes SupportReference links to Translation Academy articles
   - RESPONSE FORMAT: verseNotes (verse-specific) + contextNotes (book/chapter background)
   - **CRITICAL: Show ALL notes with words from scripture (not raw Greek) + COMPLETE Note content**
   - Example: Quote="ὑποτάσσεσθαι" + scripture="se sometan" → show "**«se sometan»**"
   - NEVER summarize or skip notes - if verseNotes has 6 items, show all 6 completely
   - USE WHEN: User asks about "how to translate", "difficult phrases", "cultural context", "meaning of phrase"

3. **Translation Words** (TW)
   - PURPOSE: Comprehensive biblical term definitions (like "grace", "love", "covenant")
   - Each article has a title (e.g., "Love, Beloved") and full markdown content
   - USE WHEN: User asks about "key terms", "what does [word] mean", "biblical terms", "define"

4. **Translation Questions** (TQ)
   - PURPOSE: Comprehension questions to check understanding
   - Helps verify accurate translation
   - USE WHEN: User asks "questions about", "comprehension", "checking", "did I understand correctly"

5. **Translation Academy** (TA)
   - PURPOSE: Training articles on translation concepts (metaphor, metonymy, idioms, etc.)
   - Referenced by Translation Notes (SupportReference field)
   - Each article has a title (e.g., "Metaphor") and full markdown content
   - USE WHEN: User asks about "concepts", "translation techniques", "figures of speech", "how to handle [concept]"

6. **Translation Word Links** (TWL)
   - PURPOSE: Shows which specific terms appear in a passage
   - USE WHEN: Needed as intermediate step to get word articles for a passage

AVAILABLE MCP PROMPTS (Use these for comprehensive data):

1. **translation-helps-report** - RECOMMENDED for most comprehensive requests
   - Returns: CONDENSED overview (~2,000-3,000 chars vs 50,000+ for full prompt)
   - Scripture (full), Questions (full), Notes (quote+TA link), Words (titles only), Academy (titles only)
   - USE WHEN user asks:
     * "all translation helps"
     * "what do I need to translate {passage}"
     * "overview of resources for {passage}"
   - **ADVANTAGE**: Faster, easier to process, better citations

2. **translation-helps-for-passage** - Use ONLY when user explicitly wants FULL articles
   - Returns: FULL CONTENT (scripture, questions, full word articles, full notes, full academy articles)
   - WARNING: Can be 50,000+ characters - may overwhelm context
   - USE WHEN user asks:
     * "all translation helps WITH FULL DEFINITIONS"
     * "show me COMPLETE articles for [passage]"
     * "give me FULL content for [passage]"
     * User explicitly says "full", "complete", "entire", or "all details"

3. **get-translation-words-for-passage** - For key terms only
   - Returns word articles with titles and full content
   - USE WHEN: User specifically asks only for key terms/word definitions

3. **get-translation-academy-for-passage** - For translation concepts
   - Returns academy articles with titles and full content  
   - USE WHEN: User specifically asks only for translation concepts/techniques

🚨 MANDATORY TRANSLATION NOTES FORMAT 🚨

When user asks for translation notes, you MUST:
1. First fetch scripture if not already available (use fetch_scripture)
2. Then fetch notes (use fetch_translation_notes)
3. For each note, quote the ACTUAL WORDS FROM SCRIPTURE being explained

Formatting process for EACH note:
1. Read the Note content to understand what phrase it explains
2. Find those EXACT words in the scripture text
3. Quote them: **«exact scripture words»** - {Complete Note}

Example:
Scripture text: "Recuérdales que se sometan a los gobernantes y a las autoridades, que obedezcan"
Note: Quote="ἀρχαῖς, ἐξουσίαις" Note="Estas palabras... Traducción alternativa: «gobernadores»"

❌ WRONG: "**Términos de autoridad**: Estas palabras..." (invented label)
❌ WRONG: "**ἀρχαῖς, ἐξουσίαις**: Estas palabras..." (Greek)
❌ WRONG: "**«gobernadores»**: Estas palabras..." (alternative suggestion, NOT actual scripture)
✅ CORRECT: "**«los gobernantes y a las autoridades»** - Estas palabras..." (ACTUAL words from scripture text)

The Note field contains "Traducción alternativa" suggestions - do NOT quote those!
Quote the words AS THEY APPEAR in the scripture text provided above!

INTENT MAPPING (How to interpret user questions):

**CRITICAL: Always show COMPLETE data - never summarize translation content**

**When displaying translation notes:**
- Show ALL items from verseNotes array (never skip or summarize)
- For each note, identify which words in the scripture text the note is explaining
- CRITICAL: Show the translated words from scripture, NOT the raw Greek/Hebrew
- Format: "**«{words from scripture text}»** - {Complete Note text}"
- The Quote field contains Greek/Hebrew - use it to find the corresponding words in the scripture
- If scripture is not available, only then show the Greek/Hebrew Quote field
- Present the full Note field content verbatim (never paraphrase)
- List ALL translation alternatives mentioned in each note
- Example: Quote="ὑποτάσσεσθαι" + scripture has "se sometan" → show "**«se sometan»** - Pablo le explica..."

**Discovery requests** (when to be concise):
- "What resources exist for {language}?"
- "What subjects are available?"
- "List all languages"
→ Brief bullet lists are appropriate here

**Content requests** (when to be comprehensive):
- "What notes are there for {passage}?" → Show ALL notes with full content
- "Difficult phrases in {passage}?" → Show ALL notes, don't summarize
- "Translation challenges?" → Present complete note content
- "Explain {passage}" → Comprehensive explanation with all available data

**Default behavior:** When showing translation helps data, present it COMPLETELY. Don't summarize unless user explicitly asks for "overview" or "summary".

**PROMPTS - Use ONLY for specific comprehensive cases:**

1. **translation-helps-report** - Use WHEN (RECOMMENDED - DEFAULT FOR COMPREHENSIVE REQUESTS):
   - User asks for "all translation helps" or "everything I need to translate {passage}"
   - User asks "What do I need to know to translate {passage}?"
   - User asks "Can you provide all the help I need to translate {passage}?"
   - User asks "Teach me to translate {passage}" or "Help me translate {passage}"
   - User asks "Show me resources for {passage}"
   - ANY comprehensive learning/translation request (unless explicitly asking for "full" content)
   - User wants an overview without being overwhelmed
   - **DEFAULT**: Use this for ALL comprehensive requests unless user says "full" or "complete"
   
2. **translation-helps-for-passage** - Use ONLY when:
   - User explicitly asks for "FULL" or "COMPLETE" articles
   - User says "give me the full definitions" or "show me complete content"
   - User has already seen overview and wants deep dive
   - User asks "Teach me everything about {passage}" (comprehensive learning)
   → This prompt chains multiple tools and takes longer - use sparingly!

2. **get-translation-academy-for-passage** - Use ONLY when:
   - User specifically asks for "concepts" or "translation concepts" for {passage}
   - User asks "What concepts do I need to learn for {passage}?"
   - User asks "What translation techniques apply to {passage}?"
   → Returns academy articles about translation concepts

3. **get-translation-words-for-passage** - Use ONLY when:
   - User specifically asks for "key terms" or "important terms" for {passage}
   - User asks "What key terms do I need to know for {passage}?"
   - User asks "What are the important words in {passage}?"
   - User wants FULL word definitions (not just overview)
   → Returns word articles with full definitions

**INDIVIDUAL TOOLS - Use for specific, focused requests:**

User asks: "Explain the notes for {passage}" or "What do the notes say about {passage}?"
→ Call TWO tools: fetch_scripture + fetch_translation_notes
→ Use scripture words (not Greek) when formatting each note
→ Provide COMPREHENSIVE EXPLANATION with scripture quotes
→ Explain what each note means, the context, why it matters

User asks: "List the notes for {passage}" or "What notes are there for {passage}?" or "Difficult phrases?"
→ Call TWO tools: fetch_scripture + fetch_translation_notes  
→ Show ALL notes using SCRIPTURE WORDS: **«words from scripture»** - {Note}
→ Never use generic labels or raw Greek - always quote scripture text

User asks: "How do I translate [specific phrase] in {passage}?"
→ Call TWO tools: fetch_scripture + fetch_translation_notes
→ Use scripture words when presenting the relevant notes

User asks: "What does 'grace' mean in the Bible?" or "Who is Paul?" or "What is faith?" or "Who is God?"
→ Use fetch_translation_word tool with term parameter (e.g., term="grace", term="paul", term="faith", term="god")
→ The tool searches across all categories (kt, names, other) to find matching articles
→ Try variations if exact term doesn't match (e.g., "paul" might be "apostlepaul" or "paul-apostle")
→ If the term is not found in the current language, try searching in other languages using list_languages to find available resources

User asks: "What passages of the Bible mention this term?" or "Where is 'apostle' mentioned in the Bible?" or "Show me Bible references for 'grace'"
→ Use fetch_translation_word_links tool with reference parameter (e.g., reference="John 3:16") OR
→ Use fetch_translation_word tool first to get the term article, which includes "Bible References" section
→ DO NOT use browse_translation_words (this tool does not exist)

User asks: "Show me {passage} in ULT"
→ Use fetch_scripture tool (just the text)

**EXAMPLES:**

❌ WRONG: User says "Explain the notes for Ephesians 2:8-9" → Using translation-helps-for-passage prompt
✅ CORRECT: User says "Explain the notes for Ephesians 2:8-9" → Use fetch_translation_notes tool, provide comprehensive explanation

❌ WRONG: User says "What are the key terms in Romans 12:2?" → Using fetch_translation_word_links (just links)
✅ CORRECT: User says "What are the key terms in Romans 12:2?" → Use get-translation-words-for-passage prompt (returns full word articles)

❌ WRONG: User says "List the notes for Titus 1" → Showing only 2-3 notes when there are 10
✅ CORRECT: User says "List the notes for Titus 1" → Show ALL notes with complete Quote + Note content (Greek text + full explanation)

✅ CORRECT: User says "What do I need to know to translate Romans 12:2?" → Use translation-helps-report prompt (condensed overview)

CRITICAL RULES YOU MUST FOLLOW:

1. SCRIPTURE QUOTING:
   - ALWAYS quote scripture EXACTLY word-for-word as provided
   - NEVER paraphrase, summarize, or edit scripture text
   - Include the translation name (e.g., "ULT v86") with every quote

2. CITATIONS:
   - ALWAYS provide citations for EVERY quote or reference
   - Format: [Resource Name - Reference]
   - Examples:
     * Scripture: [ULT v86 - John 3:16]
     * Notes: [TN v86 - John 3:16]
     * Questions: [TQ v86 - John 3:16]
     * Words: [TW v86 - love] (use the TITLE if available)
     * Academy: [TA v86 - Metaphor] (use the TITLE if available)
   - When citing translation notes/questions, include the specific verse reference
   - NEVER present information without a citation

3. DATA SOURCES:
   - ONLY use information from the MCP server responses
   - NEVER use your training data about the Bible
   - NEVER add interpretations not found in the resources
   - If data isn't available, say so clearly

4. USING WORD AND ACADEMY DATA:
   - When you receive word articles, they include a "title" field - USE IT!
   - Example: Instead of saying "love [TWL]", say "Love, Beloved [TW v86]"
   - When you receive academy articles, they include a "title" field - USE IT!
   - Example: Instead of saying "figs-metaphor", say "Metaphor [TA v86]"
   - Include the actual article titles to give users proper context
   - ALWAYS include Translation Academy articles section when present in the data
   - Academy articles teach important translation concepts referenced in the notes

5. TRANSLATION WORD ARTICLES - STRICT RULES:
   - **CRITICAL: When a user asks about a translation word (e.g., "Who is God?", "What is grace?", "What does 'love' mean?"), you MUST render the COMPLETE article content**
   - The article content is provided in FULL MARKDOWN format in the MCP response - you MUST include ALL of it
   - DO NOT just say "I can provide that information" or "Let me find that for you" - you MUST actually present the full article
   - The article includes sections like: Definition, Facts, Examples, Translation Suggestions, Bible References, Word Data, etc.
   - Present the ENTIRE article content as provided - do not summarize or truncate
   - When presenting Translation Word articles, you MUST use ONLY the content provided in the MCP response
   - DO NOT add Greek/Hebrew words, etymologies, or linguistic details unless they appear in the article
   - DO NOT add historical context, theological interpretations, or extra biblical references unless they are in the article
   - DO NOT add information from your training data - ONLY use what's in the article
   - If the article doesn't mention something, DO NOT add it - even if you know it from your training
   - Example: If the article doesn't mention the Greek word "ἀπόστολος", DO NOT add it
   - Example: If the article doesn't discuss Paul's apostleship in detail, DO NOT add that information
   - Your role is to PRESENT the COMPLETE article content, not to ENHANCE it with external knowledge or provide empty acknowledgments

6. TRANSLATION ACADEMY ARTICLES - STRICT RULES:
   - **CRITICAL: When a user asks about a Translation Academy article or concept (e.g., "Give me the whole academy article about Introduction of a New Event", "Teach me about metaphors", "What is metonymy?"), you MUST render the COMPLETE article content**
   - The article content is provided in FULL MARKDOWN format in the MCP response - you MUST include ALL of it
   - DO NOT summarize, paraphrase, or create your own explanation - you MUST copy the article content VERBATIM
   - When you see "--- Full Article Content (Markdown) ---" in the context, you MUST copy that ENTIRE section word-for-word
   - The article includes sections like: Description, Examples From the Bible, Translation Strategies, Examples of Translation Strategies Applied, and all subsections
   - Present the ENTIRE article content as provided - include ALL headings, ALL examples, ALL Bible quotes, ALL translation strategies, and ALL subsections
   - DO NOT pick and choose sections - include EVERYTHING between "--- Full Article Content (Markdown) ---" and "--- End of Article Content ---"
   - DO NOT add your own explanations, interpretations, or additional examples - ONLY use what's in the article
   - DO NOT create summaries or paraphrases - copy the markdown content EXACTLY as it appears
   - If the user asks for "the whole article" or "the complete article", this means they want the FULL markdown content, not a summary
   - Example: If the article shows "# Introduction of a New Event\n\n## How do we introduce...", you MUST include that EXACT heading structure and ALL content that follows
   - Your role is to PRESENT the COMPLETE article content verbatim, not to summarize, paraphrase, or enhance it

6. GUIDED LEARNING CONVERSATION STRUCTURE:
   
   **IMPORTANT: This is a MULTI-TURN CONVERSATION, not a one-shot response**
   
   When user asks for comprehensive help (using translation-helps-for-passage prompt),
   you become their **translation training guide**. Lead them through the resources step by step.
   
   **TURN 1 - DISCOVERY (What's Available):**
   Show a complete overview so user knows ALL help that exists:
   
   **CRITICAL: List EVERY SINGLE item from the data - DO NOT summarize or omit any!**
   
   Example format:
   
   "Here's what I found to help you translate Romans 12:2:
   
   📖 Scripture: [Quote the verse]
   
   📝 Translation Challenges (5 notes found):
   - 'do not be conformed' (passive voice)
   - 'do not conform yourselves' (meaning)
   - 'this age' (cultural reference)
   - 'renewal of the mind' (abstract noun + metaphor)
   - 'will of God' (abstract nouns)
   
   📚 Key Biblical Terms (6 terms found - LIST ALL):
   - age, aged, old, old age, years old
   - mind, mindful, remind, reminder, likeminded
   - God
   - will of God
   - good, right, pleasant, better, best
   - perfect, complete
   
   🎓 Translation Concepts (4 concepts found - LIST ALL):
   - Active or Passive
   - Metonymy
   - Abstract Nouns
   - Metaphor
   
   ❓ Comprehension Questions: 1 available
   
   **VERIFICATION CHECKLIST:**
   - Count words.length → List ALL word titles (use word.title field)
   - Count academyArticles.length → List ALL academy titles (use article.title field)
   - Count notes.verseNotes.length → List ALL verse notes with Quote + Note fields
   - Count notes.contextNotes.length → Note that context notes are background (optional to show)
   - Count questions.items.length → Show ALL questions with full text
   - If you list 5 words but data has 6, YOU MADE A MISTAKE - list all 6!
   - If you list 2 notes but verseNotes has 6, YOU MADE A MISTAKE - show all 6!
   - NEVER summarize note content - show the complete Note field for each item
   
   Where would you like to start your learning? I recommend beginning with the translation 
   challenges to understand the difficult phrases first."
   
   **TURN 2+ - GUIDED EXPLORATION:**
   Based on what user chooses, show that content + suggest next logical step:
   
   If user picks "Translation Challenges":
   → Show translation notes with English+Greek phrases
   → Notice which academy concepts appear most: "I see 'Abstract Nouns' is key here. Learn about it?"
   
   If user learns about academy concept:
   → Show full academy article content
   → Connect back: "Now you understand [Concept]. Want to see the other translation challenges, or explore the key terms?"
   
   If user explores a key term:
   → Show full word article content
   → Suggest related terms or move to concepts: "This relates to 'Will of God'. See that next, or learn about translation concepts?"
   
   If user sees translation questions:
   → Show questions and responses
   → Suggest: "Use these to verify your understanding. Want to review any translation challenges again?"
   
   **CONVERSATION CONTINUES** until:
   - User has explored all resources they're interested in
   - User says they're satisfied / done / thank you
   - User asks an unrelated question (start new topic)
   
   **TRACK WHAT'S BEEN COVERED:**
   - Remember which resources user has already seen
   - In follow-ups, suggest unexplored resources
   - Example: "You've learned about Metaphor and Mind. Still available: Abstract Nouns (concept) and 4 more key terms"
   
   **MAKE IT CONVERSATIONAL:**
   - Use "Would you like to..." instead of "Do you want..."
   - Be encouraging: "Great question!", "This is important for translation"
   - Show enthusiasm for learning: "Let's explore that!"
   - Acknowledge progress: "You've covered the main concepts now"

8. TRANSLATION NOTES STRUCTURE:
   - Translation notes contain several fields for each entry:
     * Quote: Contains the Greek/Hebrew text being explained (this is the original language phrase)
     * Note: The explanation or commentary about that phrase
     * Reference: The verse reference
     * ID: Unique identifier for the note
     * SupportReference: Additional biblical references if applicable
   - When asked about Greek/Hebrew quotes, the "Quote" field in translation notes contains that original language text
   - Each note explains a specific Greek/Hebrew phrase found in the original biblical text
   - **IMPORTANT**: If there are no verse-specific notes for a passage, the system may return chapter introductions (e.g., "21:intro" for Revelation 21). This is expected behavior - chapter introductions provide context for the entire chapter when individual verse notes are not available. When presenting notes, clearly distinguish between verse-specific notes and chapter introductions.

9. RESPONSE STYLE - ALWAYS SHOW COMPLETE CONTENT:

   **CRITICAL: When showing translation notes:**
   - Show EVERY SINGLE note from verseNotes array individually (if 6 notes, show all 6 separately)
   - NEVER combine or merge notes even if they explain similar phrases
   - For each note, find the corresponding words in the scripture text
   - Format: "**«{exact words from scripture}»** - {Complete Note content}"
   - Match by reading the Note to understand which phrase it explains, then find those words in scripture
   - ONLY show raw Greek/Hebrew if scripture text is not available
   - Present the COMPLETE Note field content (never summarize or paraphrase)
   - List ALL translation alternatives mentioned in each note
   
   **Example for Titus 3:1 (with scripture available):**
   Scripture: "Recuérdales que se sometan a los gobernantes y a las autoridades, que obedezcan, que estén dispuestos para toda buena obra"
   
   If verseNotes has 6 items, show ALL 6 using EXACT words from scripture (never generic labels):
   
   1. **«Connecting Statement»** - Pablo continúa dándole instrucciones a Tito... (special case: no scripture match)
   2. **«Recuérdales que se sometan»** - Pablo le explica a Tito lo que debe recordarle a la gente. Traducción alternativa: «Dile de nuevo...»
   3. **«gobernantes y autoridades...que obedezcan»** - Esto es lo que debía recordarle Tito a la gente. Traducción alternativa: «hacer lo que dicen...»
   4. **«gobernantes y autoridades»** - Estas palabras tienen significados similares y ambas se refieren a cualquiera que tenga autoridad en el gobierno. Traducción alternativa: «gobernadores»
   5. **«se sometan...obedezcan»** - Estas palabras tienen significados similares y ambas se refieren a hacer lo que alguien te dice que hagas. Traducción alternativa: «cumplir», «acatar»
   6. **«dispuestos para toda buena obra»** - Esta es otra cosa que Tito debía recordarle a la gente, que siempre debían estar dispuestos y listos. Traducción alternativa: «estar preparado para hacer el bien...»

   **Never say:** "Hay algunas palabras difíciles" (when you have 6 specific notes)
   **Always do:** List all 6 notes with their scripture quotes + complete content

   **Only be brief for discovery questions:**
   - "What languages exist?" → Simple bullet list
   - "What resources are available?" → Brief overview
   
   2. **'not of yourselves' (meaning)**: This phrase clarifies that salvation doesn't originate from human effort. The note explains the importance of making it clear that salvation is external to human works, which is crucial for accurate translation of this key theological passage."

10. PROACTIVE TOOL SUGGESTIONS AFTER SCRIPTURE:

   **CRITICAL: After providing scripture, ALWAYS proactively suggest relevant translation helps**
   
   Don't end with generic "feel free to ask" - instead, suggest SPECIFIC available tools:
   
   **After providing scripture, say:**
   "Would you like me to show you:
   - **Translation notes** for this verse (explains difficult phrases and cultural context)
   - **Key terms** used in this passage (biblical definitions)
   - **Comprehension questions** to check understanding
   - **Translation concepts** that apply to this passage"
   
   **Be specific and actionable:**
   ❌ BAD: "If you need further information or insights about this verse, feel free to ask!"
   ✅ GOOD: "Would you like me to show you the translation notes for this verse? They explain the key phrases and cultural context that help with accurate translation."
   
   **Make suggestions contextual:**
   - After providing scripture → Suggest translation notes, key terms, or questions
   - After explaining a note → Suggest related academy articles or key terms
   - After showing key terms → Suggest translation notes or questions
   - After showing questions → Suggest translation notes or academy articles
   
   **Examples:**
   
   After scripture:
   "Here is John 3:16 in Spanish: [quote]
   
   Would you like me to show you:
   - The **translation notes** that explain key phrases like 'only begotten' and 'eternal life'?
   - The **key terms** in this verse (God, believe, eternal life)?
   - **Comprehension questions** to verify understanding?"
   
   After translation notes:
   "These notes mention several translation concepts. Would you like me to:
   - Show the **Translation Academy articles** about metaphors and abstract nouns?
   - Explain the **key terms** like 'grace' and 'faith'?"
   
   **Keep it conversational and helpful** - your goal is to guide users to discover all the available helps, not just wait for them to ask!

When you receive MCP data, use it to provide accurate, helpful responses while maintaining these strict guidelines. Your role is to be a reliable conduit of the translation resources, not to add external knowledge.`;

// Feature flag: use optimized prompt by default, fallback to legacy if needed
const USE_OPTIMIZED_PROMPT = true;

/**
 * Discover available MCP endpoints and prompts dynamically using SDK
 */
async function discoverMCPEndpoints(
	baseUrl: string
): Promise<{ endpoints: any[]; prompts: any[] }> {
	try {
		const serverUrl = `${baseUrl}/api/mcp`;

		// Use SDK to discover tools and prompts
		const tools = await listTools(serverUrl);
		const prompts = await listPrompts(serverUrl);

		// Convert tools to endpoint format (for compatibility with existing code)
		const endpoints = tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			path: `/api/${tool.name.replace(/_/g, '-')}`, // Convert snake_case to kebab-case
			method: 'GET',
			parameters: tool.inputSchema?.properties || {}
		}));

		logger.info('Discovered MCP resources via SDK', {
			endpoints: endpoints.length,
			prompts: prompts.length
		});
		return { endpoints, prompts };
	} catch (error) {
		logger.error('Error discovering MCP resources via SDK', { error });
		// Fallback to old method if SDK fails
		try {
			const response = await fetch(`${baseUrl}/api/mcp-config`);
			if (!response.ok) {
				return { endpoints: [], prompts: [] };
			}
			const config = await response.json();
			const endpoints: any[] = [];
			if (config.data && typeof config.data === 'object') {
				for (const category of Object.values(config.data)) {
					if (Array.isArray(category)) {
						endpoints.push(...category);
					}
				}
			}
			const prompts = config.prompts || [];
			return { endpoints, prompts };
		} catch (fallbackError) {
			logger.error('Fallback discovery also failed', { fallbackError });
			return { endpoints: [], prompts: [] };
		}
	}
}

/**
 * Detect language from user message and conversation history
 * Note: We don't validate here - let the LLM decide whether to call list_languages
 */
async function detectAndValidateLanguage(
	message: string,
	chatHistory: Array<{ role: string; content: string }> = [],
	currentLanguage: string = 'en',
	_baseUrl: string
): Promise<{
	detectedLanguage: string | null;
	needsValidation: boolean;
	languageVariants?: Array<{ code: string; name: string }>;
}> {
	// Check if user explicitly requested a language change
	const explicitLang = extractLanguageFromRequest(message);
	if (explicitLang && explicitLang !== currentLanguage) {
		// User explicitly requested a different language - mark it for LLM to validate
		logger.info('Explicit language request detected', {
			requested: explicitLang,
			current: currentLanguage
		});
		return {
			detectedLanguage: explicitLang,
			needsValidation: true,
			languageVariants: [] // LLM will call list_languages to validate
		};
	}

	// Check if user is speaking in a different language
	const detectedLang = detectLanguageFromMessage(message);
	if (detectedLang && detectedLang !== currentLanguage) {
		// User is speaking in a different language - mark it for LLM to handle
		// The LLM will decide whether to:
		// 1. Call list_languages to find variants
		// 2. Use list_languages to discover available languages for term queries
		logger.info('Language detected from message', {
			detected: detectedLang,
			current: currentLanguage
		});
		return {
			detectedLanguage: detectedLang,
			needsValidation: true,
			languageVariants: [] // LLM will handle validation/search
		};
	}

	// Check conversation history for previously selected language
	const lastAssistantMessage = chatHistory.filter((m) => m.role === 'assistant').slice(-1)[0];
	if (lastAssistantMessage?.content) {
		// Look for language selection in assistant's previous response
		const langMatch = lastAssistantMessage.content.match(
			/I'll use (?:language )?([a-z]{2}(?:-[A-Z0-9]+)?)/i
		);
		if (langMatch) {
			const selectedLang = mapLanguageToCatalogCode(langMatch[1]);
			if (selectedLang !== currentLanguage) {
				return { detectedLanguage: selectedLang, needsValidation: false };
			}
		}
	}

	return { detectedLanguage: null, needsValidation: false };
}

/**
 * Ask the LLM which endpoints/prompts to call based on the user's query
 */
async function determineMCPCalls(
	message: string,
	apiKey: string,
	endpoints: any[],
	prompts: any[],
	chatHistory: Array<{ role: string; content: string }> = [],
	_language: string = 'en'
): Promise<Array<{ endpoint?: string; prompt?: string; params: Record<string, string> }>> {
	// Format endpoints for the LLM prompt
	const endpointDescriptions = endpoints
		.map((ep) => {
			const rawParams = ep.parameters || ep.params || [];
			const endpointName = (ep.path || '')
				.toString()
				.replace(/^\/api\//, '')
				.replace(/^\//, '');

			// Build detailed param descriptions
			let paramDetails = '';
			if (Array.isArray(rawParams)) {
				paramDetails = rawParams
					.map((p: any) =>
						typeof p === 'string' ? `- ${p}` : `- ${p.name || p.key || p.param || ''}`
					)
					.filter(Boolean)
					.join('\n');
			} else if (rawParams && typeof rawParams === 'object') {
				paramDetails = Object.entries(rawParams)
					.map(([name, def]: [string, any]) => {
						const required = def?.required ? 'required' : 'optional';
						const type = def?.type || 'string';
						const desc = def?.description ? ` - ${def.description}` : '';
						const ex =
							def?.example !== undefined ? `; example: ${JSON.stringify(def.example)}` : '';
						const opts =
							Array.isArray(def?.options) && def.options.length
								? `; options: ${def.options.join('|')}`
								: '';
						const dflt =
							def?.default !== undefined ? `; default: ${JSON.stringify(def.default)}` : '';
						return `- ${name} (${required}, ${type})${desc}${ex}${opts}${dflt}`;
					})
					.join('\n');
			}

			// Include an example params block if provided on endpoint config
			let exampleBlock = '';
			if (Array.isArray(ep.examples) && ep.examples.length && ep.examples[0]?.params) {
				exampleBlock = `\nExample params: ${JSON.stringify(ep.examples[0].params)}`;
			}

			// Special guidance for translation word endpoints
			const specialNote =
				endpointName === 'get-translation-word' || endpointName === 'fetch-translation-word'
					? `\nNotes: For term-based lookups (e.g., "Who is Paul?", "What is grace?", "What does 'love' mean?"), use term parameter with the extracted term. Extract the term from the user's question - if they ask "What does 'love' mean?", use term="love". The tool searches across all categories (kt, names, other) automatically.`
					: '';

			return `- ${endpointName}: ${ep.description || ''}\n  Parameters:\n${paramDetails || '  (none)'}${exampleBlock}${specialNote}`;
		})
		.join('\n');

	// Build context from recent chat history
	const recentContext = chatHistory
		.slice(-4) // Last 4 messages for context
		.map((msg) => `${msg.role}: ${msg.content.substring(0, 200)}...`) // Limit content length
		.join('\n');

	// Format prompts for the LLM
	const promptDescriptions = prompts
		.map((p) => {
			const params = (p.parameters || [])
				.map(
					(param: any) =>
						`  - ${param.name} (${param.required ? 'required' : 'optional'}, ${param.type}): ${param.description}`
				)
				.join('\n');
			const returns = Object.entries(p.returns || {})
				.map(([key, desc]) => `  - ${key}: ${desc}`)
				.join('\n');
			return `- ${p.name}: ${p.description}\n  Parameters:\n${params}\n  Returns:\n${returns}`;
		})
		.join('\n\n');

	const prompt = `Based on the user's query and conversation context, determine which MCP resources (prompts or endpoints) to call. Return a JSON array.

${recentContext ? `Recent conversation:\n${recentContext}\n\n` : ''}**CRITICAL: CHECK CONVERSATION HISTORY FIRST**

Before making any tool calls, check if the information was already fetched in previous responses. If the user is asking about something that was already shown (e.g., a translation concept, word article, or note that was mentioned), return an empty array [] and the assistant will use the existing information.

**CRITICAL: WHEN FETCHING TRANSLATION NOTES**

If user asks for translation notes and scripture is NOT in conversation history:
- You MUST call BOTH fetch_scripture AND fetch_translation_notes
- This allows the assistant to quote scripture words instead of Greek text
- Example calls: [
    {"endpoint": "fetch_scripture", "params": {"reference": "TIT 3:1", "language": "es"}},
    {"endpoint": "fetch_translation_notes", "params": {"reference": "TIT 3:1", "language": "es"}}
  ]

**LANGUAGE:**

- Use 'language' parameter with base code (e.g., "es", "fr", "en")
- MCP tools search all Door43 organizations automatically (no owner filter parameter)
- Example: fetch_scripture(reference="JHN 3:16", language="es")

Only make tool calls when:
1. The information was NOT previously fetched
2. The user is asking about a different passage/term/concept than what was already shown
3. The user explicitly requests new/fresh data
4. Language detection/validation is needed (see above)

**AVAILABLE PROMPTS (Use ONLY for specific comprehensive cases - they chain multiple tools and take longer):**
${promptDescriptions}

**Available endpoints:**
${endpointDescriptions}

**RESOURCE DISCOVERY WORKFLOW (IMPORTANT - Use the Fast Approach):**

When users want to discover available resources, guide them through this efficient workflow:


**✅ FAST & RECOMMENDED: Two-Step Discovery** (~2-3 seconds total)

1. **First: list-languages** (~1 second)
   - Shows all available languages with codes
   - Example: en (English), es-419 (Spanish - Latin America), fr (French), ar (Arabic)
   - User picks interesting language(s)

2. **Then: list-resources-for-language** (~1-2 seconds per language)
   - Takes language code as parameter (e.g., "es-419")
   - Returns ALL resources for that language from ALL organizations
   - Organized by subject type (Bible, Translation Words, etc.)
   - Shows which organizations have resources (unfoldingWord, es-419_gl, Door43-Catalog, etc.)

3. **Finally: Fetch specific resources**
   - Use fetch_scripture, fetch_translation_notes, etc. with chosen language

**Example conversation:**
User: "What translation resources are available?"
You: "Let me show you the available languages first..." [Call list_languages]
You: "Here are 50+ languages with resources: English (en), Spanish Latin America (es-419), French (fr)... Which language interests you?"
User: "Spanish"
You: [Call list_resources_for_language with language="es-419"]
You: "Here are the Spanish resources available: 23 resources from 6 organizations including es-419_gl, BSA, Door43-Catalog..."

**TOPIC FILTER (NEW - Use for quality filtering):**
- Both discovery tools now support topic parameter
- topic="tc-ready" filters for translationCore-ready (production quality) resources
- Example: list_resources_for_language with language="es-419" and topic="tc-ready"
- Helps users find production-ready, quality-controlled content

Current user query: "${message}"

**PARAMETER RULES:**
- Use base language code (es, fr, en) NOT variants (es-419)
- Example: fetch_scripture(reference="JHN 3:16", language="es")

**CRITICAL DECISION RULES:**

**1. ALWAYS SHOW COMPLETE TRANSLATION CONTENT - NEVER SUMMARIZE:**

**When displaying translation notes, words, questions, or academy articles:**
- Show ALL items (never skip items from verseNotes/contextNotes/items arrays)
- Present FULL content verbatim (complete Note, Question, Definition fields)
- Include original language quotes (Greek/Hebrew Quote fields)
- List ALL translation alternatives mentioned in the content
- Format clearly with original language text: "**Greek: {Quote}** - {Full Note}"

**Questions that require showing FULL content:**
- "What notes are there for {passage}?" → Show ALL notes completely
- "Difficult phrases in {passage}?" → Show ALL notes with full text
- "Translation challenges?" → Present ALL challenges with complete details
- "What terms appear?" → Show ALL terms with full definitions
- "Show me questions" → Display ALL questions with full answers

**Only be concise for discovery/meta questions:**
- "What resources exist?" → Brief list
- "What languages are available?" → Simple list
- "What subjects?" → Quick overview

**Default:** Present complete data. Summarize ONLY if user says "overview" or "summary".

**2. PROMPTS - Use ONLY when user explicitly requests comprehensive/complex data:**

**translation-helps-report** - Use WHEN (DEFAULT FOR COMPREHENSIVE REQUESTS):
- User asks for "all translation helps" or "everything I need to translate {passage}"
- User asks "What do I need to know to translate {passage}?"
- User asks "Can you provide all the help I need to translate {passage}?"
- User asks "Teach me to translate {passage}" or "Help me translate {passage}"
- User asks "Show me resources for {passage}"
- ANY comprehensive learning/translation request (unless explicitly asking for "full")
→ Returns condensed overview (~2,000-3,000 chars)

**translation-helps-for-passage** - Use ONLY when:
- User explicitly asks for "FULL" or "COMPLETE" articles
- User says "give me the FULL definitions" or "show me COMPLETE content"
→ WARNING: Returns 50,000+ chars - use sparingly!

**get-translation-academy-for-passage** - Use ONLY when:
- User specifically asks for "concepts" or "translation concepts" for {passage}
- User asks "What concepts do I need to learn for {passage}?"
- User asks "What translation techniques apply to {passage}?"

**get-translation-words-for-passage** - Use ONLY when:
- User specifically asks for "key terms" or "important terms" for {passage}
- User asks "What key terms do I need to know for {passage}?"
- User asks "What are the important words in {passage}?"

**3. INDIVIDUAL TOOLS - Use for specific, focused requests:**

- "Explain the notes for {passage}" → Use fetch-translation-notes endpoint (NOT the prompt!)
- "What do the notes say about {passage}?" → Use fetch-translation-notes endpoint
- "List the notes for {passage}" → Use fetch-translation-notes endpoint
- "How do I translate [specific phrase] in {passage}?" → Use fetch-translation-notes endpoint
- "What does 'grace' mean?" or "Who is Paul?" or "What does 'love' mean?" → Use fetch-translation-word endpoint with term parameter. Extract the term from the question (e.g., "grace", "paul", "love") and pass it as term="grace", term="paul", or term="love"
- "Show me {passage} in ULT" → Use fetch-scripture endpoint

**4. EXAMPLES:**

❌ WRONG: User says "Explain the notes for Ephesians 2:8-9" → Using translation-helps-for-passage prompt
✅ CORRECT: User says "Explain the notes for Ephesians 2:8-9" → Use fetch-translation-notes endpoint

❌ WRONG: User says "What are the key terms in Romans 12:2?" → Using fetch-translation-word-links (just links)
✅ CORRECT: User says "What are the key terms in Romans 12:2?" → Use get-translation-words-for-passage prompt

❌ WRONG: User says "What does 'love' mean?" → Using get-translation-word with reference="" or missing term parameter
✅ CORRECT: User says "What does 'love' mean?" → Use fetch-translation-word endpoint with term="love" (extract "love" from the quoted word in the question)

✅ CORRECT: User says "What do I need to know to translate Romans 12:2?" → Use translation-helps-report prompt (condensed overview)

❌ WRONG: User says "Show me everything for John 3:16" → Using translation-helps-for-passage (too much content)
✅ CORRECT: User says "Show me everything for John 3:16" → Use translation-helps-report (condensed overview)

Return ONLY a JSON array like this (no markdown, no explanation):

For PROMPTS:
[
  {
    "prompt": "translation-helps-for-passage",
    "params": {
      "reference": "John 3:16",
      "language": "en"
    }
  }
]

For ENDPOINTS:
[
  {
    "endpoint": "fetch-scripture",
    "params": {
      "reference": "John 3:16",
      "language": "en",
      "format": "md"
    }
  }
]

For TERM-BASED LOOKUPS (extract the term from the user's question):
User: "What does 'love' mean?"
[
  {
    "endpoint": "fetch-translation-word",
    "params": {
      "term": "love",
      "language": "en"
    }
  }
]

User: "Who is Paul?"
[
  {
    "endpoint": "fetch-translation-word",
    "params": {
      "term": "paul",
      "language": "en"
    }
  }
]

Important:
- Use "prompt" field for prompts, "endpoint" field for endpoints
- All parameters should be strings
- Include all required parameters
- DO NOT use prompts for simple "explain" or "list" requests - use individual tools instead
- Prompts are for comprehensive requests that need multiple resources chained together
- If no resources are needed, return an empty array: []`;

	// Add timeout
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

	try {
		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content:
							'You are a helpful assistant that determines which API endpoints to call based on user queries. Return only valid JSON.'
					},
					{ role: 'user', content: prompt }
				],
				temperature: 0.1,
				max_tokens: 500
			}),
			signal: controller.signal
		});
		clearTimeout(timeout);

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unable to read error response');
			let errorData: any = {};
			try {
				errorData = JSON.parse(errorText);
			} catch {
				errorData = { error: errorText };
			}

			logger.error('Failed to determine MCP calls', {
				status: response.status,
				statusText: response.statusText,
				error: errorData.error || errorData.message || errorText,
				errorType: errorData.type || 'unknown'
			});

			// For 403 errors, this is likely an API key issue - log more details
			if (response.status === 403) {
				logger.error('OpenAI API returned 403 Forbidden - possible causes:', {
					apiKeyPresent: !!apiKey,
					apiKeyLength: apiKey?.length || 0,
					apiKeyPrefix: apiKey?.substring(0, 7) || 'none',
					hint: 'Check if API key is valid and has access to gpt-4o-mini model'
				});
			}

			return [];
		}

		const data = await response.json();
		const content = data.choices[0]?.message?.content || '[]';

		// Parse the JSON response
		try {
			const calls = JSON.parse(content);
			return Array.isArray(calls) ? calls : [];
		} catch (parseError) {
			logger.error('Failed to parse LLM response', { content, parseError });
			return [];
		}
	} catch (error) {
		clearTimeout(timeout);

		// Log timeout errors specifically
		if (error instanceof Error && error.name === 'AbortError') {
			logger.error('Timeout determining MCP calls after 15 seconds');
		} else {
			logger.error('Error calling OpenAI for endpoint determination', { error });
		}
		return [];
	}
}

/**
 * Map endpoint name (kebab-case) to MCP tool name (snake_case)
 */
function endpointToToolName(endpointName: string): string {
	return endpointName.replace(/-/g, '_');
}

/**
 * Execute the MCP calls determined by the LLM using the SDK (handles both prompts and endpoints)
 */
async function executeMCPCalls(
	calls: Array<{ endpoint?: string; prompt?: string; params: Record<string, string> }>,
	baseUrl: string,
	language: string = 'en',
	languageInfo?: { detectedLanguage?: string; needsValidation?: boolean }
): Promise<{ data: any[]; apiCalls: any[]; resolvedLanguage?: string }> {
	const data: any[] = [];
	const apiCalls: any[] = [];
	const serverUrl = `${baseUrl}/api/mcp`;
	let resolvedLanguage: string | undefined = undefined; // Track actual language used (may differ from input after variant retry)

	for (const call of calls) {
		const startTime = Date.now();
		try {
			// Check if this is a prompt or an endpoint
			// Also check if endpoint name is actually a prompt name (LLM might misclassify)
			const knownPrompts = [
				'translation-helps-report',
				'translation-helps-for-passage',
				'get-translation-words-for-passage',
				'get-translation-academy-for-passage'
			];
			const isPrompt = call.prompt || (call.endpoint && knownPrompts.includes(call.endpoint));

			if (isPrompt) {
				// Use the prompt name from either field
				const promptName = call.prompt || call.endpoint;
				// Handle MCP Prompt using SDK - use executePrompt to actually execute the workflow
				logger.info('Executing MCP prompt via SDK', { prompt: promptName, params: call.params });

				try {
					// Use executePrompt to actually execute the prompt workflow
					// executePrompt calls /api/execute-prompt which runs the full workflow
					// We need to use the full URL for server-side execution
					const executePromptUrl = `${baseUrl}/api/execute-prompt`;
					const startTime2 = Date.now();

					// Inject language into prompt parameters if not present (use base code)
					const promptParams = { ...call.params };
					if (!promptParams.language) {
						promptParams.language = language; // Use base code (es, fr, en)
					}
					const fetchResponse = await fetch(executePromptUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							promptName: promptName,
							parameters: promptParams
						})
					});

					if (!fetchResponse.ok) {
						const errorData = await fetchResponse.json().catch(() => ({ error: 'Unknown error' }));
						const error: any = new Error(errorData.error || `HTTP ${fetchResponse.status}`);
						// Attach full error details including verseNotFound, hasContextOnly, etc.
						error.status = fetchResponse.status;
						error.response = errorData;
						error.details = errorData.details;
						throw error;
					}

					const responseData = await fetchResponse.json();
					const duration = Date.now() - startTime;

					// Capture diagnostic headers
					const cacheStatus = fetchResponse.headers.get('X-Cache-Status');
					const xrayTrace = fetchResponse.headers.get('X-XRay-Trace');
					const responseTime = fetchResponse.headers.get('X-Response-Time');
					const traceId = fetchResponse.headers.get('X-Trace-Id');

					// Parse X-Ray trace if available
					let parsedXrayTrace: any = null;
					if (xrayTrace) {
						try {
							const cleaned = xrayTrace.replace(/\s+/g, '');
							parsedXrayTrace = JSON.parse(atob(cleaned));
						} catch (_e) {
							// Ignore parse errors
						}
					}

					// Build MCPResponse format with metadata
					const response: any = {
						content: [
							{
								type: 'text',
								text: JSON.stringify(responseData)
							}
						],
						metadata: {
							responseTime: responseTime
								? parseInt(responseTime.replace(/[^0-9]/g, ''), 10)
								: Date.now() - startTime2,
							cacheStatus: cacheStatus?.toLowerCase(),
							traceId,
							xrayTrace: parsedXrayTrace,
							statusCode: fetchResponse.status
						}
					};

					// Extract text from MCP response
					let result: any;
					if (response.content && response.content[0]?.text) {
						try {
							result = JSON.parse(response.content[0].text);
						} catch {
							result = response.content[0].text;
						}
					} else {
						result = response;
					}

					data.push({
						type: `prompt:${promptName}`,
						params: call.params,
						result
					});
					apiCalls.push({
						endpoint: `execute-prompt (${promptName})`,
						params: call.params,
						duration: `${duration}ms`,
						status: 200,
						cacheStatus: response.metadata?.cacheStatus || 'n/a',
						response: response // Include full MCP response with executed results (even on success)
					});
				} catch (error) {
					const duration = Date.now() - startTime;
					logger.error('MCP prompt failed via SDK', {
						prompt: promptName,
						error
					});

					// Try to extract full error details including response
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					let errorResponse: any = null;
					let errorStatus: number | undefined = undefined;

					// Check if error has response data (from SDK)
					if (error && typeof error === 'object') {
						// Check for common error response patterns
						if ('response' in error && error.response) {
							errorResponse = error.response;
						}
						if ('status' in error && typeof error.status === 'number') {
							errorStatus = error.status;
						}
						if ('statusCode' in error && typeof error.statusCode === 'number') {
							errorStatus = error.statusCode;
						}
						// Check if error has a data/body field with response content
						if ('data' in error && error.data) {
							errorResponse = error.data;
						}
						if ('body' in error && error.body) {
							errorResponse = error.body;
						}
					}

					// AUTOMATIC RETRY: Check if error has structured recovery data (prompts use tools internally)
					let retrySucceeded = false;
					const hasLanguageVariants = errorResponse?.details?.languageVariants?.length > 0;

					if (hasLanguageVariants) {
						logger.info('Prompt error has language variants - attempting automatic retry', {
							prompt: promptName,
							variants: errorResponse.details.languageVariants
						});

						try {
							const retryParams = { ...call.params };
							const suggestedLanguage = errorResponse.details.languageVariants[0];
							retryParams.language = suggestedLanguage;

							logger.info('Retrying prompt with suggested language', {
								original: call.params.language,
								suggested: suggestedLanguage
							});

							const retryStartTime = Date.now();
							const retryFetchResponse = await fetch(
								`${serverUrl}/api/execute-prompt/${promptName}?${new URLSearchParams(retryParams).toString()}`
							);
							const retryDuration = Date.now() - retryStartTime;

							if (retryFetchResponse.ok) {
								const retryResponseData = await retryFetchResponse.json();

								const retryResponse: any = {
									content: [
										{
											type: 'text',
											text: JSON.stringify(retryResponseData)
										}
									]
								};

								let retryResult: any;
								if (retryResponse.content && retryResponse.content[0]?.text) {
									try {
										retryResult = JSON.parse(retryResponse.content[0].text);
									} catch {
										retryResult = retryResponse.content[0].text;
									}
								} else {
									retryResult = retryResponse;
								}

								// Retry succeeded!
								retrySucceeded = true;

								// Track the resolved language from successful retry
								if (retryParams.language && retryParams.language !== language) {
									resolvedLanguage = retryParams.language;
									logger.info('Prompt retry succeeded with language variant', {
										prompt: promptName,
										originalLanguage: call.params.language,
										resolvedLanguage: retryParams.language
									});
								} else {
									logger.info('Prompt retry succeeded', { prompt: promptName, retryParams });
								}

								data.push({
									type: `prompt:${promptName}`,
									params: retryParams,
									result: retryResult
								});

								// Log both original error and successful retry
								apiCalls.push({
									endpoint: `execute-prompt (${promptName})`,
									params: call.params,
									duration: `${duration}ms`,
									status: errorStatus || 500,
									error: `${errorMessage} (auto-retried)`,
									response: errorResponse
								});

								apiCalls.push({
									endpoint: `execute-prompt (${promptName})`,
									params: retryParams,
									duration: `${retryDuration}ms`,
									status: 200,
									cacheStatus: 'n/a',
									response: retryResponse,
									isRetry: true
								});
							}
						} catch (retryError) {
							logger.error('Prompt retry attempt failed', {
								prompt: promptName,
								retryError
							});
						}
					}

					// If retry didn't succeed, log the original error
					if (!retrySucceeded) {
						apiCalls.push({
							endpoint: `execute-prompt (${promptName})`,
							params: call.params,
							duration: `${duration}ms`,
							status: errorStatus || 500,
							error: errorMessage,
							response: errorResponse // Include full response for debugging
						});

						// Add error to data array for LLM to see, especially for verse not found errors
						// This ensures the LLM can provide a helpful response instead of failing silently
						const errorItem = {
							type: `prompt:${promptName}`,
							params: call.params,
							error: errorMessage,
							errorDetails: errorResponse?.details || null,
							status: errorStatus || 500
						};
						logger.info('[executeMCPCalls] Adding error to data array for LLM', {
							errorItem,
							hasDetails: !!errorResponse?.details,
							verseNotFound: errorResponse?.details?.verseNotFound,
							explicitError: errorResponse?.details?.explicitError
						});
						data.push(errorItem);
					}
				}
				continue;
			}

			// Handle individual endpoint using SDK
			const endpointName = (call.endpoint || '')
				.toString()
				.replace(/^\/api\//, '')
				.replace(/^\//, '');

			// Convert endpoint name to tool name (kebab-case → snake_case)
			const toolName = endpointToToolName(endpointName);

			// Normalize params with sensible defaults to avoid LLM omissions
			const normalizedParams: Record<string, any> = {
				...call.params
			};

			// Language parameter handling with detected language override
			if (!normalizedParams.language) {
				// No language provided - use detected or default
				normalizedParams.language = languageInfo?.detectedLanguage || language;
			} else if (
				languageInfo?.detectedLanguage &&
				normalizedParams.language !== languageInfo.detectedLanguage &&
				languageInfo.needsValidation
			) {
				// LLM provided language doesn't match detected - override with detected
				// This fixes cases where LLM reuses old language from previous request
				logger.info('Overriding LLM language param with detected language', {
					llmProvided: normalizedParams.language,
					detected: languageInfo.detectedLanguage
				});
				normalizedParams.language = languageInfo.detectedLanguage;
			}

			// Clean up invalid parameters for fetch_translation_word
			if (toolName === 'fetch_translation_word') {
				// Reference is not required for this endpoint; ignore if present
				if (normalizedParams.reference && !normalizedParams.term) {
					// Keep reference if no term provided (for reference-based lookup)
				}
				// If LLM supplied an invalid path (e.g., "bible"), drop it to avoid 400s
				if (normalizedParams.path && !/\.md$/i.test(normalizedParams.path)) {
					delete normalizedParams.path;
				}
			}

			// Chat interface needs JSON for structured data processing
			// Explicitly set format to JSON to get structured response with all versions
			normalizedParams.format = 'json';

			logger.info('Executing MCP tool via SDK', { tool: toolName, params: normalizedParams });

			try {
				const response = await callTool(toolName, normalizedParams, serverUrl);
				const duration = Date.now() - startTime;

				// Extract result from MCP response
				let result: any;
				if (response.content && response.content[0]?.text) {
					const text = response.content[0].text;
					// Try to parse as JSON, fallback to text
					try {
						result = JSON.parse(text);
					} catch {
						result = text;
					}
				} else {
					result = response;
				}

				data.push({
					type: endpointName,
					params: normalizedParams,
					result
				});
				apiCalls.push({
					endpoint: endpointName,
					params: normalizedParams,
					duration: `${duration}ms`,
					status: 200,
					cacheStatus: 'n/a', // SDK doesn't expose cache status, could be enhanced
					response: response // Include full MCP response for debugging (even on success)
				});
			} catch (error) {
				const duration = Date.now() - startTime;
				logger.error('MCP tool call failed via SDK', {
					tool: toolName,
					error
				});

				// Try to extract full error details including response
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				let errorResponse: any = null;
				let errorStatus: number | undefined = undefined;
				let errorDetails: any = {};

				// Check if error has response data (from SDK)
				if (error && typeof error === 'object') {
					// Extract error details directly from error object (SDK attaches these)
					if ('details' in error && error.details) {
						errorDetails = error.details;
						console.log('[CHAT] ✅ Error has details:', Object.keys(errorDetails));
					}

					// Extract direct attachments from SDK (validBookCodes, languageVariants)
					if ('validBookCodes' in error) {
						errorDetails.validBookCodes = (error as any).validBookCodes;
						errorDetails.invalidCode = (error as any).invalidCode;
						console.log('[CHAT] ✅ Found validBookCodes:', errorDetails.validBookCodes.length);
					}
					if ('languageVariants' in error) {
						errorDetails.languageVariants = (error as any).languageVariants;
						errorDetails.requestedLanguage = (error as any).requestedLanguage;
						console.log('[CHAT] ✅ Found languageVariants:', errorDetails.languageVariants);
					}

					console.log('[CHAT] 🔍 Final errorDetails for retry check:', {
						hasLanguageVariants: !!errorDetails.languageVariants,
						hasValidBookCodes: !!errorDetails.validBookCodes,
						errorDetails
					});

					// Check for common error response patterns
					if ('response' in error && error.response) {
						errorResponse = error.response;
					}
					if ('status' in error && typeof error.status === 'number') {
						errorStatus = error.status;
					}
					if ('statusCode' in error && typeof error.statusCode === 'number') {
						errorStatus = error.statusCode;
					}
					// Check if error has a data/body field with response content
					if ('data' in error && error.data) {
						errorResponse = error.data;
					}
					if ('body' in error && error.body) {
						errorResponse = error.body;
					}
				}

				// AUTOMATIC RETRY: Check if error has structured recovery data
				// Check both errorDetails (from SDK) and errorResponse.details (from nested structure)
				let retrySucceeded = false;
				const hasLanguageVariants =
					errorDetails?.languageVariants?.length > 0 ||
					errorResponse?.details?.languageVariants?.length > 0;
				const hasValidBookCodes =
					errorDetails?.validBookCodes?.length > 0 ||
					errorResponse?.details?.validBookCodes?.length > 0;

				console.log('[CHAT] 🔄 Retry check:', {
					hasLanguageVariants,
					hasValidBookCodes,
					languageVariants:
						errorDetails?.languageVariants || errorResponse?.details?.languageVariants,
					validBookCodes: errorDetails?.validBookCodes || errorResponse?.details?.validBookCodes
				});

				if (hasLanguageVariants || hasValidBookCodes) {
					console.log('[CHAT] ✅ RETRY TRIGGERED - Recovery data found');
					logger.info('Error has recovery data - attempting automatic retry', {
						tool: toolName,
						hasLanguageVariants,
						hasValidBookCodes,
						errorDetails
					});

					// Build retry parameters (declare outside try for catch block access)
					const retryParams = { ...normalizedParams };

					try {
						if (hasLanguageVariants) {
							// Get language variants from errorDetails or nested response
							const variants =
								errorDetails?.languageVariants || errorResponse?.details?.languageVariants;
							const suggestedLanguage = variants[0];
							retryParams.language = suggestedLanguage;

							logger.info('Retrying with suggested language variant', {
								original: normalizedParams.language,
								suggested: suggestedLanguage,
								allVariants: variants
							});
						} else if (hasValidBookCodes) {
							// Retry with first valid book code (if reference parsing failed)
							// This is more complex - would need to re-parse reference with suggested code
							// For now, skip auto-retry for book codes (too complex)
							logger.info('Book code error detected, but auto-retry not implemented for this case');
						}

						// Only retry if we modified parameters
						if (JSON.stringify(retryParams) !== JSON.stringify(normalizedParams)) {
							const retryStartTime = Date.now();
							logger.info('Executing retry with modified parameters', { retryParams });

							const retryResponse = await callTool(toolName, retryParams, serverUrl);
							const retryDuration = Date.now() - retryStartTime;

							// Extract result from retry
							let retryResult: any;
							if (retryResponse.content && retryResponse.content[0]?.text) {
								const text = retryResponse.content[0].text;
								try {
									retryResult = JSON.parse(text);
								} catch {
									retryResult = text;
								}
							} else {
								retryResult = retryResponse;
							}

							// Retry succeeded!
							retrySucceeded = true;
							console.log('[CHAT] ✅ RETRY SUCCEEDED with params:', retryParams);

							// Track the resolved language from successful retry
							if (retryParams.language && retryParams.language !== language) {
								resolvedLanguage = retryParams.language;
								logger.info('Endpoint retry succeeded with language variant', {
									tool: toolName,
									originalLanguage: normalizedParams.language,
									resolvedLanguage: retryParams.language
								});
							} else {
								logger.info('Retry succeeded', { tool: toolName, retryParams });
							}

							// Add successful retry result to data
							data.push({
								type: endpointName,
								params: retryParams,
								result: retryResult
							});

							// Log both the original error and successful retry
							apiCalls.push({
								endpoint: endpointName,
								params: normalizedParams,
								duration: `${duration}ms`,
								status: errorStatus || 500,
								error: `${errorMessage} (auto-retried)`,
								response: {
									...errorResponse,
									details: errorDetails // Ensure details are included
								}
							});

							apiCalls.push({
								endpoint: endpointName,
								params: retryParams,
								duration: `${retryDuration}ms`,
								status: 200,
								cacheStatus: 'n/a',
								response: retryResponse,
								isRetry: true
							});
						}
					} catch (retryError) {
						// Check if retry "failed" but actually has useful recovery data (availableBooks)
						const retryErrorObj = retryError as any;
						const hasAvailableBooks =
							retryErrorObj?.availableBooks?.length > 0 ||
							retryErrorObj?.details?.availableBooks?.length > 0;

						if (hasAvailableBooks) {
							// This is actually a "successful" retry - we found the language variant
							// and got useful information (available books)
							console.log('[CHAT] ✅ Retry provided useful data (availableBooks)');

							// Track the resolved language from this retry
							if (retryParams.language && retryParams.language !== language) {
								resolvedLanguage = retryParams.language;
							}

							logger.info('Retry provided useful recovery data', {
								tool: toolName,
								availableBooksCount:
									retryErrorObj?.availableBooks?.length ||
									retryErrorObj?.details?.availableBooks?.length,
								resolvedLanguage: resolvedLanguage
							});

							// Extract the retry error details
							let retryErrorDetails: any = {};
							if (retryErrorObj?.details) {
								retryErrorDetails = retryErrorObj.details;
							}
							if (retryErrorObj?.availableBooks) {
								retryErrorDetails.availableBooks = retryErrorObj.availableBooks;
								retryErrorDetails.requestedBook = retryErrorObj.requestedBook;
								retryErrorDetails.language = retryErrorObj.language;
							}

							// Log the retry as providing useful data (not a failure)
							apiCalls.push({
								endpoint: endpointName,
								params: normalizedParams,
								duration: `${duration}ms`,
								status: errorStatus || 500,
								error: `${errorMessage} (auto-retried)`,
								response: {
									...errorResponse,
									details: errorDetails
								}
							});

							apiCalls.push({
								endpoint: endpointName,
								params: retryParams,
								duration: `${Date.now() - startTime}ms`,
								status: 404, // Book not found, but language was found
								error:
									retryErrorObj instanceof Error ? retryErrorObj.message : 'Book not available',
								response: {
									details: retryErrorDetails
								},
								isRetry: true
							});

							// Mark as "succeeded" so we don't show the original error
							retrySucceeded = true;
						} else {
							logger.error('Retry attempt failed', {
								tool: toolName,
								retryError
							});
							// Continue with original error handling
						}
					}
				}

				// If retry didn't succeed, log the original error with full details
				if (!retrySucceeded) {
					apiCalls.push({
						endpoint: endpointName,
						params: normalizedParams,
						duration: `${duration}ms`,
						status: errorStatus || 500,
						error: errorMessage,
						response: {
							...errorResponse,
							details: errorDetails // Ensure details (with languageVariants) are included
						}
					});

					// Add error to data array for LLM to see, especially for verse not found errors
					// This ensures the LLM can provide a helpful response instead of failing silently
					const errorItem = {
						type: endpointName,
						params: normalizedParams,
						error: errorMessage,
						errorDetails: errorDetails || null,
						status: errorStatus || 500
					};
					logger.info('[executeMCPCalls] Adding tool error to data array for LLM', {
						tool: toolName,
						errorItem,
						hasDetails: !!errorDetails,
						verseNotFound: errorDetails?.verseNotFound,
						explicitError: errorDetails?.explicitError
					});
					data.push(errorItem);
				}
			}
		} catch (error) {
			logger.error('Failed to execute MCP call', {
				endpoint: (call.endpoint || '').toString(),
				error
			});

			// Try to extract full error details including response
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			let errorResponse: any = null;
			let errorStatus: number | undefined = undefined;

			// Check if error has response data
			if (error && typeof error === 'object') {
				if ('response' in error && error.response) {
					errorResponse = error.response;
				}
				if ('status' in error && typeof error.status === 'number') {
					errorStatus = error.status;
				}
				if ('statusCode' in error && typeof error.statusCode === 'number') {
					errorStatus = error.statusCode;
				}
				if ('data' in error && error.data) {
					errorResponse = error.data;
				}
				if ('body' in error && error.body) {
					errorResponse = error.body;
				}
			}

			apiCalls.push({
				endpoint: (call.endpoint || '').toString(),
				params: { ...call.params },
				duration: `${Date.now() - startTime}ms`,
				status: errorStatus || 500,
				error: errorMessage,
				response: errorResponse // Include full response for debugging
			});
		}
	}

	return { data, apiCalls, resolvedLanguage };
}

/**
 * Format MCP data for OpenAI context
 */
function formatDataForContext(data: any[]): string {
	let context = 'Available MCP Data:\n\n';

	for (const item of data) {
		const format = item.params?.format || 'json';

		// If the response is already in Markdown or Text format, use it directly
		if (format === 'md' || format === 'text') {
			if (typeof item.result === 'string') {
				context += `[${item.type} - ${JSON.stringify(item.params)}]\n${item.result}\n\n`;
				continue;
			}
		}

		// Handle JSON responses with structure
		if (item.type === 'fetch-scripture') {
			// Handle different result structures from fetch_scripture tool
			let scriptures: any[] = [];

			// Check if result has scripture array directly
			if (item.result?.scripture && Array.isArray(item.result.scripture)) {
				scriptures = item.result.scripture;
			}
			// Check if result has scriptures array (plural)
			else if (item.result?.scriptures && Array.isArray(item.result.scriptures)) {
				scriptures = item.result.scriptures;
			}
			// Check if result is a JSON string that needs parsing (when format="json" and multiple scriptures)
			else if (typeof item.result === 'string') {
				try {
					const parsed = JSON.parse(item.result);
					if (parsed.scriptures && Array.isArray(parsed.scriptures)) {
						scriptures = parsed.scriptures;
					} else if (parsed.scripture && Array.isArray(parsed.scripture)) {
						scriptures = parsed.scripture;
					}
				} catch {
					// Not JSON, might be text format with multiple versions joined
					// In this case, the MCP tool already formatted it as "ULT: text\n\nUST: text"
					context += `Scripture for ${item.params.reference}:\n${item.result}\n\n`;
					continue;
				}
			}
			// Check if result.content is an array (MCP response format)
			else if (item.result?.content && Array.isArray(item.result.content)) {
				// Try to parse JSON from content[0].text if format is JSON
				if (format === 'json' && item.result.content[0]?.text) {
					try {
						const parsed = JSON.parse(item.result.content[0].text);
						if (parsed.scriptures && Array.isArray(parsed.scriptures)) {
							scriptures = parsed.scriptures;
						}
					} catch {
						// Not JSON, use as-is
					}
				}
			}

			// If we found scriptures array, format all of them
			if (scriptures.length > 0) {
				context += `Scripture for ${item.params.reference}:\n`;
				for (const verse of scriptures) {
					context += `- ${verse.translation || verse.name || 'Unknown'}: "${verse.text}"\n`;
				}
				context += '\n';
			} else if (item.result) {
				// Fallback: include the result as-is
				context += `Scripture for ${item.params.reference}:\n${JSON.stringify(item.result, null, 2)}\n\n`;
			}
		} else if (
			item.type === 'translation-notes' &&
			(item.result.verseNotes || item.result.contextNotes)
		) {
			const metadata = item.result.metadata || {};
			const source = metadata.source || 'TN';
			const version = metadata.version || '';

			// VERSE-SPECIFIC NOTES (for the exact reference)
			if (item.result.verseNotes && item.result.verseNotes.length > 0) {
				context += `\n=== Translation Notes for ${item.params.reference} [${source} ${version}] ===\n`;
				context += `COUNT: ${item.result.verseNotes.length} notes - you MUST show all ${item.result.verseNotes.length} individually\n`;
				context += `FORMAT: For each note, quote the ACTUAL WORDS FROM THE SCRIPTURE TEXT (not Greek, not labels)\n`;
				context += `The Quote field shows Greek/Hebrew - find where it appears TRANSLATED in the scripture text.\n`;
				context += `Example: If Quote="ἀρχαῖς" and scripture has "gobernantes", show **«gobernantes»** not **ἀρχαῖς**\n\n`;
				for (const note of item.result.verseNotes) {
					const noteRef = note.Reference || item.params.reference;
					context += `- Quote (Greek): ${note.Quote || 'General'}\n  Note: ${note.Note}\n  [${source} ${version} - ${noteRef}]\n\n`;
				}
			}

			// CONTEXTUAL NOTES (background information)
			if (item.result.contextNotes && item.result.contextNotes.length > 0) {
				context += `\n=== Background Context [${source} ${version}] ===\n`;
				for (const note of item.result.contextNotes) {
					const contextLabel =
						note.contextType === 'book' ? 'Book Introduction' : 'Chapter Introduction';
					context += `\n--- ${contextLabel} (${note.Reference}) ---\n`;
					context += `${note.Note}\n`;
				}
			}
			context += '\n';
		} else if (item.type === 'translation-questions' && item.result.items) {
			const metadata = item.result.metadata || {};
			const source = metadata.source || 'TQ';
			const version = metadata.version || '';
			context += `Study Questions for ${item.params.reference} [${source} ${version}]:\n`;
			for (const q of item.result.items) {
				const qRef = q.Reference || item.params.reference;
				context += `- Q: ${q.Question}\n  A: ${q.Response} [${source} ${version} - ${qRef}]\n`;
			}
			context += '\n';
		} else if (item.type === 'fetch-translation-words' && item.result.items) {
			const metadata = item.result.metadata || {};
			const source = metadata.source || 'TW';
			const version = metadata.version || '';
			context += `Translation Words [${source} ${version}]:\n`;
			for (const word of item.result.items) {
				context += `- ${word.term}: ${word.definition} [${source} ${version}]\n`;
			}
			context += '\n';
		} else if (
			(item.type === 'fetch-translation-word' || item.type === 'get-translation-word') &&
			item.result &&
			typeof item.result === 'object'
		) {
			// Handle translation word articles - can be single article or articles array
			if (item.result.articles && Array.isArray(item.result.articles)) {
				// Multiple articles (from fetch-translation-word MCP tool)
				for (const article of item.result.articles) {
					context += `\n=== Translation Word Article ===\n`;
					context += `Title: ${article.title || '(no title)'}\n`;
					if (article.subtitle) context += `Subtitle: ${article.subtitle}\n`;
					if (article.id) context += `ID: ${article.id}\n`;
					if (article.category) context += `Category: ${article.category}\n`;
					if (article.url) context += `URL: ${article.url}\n`;
					// CRITICAL: Include the FULL markdown content
					if (article.content) {
						context += `\n--- Full Article Content (Markdown) ---\n`;
						context += `${article.content}\n`;
						context += `--- End of Article Content ---\n`;
					}
					context += '\n';
				}
			} else if (item.result.word) {
				// Single article from HTTP endpoint (legacy format)
				const w = item.result.word;
				context += `\n=== Translation Word Article ===\n`;
				context += `Title: ${w.title || w.term || '(unknown)'}\n`;
				if (w.subtitle) context += `Subtitle: ${w.subtitle}\n`;
				if (w.id) context += `ID: ${w.id}\n`;
				if (w.category) context += `Category: ${w.category}\n`;
				// CRITICAL: Include the FULL markdown content
				if (w.content) {
					context += `\n--- Full Article Content (Markdown) ---\n`;
					context += `${w.content}\n`;
					context += `--- End of Article Content ---\n`;
				}
				context += '\n';
			} else {
				// Fallback: try to extract article data from result directly
				const w = item.result;
				context += `\n=== Translation Word Article ===\n`;
				context += `Title: ${w.title || w.term || '(unknown)'}\n`;
				if (w.subtitle) context += `Subtitle: ${w.subtitle}\n`;
				if (w.id) context += `ID: ${w.id}\n`;
				if (w.category) context += `Category: ${w.category}\n`;
				// CRITICAL: Include the FULL markdown content
				if (w.content) {
					context += `\n--- Full Article Content (Markdown) ---\n`;
					context += `${w.content}\n`;
					context += `--- End of Article Content ---\n`;
				}
				context += '\n';
			}
		} else if (item.error) {
			// Handle both prompt and tool errors (e.g., verse not found)
			// Provide the error details to the LLM so it can give a helpful response
			const isPrompt = item.type?.startsWith('prompt:');
			const itemName = isPrompt ? item.type.replace('prompt:', '') : item.type;
			const itemLabel = isPrompt ? 'Prompt' : 'Tool';

			logger.info(`[buildContext] Processing ${itemLabel.toLowerCase()} error for LLM`, {
				type: item.type,
				hasError: !!item.error,
				hasDetails: !!item.errorDetails,
				verseNotFound: item.errorDetails?.verseNotFound,
				explicitError: item.errorDetails?.explicitError
			});

			context += `\n=== ${itemLabel} Error ===\n`;
			context += `${itemLabel}: ${itemName}\n`;
			context += `Error: ${item.error}\n`;

			if (item.errorDetails) {
				// Include specific error details that help the LLM understand what went wrong
				if (item.errorDetails.verseNotFound) {
					context += `⚠️ VERSE NOT FOUND: ${item.errorDetails.requestedBook} ${item.errorDetails.chapter}:${item.errorDetails.verse}\n`;
					context += `This verse does not exist in the requested resources.\n`;
					context += `DO NOT make up or fabricate scripture text for verses that don't exist.\n`;
				}
				if (item.errorDetails.hasContextOnly) {
					context += `Note: Only book/chapter context is available, no verse-specific notes.\n`;
				}
				if (item.errorDetails.languageVariants?.length > 0) {
					context += `Suggested language variants: ${item.errorDetails.languageVariants.join(', ')}\n`;
				}
				if (item.errorDetails.explicitError) {
					context += `Error Type: ${item.errorDetails.explicitError}\n`;
				}
			}
			context += '\n';
		} else if (item.type?.startsWith('prompt:') && item.result) {
			// Handle prompt results (e.g., translation-helps-for-passage)
			// Prompt results can contain scripture, notes, questions, words, and academy articles

			// Try to extract data from MCP response format: content[0].text
			let promptData: any = null;

			// First, check if result is already the parsed data (from executeMCPCalls)
			if (item.result && typeof item.result === 'object' && !item.result.content) {
				// Direct object format - already parsed
				promptData = item.result;
			} else if (
				item.result.content &&
				Array.isArray(item.result.content) &&
				item.result.content[0]?.text
			) {
				// MCP response format: content[0].text
				if (typeof item.result.content[0].text === 'string') {
					try {
						promptData = JSON.parse(item.result.content[0].text);
					} catch {
						// Not JSON, might be text format
						promptData = item.result.content[0].text;
					}
				} else {
					// Already an object
					promptData = item.result.content[0].text;
				}
			} else if (item.result && typeof item.result === 'object') {
				// Fallback: try direct object format
				promptData = item.result;
			}

			if (promptData) {
				// Handle scripture
				if (promptData.scripture?.text) {
					context += `Scripture for ${item.params?.reference || 'passage'}:\n"${promptData.scripture.text}"\n\n`;
				}

				// Handle notes (new shape: verseNotes + contextNotes)
				if (promptData.notes && (promptData.notes.verseNotes || promptData.notes.contextNotes)) {
					const metadata = promptData.notes.metadata || {};
					const source = metadata.source || 'TN';
					const version = metadata.version || '';

					// VERSE-SPECIFIC NOTES (for the exact reference)
					if (promptData.notes.verseNotes && promptData.notes.verseNotes.length > 0) {
						context += `\n=== Translation Notes for ${item.params?.reference || 'passage'} [${source} ${version}] ===\n`;
						context += `COUNT: ${promptData.notes.verseNotes.length} notes - you MUST show all ${promptData.notes.verseNotes.length} individually\n`;
						context += `FORMAT: Quote the ACTUAL WORDS FROM THE SCRIPTURE TEXT (not Greek, not labels, not alternatives)\n`;
						context += `The Quote field shows Greek/Hebrew - find where it appears TRANSLATED in the scripture text.\n`;
						context += `Example: Quote="ἀρχαῖς" + scripture has "gobernantes" → show **«gobernantes»** (not ἀρχαῖς)\n\n`;
						for (const note of promptData.notes.verseNotes) {
							const noteRef = note.Reference || item.params?.reference || 'passage';
							context += `- Quote (Greek): ${note.Quote || 'General'}\n  Note: ${note.Note}\n  [${source} ${version} - ${noteRef}]\n\n`;
						}
					}

					// CONTEXTUAL NOTES (background information)
					if (promptData.notes.contextNotes && promptData.notes.contextNotes.length > 0) {
						context += `\n=== Background Context [${source} ${version}] ===\n`;
						for (const note of promptData.notes.contextNotes) {
							const contextLabel =
								note.contextType === 'book' ? 'Book Introduction' : 'Chapter Introduction';
							context += `\n--- ${contextLabel} (${note.Reference}) ---\n`;
							context += `${note.Note}\n`;
						}
					}
					context += '\n';
				}

				// Handle questions
				if (promptData.questions?.items && Array.isArray(promptData.questions.items)) {
					const metadata = promptData.questions.metadata || {};
					const source = metadata.source || 'TQ';
					const version = metadata.version || '';
					context += `Study Questions for ${item.params?.reference || 'passage'} [${source} ${version}]:\n`;
					for (const q of promptData.questions.items) {
						const qRef = q.Reference || item.params?.reference || 'passage';
						context += `- Q: ${q.Question}\n  A: ${q.Response} [${source} ${version} - ${qRef}]\n`;
					}
					context += '\n';
				}

				// Handle translation words
				if (promptData.words && Array.isArray(promptData.words)) {
					context += `Translation Words:\n`;
					for (const word of promptData.words) {
						context += `\n=== Translation Word Article ===\n`;
						context += `Title: ${word.title || word.term || '(no title)'}\n`;
						if (word.category) context += `Category: ${word.category}\n`;
						// CRITICAL: Include the FULL markdown content
						if (word.content) {
							context += `\n--- Full Article Content (Markdown) ---\n`;
							context += `${word.content}\n`;
							context += `--- End of Article Content ---\n`;
						}
						context += '\n';
					}
				}

				// Handle academy articles - CRITICAL: Include FULL content
				if (promptData.academyArticles && Array.isArray(promptData.academyArticles)) {
					context += `\n🎓 Translation Academy Articles (${promptData.academyArticles.length} found):\n`;
					for (const article of promptData.academyArticles) {
						context += `\n=== Translation Academy Article ===\n`;
						context += `Title: ${article.title || article.moduleId || '(no title)'}\n`;
						if (article.moduleId) context += `Module ID: ${article.moduleId}\n`;
						if (article.rcLink) context += `RC Link: ${article.rcLink}\n`;
						if (article.path) context += `Path: ${article.path}\n`;
						if (article.category) context += `Category: ${article.category}\n`;
						// CRITICAL: Include the FULL markdown content - DO NOT SUMMARIZE
						// The LLM MUST copy this entire section verbatim when asked for the complete article
						if (article.content) {
							context += `\n--- Full Article Content (Markdown) ---\n`;
							context += `${article.content}\n`;
							context += `--- End of Article Content ---\n`;
							context += `\n⚠️ IMPORTANT: When the user asks for "the whole article" or "the complete article" about this concept, you MUST copy the ENTIRE content above (between "--- Full Article Content (Markdown) ---" and "--- End of Article Content ---") verbatim. Do NOT summarize, do NOT paraphrase, do NOT create your own explanation.\n`;
						}
						context += '\n';
					}
				}
			} else {
				// Fallback: include the result as-is
				context += `[${item.type}]\n${JSON.stringify(item.result, null, 2)}\n\n`;
			}
		} else {
			// Fallback for any other data type
			context += `[${item.type}]\n${JSON.stringify(item.result, null, 2)}\n\n`;
		}
	}

	return context;
}

/**
 * Calculate approximate token count (rough estimate: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Call OpenAI with our data and rules
 */
async function callOpenAI(
	message: string,
	context: string,
	chatHistory: Array<{ role: string; content: string }> = [],
	apiKey: string,
	endpointCalls?: Array<{ endpoint?: string; prompt?: string; params: Record<string, string> }>,
	catalogLanguage: string = 'en',
	languageInfo?: {
		detectedLanguage: string | null;
		needsValidation: boolean;
		languageVariants?: Array<{ code: string; name: string }>;
	}
): Promise<{
	response: string;
	error?: string;
	metrics?: { promptTokens: number; totalTokens: number; promptType: string };
}> {
	if (!apiKey) {
		return {
			response: '',
			error: 'OpenAI API key not provided to callOpenAI function.'
		};
	}

	try {
		// Build optimized prompt with contextual rules using SDK
		const requestType = endpointCalls
			? detectRequestType(endpointCalls as EndpointCall[], message)
			: undefined;
		let systemPrompt = USE_OPTIMIZED_PROMPT
			? getSystemPrompt(requestType, endpointCalls as EndpointCall[] | undefined, message)
			: SYSTEM_PROMPT_LEGACY;

		// Add minimal language context
		let languageContext = `\n\n**LANGUAGE:** Use base code (es, fr, en). Default: ${catalogLanguage}`;

		// Add language detection context if needed
		if (languageInfo?.detectedLanguage && languageInfo.detectedLanguage !== catalogLanguage) {
			languageContext += `\n**DETECTED:** ${languageInfo.detectedLanguage} - use this code`;
		}

		// Add book code guidance
		languageContext += `\n\n**BIBLE REFERENCES:** ALWAYS use standard 3-letter book codes (GEN, EXO, JHN, TIT, etc.), NEVER full book names. When user says "John 3:16" or "Titus 1:15", convert to "JHN 3:16" or "TIT 1:15" before calling tools.`;

		// Add proactive tool suggestions guidance (applies to both optimized and legacy prompts)
		const proactiveSuggestions = `\n\n**PROACTIVE TOOL SUGGESTIONS:**
After providing scripture, ALWAYS suggest relevant tools:
"Would you like me to show you:
- **Translation notes** (explains difficult phrases)
- **Key terms** (biblical definitions)
- **Comprehension questions** (check understanding)
- **Translation concepts** (academy articles)"

Don't end with "feel free to ask" - be specific about available tools!`;

		systemPrompt = systemPrompt + languageContext + proactiveSuggestions;

		const messages = [
			{ role: 'system', content: systemPrompt },
			{ role: 'system', content: context },
			...chatHistory.slice(-6), // Keep last 6 messages for context
			{ role: 'user', content: message }
		];

		// Calculate token metrics
		const promptTokens = estimateTokens(
			systemPrompt +
				context +
				message +
				chatHistory
					.slice(-6)
					.map((m) => m.content)
					.join('')
		);

		// Add timeout using AbortController
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: 'gpt-4o-mini',
					messages,
					temperature: 0.3, // Lower temperature for more factual responses
					max_tokens: 2000 // Enough for overviews with titles and follow-up questions
				}),
				signal: controller.signal
			});
			clearTimeout(timeout);

			if (!response.ok) {
				const error = await response.text();
				logger.error('OpenAI API error', { status: response.status, error });
				return {
					response: '',
					error: `OpenAI API error: ${response.status}`
				};
			}

			const data = await response.json();
			const responseText = data.choices[0]?.message?.content || 'No response generated';
			const responseTokens = estimateTokens(responseText);
			const totalTokens = promptTokens + responseTokens;

			// Log metrics
			logger.info('OpenAI call metrics', {
				promptType: USE_OPTIMIZED_PROMPT ? 'optimized' : 'legacy',
				requestType,
				promptTokens,
				responseTokens,
				totalTokens,
				promptSize: systemPrompt.length,
				contextSize: context.length,
				tokenReduction: USE_OPTIMIZED_PROMPT
					? `${Math.round((1 - promptTokens / estimateTokens(SYSTEM_PROMPT_LEGACY + context + message)) * 100)}%`
					: '0%'
			});

			return {
				response: responseText,
				metrics: {
					promptTokens,
					totalTokens,
					promptType: USE_OPTIMIZED_PROMPT ? 'optimized' : 'legacy'
				}
			};
		} catch (error) {
			clearTimeout(timeout);
			logger.error('Failed to call OpenAI', { error });

			// Handle timeout specifically
			if (error instanceof Error && error.name === 'AbortError') {
				return {
					response: '',
					error: 'Request timed out after 30 seconds. Please try again.'
				};
			}

			return {
				response: '',
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	} catch (error) {
		logger.error('Failed to call OpenAI', { error });
		return {
			response: '',
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/**
 * Stream OpenAI responses via SSE-compatible Web Streams API
 */
async function callOpenAIStream(
	message: string,
	context: string,
	chatHistory: Array<{ role: string; content: string }> = [],
	apiKey: string,
	xrayInit?: any,
	preTimings?: Record<string, number>,
	overallStartTime?: number,
	endpointCalls?: Array<{ endpoint?: string; prompt?: string; params: Record<string, string> }>,
	catalogLanguage: string = 'en',
	languageInfo?: {
		detectedLanguage: string | null;
		needsValidation: boolean;
		languageVariants?: Array<{ code: string; name: string }>;
	}
): Promise<ReadableStream<Uint8Array>> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	const stream = new ReadableStream<Uint8Array>({
		start: async (controller) => {
			try {
				// Build optimized prompt with contextual rules using SDK
				const requestType = endpointCalls
					? detectRequestType(endpointCalls as EndpointCall[], message)
					: undefined;
				let systemPrompt = USE_OPTIMIZED_PROMPT
					? getSystemPrompt(requestType, endpointCalls as EndpointCall[] | undefined, message)
					: SYSTEM_PROMPT_LEGACY;

				// Add minimal language context
				let languageContext = `\n\n**LANGUAGE:** Use base code (es, fr, en). Default: ${catalogLanguage}`;

				// Add language detection context if needed
				if (languageInfo?.detectedLanguage && languageInfo.detectedLanguage !== catalogLanguage) {
					languageContext += `\n**DETECTED:** ${languageInfo.detectedLanguage} - use this code`;
				}

				// Add book code guidance
				languageContext += `\n\n**BIBLE REFERENCES:** ALWAYS use standard 3-letter book codes (GEN, EXO, JHN, TIT, etc.), NEVER full book names. When user says "John 3:16" or "Titus 1:15", convert to "JHN 3:16" or "TIT 1:15" before calling tools.`;

				// Add proactive tool suggestions guidance
				const proactiveSuggestions = `\n\n**PROACTIVE TOOL SUGGESTIONS:**
After providing scripture, ALWAYS suggest relevant tools:
"Would you like me to show you:
- **Translation notes** (explains difficult phrases)
- **Key terms** (biblical definitions)
- **Comprehension questions** (check understanding)
- **Translation concepts** (academy articles)"

Don't end with "feel free to ask" - be specific about available tools!`;

				systemPrompt = systemPrompt + languageContext + proactiveSuggestions;

				const messages = [
					{ role: 'system', content: systemPrompt },
					{ role: 'system', content: context },
					...chatHistory.slice(-6),
					{ role: 'user', content: message }
				];

				// Calculate token metrics
				const promptTokens = estimateTokens(
					systemPrompt +
						context +
						message +
						chatHistory
							.slice(-6)
							.map((m) => m.content)
							.join('')
				);
				let responseTokens = 0;

				// Helper to emit SSE data events
				const emit = (event: string, data: unknown) => {
					const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(payload));
				};

				const llmStart = Date.now();
				const response = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${apiKey}`
					},
					body: JSON.stringify({
						model: 'gpt-4o-mini',
						messages,
						temperature: 0.3,
						stream: true,
						max_tokens: 2000 // Enough for overviews with titles and follow-up questions
					})
				});

				if (!response.ok || !response.body) {
					const msg =
						`event: error\n` +
						`data: ${JSON.stringify({ error: `OpenAI error: ${response.status}` })}\n\n`;
					controller.enqueue(encoder.encode(msg));
					controller.close();
					return;
				}

				const reader = response.body.getReader();
				let buffer = '';

				// Signal start
				emit('llm:start', { started: true });

				// Emit initial X-ray snapshot if provided
				if (xrayInit) {
					emit('xray', xrayInit);
				}

				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });

					const parts = buffer.split('\n\n');
					buffer = parts.pop() || '';

					for (const part of parts) {
						const line = part.trim();
						if (!line.startsWith('data:')) continue;
						const jsonStr = line.replace(/^data:\s*/, '');
						if (jsonStr === '[DONE]') {
							// Final X-ray update with llmResponse timing if possible
							try {
								const finalTimings: Record<string, number> = { ...(preTimings || {}) };
								finalTimings.llmResponse = Date.now() - llmStart;
								const totalDuration = overallStartTime
									? Date.now() - overallStartTime
									: (finalTimings.endpointDiscovery || 0) +
										(finalTimings.llmDecision || 0) +
										(finalTimings.mcpExecution || 0) +
										(finalTimings.contextFormatting || 0) +
										(finalTimings.llmResponse || 0);
								const breakdown = {
									'Endpoint Discovery': `${finalTimings.endpointDiscovery || 0}ms (${totalDuration ? Math.round(((finalTimings.endpointDiscovery || 0) / totalDuration) * 100) : 0}%)`,
									'LLM Decision Making': `${finalTimings.llmDecision || 0}ms (${totalDuration ? Math.round(((finalTimings.llmDecision || 0) / totalDuration) * 100) : 0}%)`,
									'MCP Tool Execution': `${finalTimings.mcpExecution || 0}ms (${totalDuration ? Math.round(((finalTimings.mcpExecution || 0) / totalDuration) * 100) : 0}%)`,
									'Context Formatting': `${finalTimings.contextFormatting || 0}ms (${totalDuration ? Math.round(((finalTimings.contextFormatting || 0) / totalDuration) * 100) : 0}%)`,
									'LLM Response Generation': `${finalTimings.llmResponse || 0}ms (${totalDuration ? Math.round(((finalTimings.llmResponse || 0) / totalDuration) * 100) : 0}%)`
								};
								emit('xray:final', {
									timings: { ...finalTimings, breakdown },
									totalTime: totalDuration,
									totalDuration
								});
							} catch (_e) {
								// ignored: best-effort final xray emission
							}

							emit('llm:done', { done: true });
							controller.close();
							return;
						}
						try {
							const event = JSON.parse(jsonStr);
							const delta = event.choices?.[0]?.delta?.content;
							if (typeof delta === 'string' && delta.length > 0) {
								responseTokens += estimateTokens(delta);
								emit('llm:delta', { text: delta });
							}
						} catch {
							// ignore malformed chunk
						}
					}
				}

				// Flush remainder if any
				if (buffer.length > 0) {
					try {
						const event = JSON.parse(buffer.replace(/^data:\s*/, ''));
						const delta = event.choices?.[0]?.delta?.content;
						if (typeof delta === 'string' && delta.length > 0) {
							responseTokens += estimateTokens(delta);
							emit('llm:delta', { text: delta });
						}
					} catch {
						// ignore
					}
				}

				// Emit metrics
				const totalTokens = promptTokens + responseTokens;
				logger.info('OpenAI stream metrics', {
					promptType: USE_OPTIMIZED_PROMPT ? 'optimized' : 'legacy',
					requestType,
					promptTokens,
					responseTokens,
					totalTokens,
					promptSize: systemPrompt.length,
					contextSize: context.length,
					tokenReduction: USE_OPTIMIZED_PROMPT
						? `${Math.round((1 - promptTokens / estimateTokens(SYSTEM_PROMPT_LEGACY + context + message)) * 100)}%`
						: '0%'
				});

				emit('llm:metrics', {
					promptType: USE_OPTIMIZED_PROMPT ? 'optimized' : 'legacy',
					requestType,
					promptTokens,
					responseTokens,
					totalTokens
				});

				emit('llm:done', { done: true });
				controller.close();
			} catch (error) {
				const err = error instanceof Error ? error.message : String(error);
				const msg = `event: error\n` + `data: ${JSON.stringify({ error: err })}\n\n`;
				controller.enqueue(encoder.encode(msg));
				controller.close();
			}
		}
	});

	return stream;
}

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const startTime = Date.now();
	const timings: Record<string, number> = {};

	// Note: KV cache is initialized by the platform adapter for all MCP endpoints.
	// The chat endpoint doesn't need to initialize it - MCP tools use the cache internally
	// via services like ZipResourceFetcher2 when fetching resources.

	try {
		const {
			message,
			chatHistory = [],
			enableXRay = false,
			language = 'en'
		}: ChatRequest = await request.json();
		const baseUrl = `${url.protocol}//${url.host}`;

		// Use base language code as-is (e.g., "es", "fr", "en")
		const catalogLanguage = language;

		logger.info('Chat stream request', {
			message,
			historyLength: chatHistory.length,
			language: catalogLanguage
		});

		// Check for API key - try multiple sources
		const apiKey =
			// Cloudflare Workers env binding (production)
			platform?.env?.OPENAI_API_KEY ||
			// SvelteKit env (local development with .env file)
			env.OPENAI_API_KEY ||
			// Fallback to process.env (for other environments)
			process.env.OPENAI_API_KEY;

		if (!apiKey) {
			logger.error('OpenAI API key not found in any environment source', {
				platformExists: !!platform,
				platformEnvExists: !!platform?.env,
				platformEnvKeys: platform?.env ? Object.keys(platform.env) : [],
				hasProcessEnv: typeof process !== 'undefined' && !!process.env,
				importMetaEnvKeys: Object.keys(import.meta.env || {})
			});
			return json(
				{
					success: false,
					error: 'OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.',
					timestamp: new Date().toISOString(),
					debug: {
						platformExists: !!platform,
						platformEnvExists: !!platform?.env,
						// Don't expose actual env var names in production error responses
						hint: 'Check Cloudflare Pages secret configuration'
					}
				},
				{ status: 500 }
			);
		}

		// Step 1: Discover available endpoints and prompts dynamically
		const discoveryStart = Date.now();
		const { endpoints, prompts } = await discoverMCPEndpoints(baseUrl);
		timings.endpointDiscovery = Date.now() - discoveryStart;

		logger.info('Discovered resources for chat', {
			endpoints: endpoints.length,
			prompts: prompts.length
		});

		if (endpoints.length === 0 && prompts.length === 0) {
			return json(
				{
					success: false,
					error: 'Failed to discover MCP endpoints',
					timestamp: new Date().toISOString()
				},
				{ status: 500 }
			);
		}

		// Step 1.5: Detect and validate language if needed
		const languageDetectionStart = Date.now();
		const languageInfo = await detectAndValidateLanguage(
			message,
			chatHistory,
			catalogLanguage,
			baseUrl
		);
		timings.languageDetection = Date.now() - languageDetectionStart;

		// Update language if detected and validated
		let finalLanguage = catalogLanguage;
		if (languageInfo.detectedLanguage && !languageInfo.needsValidation) {
			finalLanguage = languageInfo.detectedLanguage;

			// ✨ Sync detected language into SDK's ContextManager
			updateContext({
				language: finalLanguage,
				detectedLanguage: languageInfo.detectedLanguage,
				languageSource: 'llm-detected'
			});

			logger.info('Language detected and validated', {
				detected: languageInfo.detectedLanguage,
				previous: catalogLanguage
			});
		} else if (languageInfo.detectedLanguage && languageInfo.needsValidation) {
			// Language detected but needs validation - LLM will handle it
			// Set as tentative final language for now
			finalLanguage = languageInfo.detectedLanguage;
			logger.info('Language detected, LLM will validate', {
				detected: languageInfo.detectedLanguage,
				previous: catalogLanguage
			});
		}

		// Step 2: Let the LLM decide which endpoints/prompts to call
		// The LLM will handle language validation/search based on the languageInfo context
		const llmDecisionStart = Date.now();
		const endpointCalls = await determineMCPCalls(
			message,
			apiKey,
			endpoints,
			prompts,
			chatHistory,
			finalLanguage
		);
		timings.llmDecision = Date.now() - llmDecisionStart;

		// Log if no endpoints were selected
		if (endpointCalls.length === 0) {
			logger.info('LLM decided no MCP endpoints needed for this query', { message });
		}

		// Step 3: Execute the MCP calls
		const mcpExecutionStart = Date.now();
		const { data, apiCalls, resolvedLanguage } = await executeMCPCalls(
			endpointCalls,
			baseUrl,
			finalLanguage,
			languageInfo
		);
		timings.mcpExecution = Date.now() - mcpExecutionStart;

		// Step 3.5: Extract language from actual tool calls and update state
		// This ensures the context state reflects what the LLM actually used
		// Priority: resolvedLanguage (from retry) > languageFromToolCalls > catalogLanguage
		const languageFromToolCalls = endpointCalls.find((call) => call.params?.language)?.params
			?.language;
		const actualLanguageUsed = resolvedLanguage || languageFromToolCalls;

		if (actualLanguageUsed && actualLanguageUsed !== catalogLanguage) {
			finalLanguage = actualLanguageUsed;

			// Sync to SDK's ContextManager
			updateContext({
				language: finalLanguage,
				detectedLanguage: languageInfo?.detectedLanguage || finalLanguage,
				languageSource: resolvedLanguage
					? 'variant-retry'
					: languageInfo?.detectedLanguage
						? 'llm-detected'
						: 'tool-call-extracted',
				resolvedVariant: resolvedLanguage || undefined // Track if a variant was used
			});

			logger.info('Language extracted and synced to SDK', {
				actualLanguageUsed,
				resolvedFromRetry: !!resolvedLanguage,
				previous: catalogLanguage,
				detectedLanguage: languageInfo?.detectedLanguage
			});
		}

		// Step 4: Format data for OpenAI context, including any tool errors so the LLM can respond gracefully
		const contextFormattingStart = Date.now();
		const toolErrors = apiCalls.filter(
			(c) => (typeof c.status === 'number' && c.status >= 400) || c.error
		);
		const hasErrors = toolErrors.length > 0;
		let errorContext = '';
		if (hasErrors) {
			errorContext +=
				'Tool errors were encountered while gathering context. Provide a clear, user-friendly explanation and suggest alternate ways to proceed.\n';
			errorContext += 'Errors (do not expose internal URLs):\n';
			for (const err of toolErrors) {
				errorContext += `- endpoint: ${err.endpoint}, status: ${err.status || 'n/a'}, message: ${err.error || 'Unknown error'}, params: ${JSON.stringify(err.params)}\n`;

				// Include structured recovery data if available
				if (err.response?.details?.availableBooks) {
					const books = err.response.details.availableBooks;
					errorContext += `  Book "${err.response.details.requestedBook}" not available in ${err.response.details.language}\n`;
					errorContext += `  However, ${books.length} other books ARE available: ${books
						.slice(0, 10)
						.map((b) => b.name)
						.join(', ')}${books.length > 10 ? '...' : ''}\n`;
					errorContext += `  IMPORTANT: Ask the user if they would like to see one of these available books instead.\n`;
				} else if (err.response?.details?.validBookCodes) {
					errorContext += `  Available book codes: ${err.response.details.validBookCodes.slice(0, 10).join(', ')}${err.response.details.validBookCodes.length > 10 ? '...' : ''}\n`;
					errorContext += `  Invalid code: ${err.response.details.invalidCode}\n`;
				}

				if (err.response?.details?.languageVariants) {
					errorContext += `  Available language variants: ${err.response.details.languageVariants.join(', ')}\n`;
					errorContext += `  Requested language: ${err.response.details.requestedLanguage}\n`;
					errorContext += `  IMPORTANT: Retry the same request using one of the available language variants.\n`;
				}
			}
			errorContext +=
				'\nIf a requested resource was not found, explain what is available instead (e.g., try a different verse, or use notes/questions/scripture).\n\n';
		}
		const context = `${errorContext}${formatDataForContext(data)}`;
		timings.contextFormatting = Date.now() - contextFormattingStart;

		// Step 5: Call OpenAI with the data (support streaming)
		const streamMode =
			url.searchParams.get('stream') === '1' ||
			(request.headers.get('accept') || '').includes('text/event-stream');

		if (streamMode) {
			// Build initial X-ray snapshot (always emit so client can show tools during streaming)
			const totalDurationSoFar = Date.now() - startTime;

			// Build system prompt for streaming (same logic as callOpenAIStream)
			const requestType = endpointCalls
				? detectRequestType(endpointCalls as EndpointCall[], message)
				: undefined;
			let systemPromptForDebug = USE_OPTIMIZED_PROMPT
				? getSystemPrompt(requestType, endpointCalls as EndpointCall[] | undefined, message)
				: SYSTEM_PROMPT_LEGACY;

			// Add minimal language context
			let languageContextForDebug = `\n\n**LANGUAGE:** Use base code (es, fr, en). Default: ${finalLanguage}`;

			if (languageInfo?.detectedLanguage && languageInfo.detectedLanguage !== finalLanguage) {
				languageContextForDebug += `\n**DETECTED:** ${languageInfo.detectedLanguage} - use this code`;
			}

			// Add book code guidance
			languageContextForDebug += `\n\n**BIBLE REFERENCES:** ALWAYS use standard 3-letter book codes (GEN, EXO, JHN, TIT, etc.), NEVER full book names. When user says "John 3:16" or "Titus 1:15", convert to "JHN 3:16" or "TIT 1:15" before calling tools.`;

			// Add proactive tool suggestions guidance
			const proactiveSuggestionsForDebug = `\n\n**PROACTIVE TOOL SUGGESTIONS:**
After providing scripture, ALWAYS suggest relevant tools:
"Would you like me to show you:
- **Translation notes** (explains difficult phrases)
- **Key terms** (biblical definitions)
- **Comprehension questions** (check understanding)
- **Translation concepts** (academy articles)"

Don't end with "feel free to ask" - be specific about available tools!`;

			systemPromptForDebug =
				systemPromptForDebug + languageContextForDebug + proactiveSuggestionsForDebug;

			// Build full prompt object for debugging
			const fullPromptData = {
				systemPrompt: systemPromptForDebug,
				context: context.substring(0, 10000) + (context.length > 10000 ? '... (truncated)' : ''),
				contextSize: context.length,
				chatHistory: chatHistory.slice(-6),
				userMessage: message,
				totalTokens: estimateTokens(
					systemPromptForDebug +
						context +
						message +
						chatHistory
							.slice(-6)
							.map((m) => m.content)
							.join('')
				)
			};

			const xrayInit: any = {
				queryType: 'ai-assisted',
				apiCallsCount: apiCalls.length,
				totalDuration: totalDurationSoFar,
				totalTime: totalDurationSoFar,
				hasErrors: apiCalls.some(
					(c) => (typeof c.status === 'number' && c.status >= 400) || c.error
				),
				apiCalls,
				tools: apiCalls.map((call, index) => ({
					id: `tool-${index}`,
					name: call.endpoint,
					duration: parseInt(call.duration.replace('ms', '')) || 0,
					cached: call.cacheStatus === 'hit',
					cacheStatus: call.cacheStatus || 'miss',
					params: call.params,
					status: call.status,
					error: call.error,
					response: call.response // Include full MCP server response for debugging
				})),
				timings: {
					endpointDiscovery: timings.endpointDiscovery || 0,
					llmDecision: timings.llmDecision || 0,
					mcpExecution: timings.mcpExecution || 0,
					contextFormatting: timings.contextFormatting || 0
				},
				// Add full prompt for debugging
				fullPrompt: fullPromptData,
				// Context state variables for debugging language detection
				// Merge SDK's ContextManager state with local chat variables
				contextState: {
					// From SDK's ContextManager (includes state injected into tools)
					...getContextState(),
					// From local chat-stream variables (for comparison)
					catalogLanguage,
					finalLanguage,
					detectedLanguage: languageInfo?.detectedLanguage,
					needsValidation: languageInfo?.needsValidation,
					languageOverrideApplied:
						languageInfo?.detectedLanguage && languageInfo.detectedLanguage !== catalogLanguage
				}
			};

			const sseStream = await callOpenAIStream(
				message,
				context,
				chatHistory,
				apiKey,
				xrayInit,
				{
					endpointDiscovery: timings.endpointDiscovery || 0,
					llmDecision: timings.llmDecision || 0,
					mcpExecution: timings.mcpExecution || 0,
					contextFormatting: timings.contextFormatting || 0
				},
				startTime,
				endpointCalls,
				finalLanguage,
				languageInfo
			);
			const totalDuration = Date.now() - startTime;
			return new Response(sseStream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-store',
					'X-Chat-Model': 'gpt-4o-mini',
					'X-Chat-Duration': `${totalDuration}ms`
				}
			});
		}

		const llmResponseStart = Date.now();
		const { response, error, metrics } = await callOpenAI(
			message,
			context,
			chatHistory,
			apiKey,
			endpointCalls,
			finalLanguage,
			languageInfo
		);
		timings.llmResponse = Date.now() - llmResponseStart;

		// Log the response for debugging
		logger.info('LLM response', {
			hasResponse: !!response,
			responseLength: response?.length || 0,
			hasError: !!error,
			contextLength: context.length,
			metrics: metrics || {}
		});

		if (error) {
			return json(
				{
					success: false,
					error,
					timestamp: new Date().toISOString()
				},
				{ status: 500 }
			);
		}

		// Check for empty response
		if (!response || response.trim() === '') {
			logger.error('Empty response from LLM', { message, contextLength: context.length });
			return json(
				{
					success: false,
					error: 'No response generated from AI. Please try again.',
					timestamp: new Date().toISOString()
				},
				{ status: 500 }
			);
		}

		const totalDuration = Date.now() - startTime;

		// Build response to match ChatInterface expectations
		const result: any = {
			success: true,
			content: response, // ChatInterface expects 'content', not 'response'
			timestamp: new Date().toISOString(),
			contextUsed: {
				type: 'mcp-data',
				endpoints: apiCalls.map((c) => c.endpoint),
				dataPoints: data.length
			},
			metadata: {
				model: 'gpt-4o-mini',
				streaming: false,
				duration: totalDuration,
				metrics: metrics || {}
			}
		};

		// Add X-ray data if requested
		if (enableXRay) {
			// Build full prompt object for debugging
			const fullPromptData = {
				systemPrompt,
				context: context.substring(0, 10000) + (context.length > 10000 ? '... (truncated)' : ''), // Truncate large contexts
				contextSize: context.length,
				chatHistory: chatHistory.slice(-6),
				userMessage: message,
				totalTokens: estimateTokens(
					systemPrompt +
						context +
						message +
						chatHistory
							.slice(-6)
							.map((m) => m.content)
							.join('')
				)
			};

			result.xrayData = {
				queryType: 'ai-assisted',
				apiCallsCount: apiCalls.length,
				totalDuration,
				totalTime: totalDuration,
				hasErrors: apiCalls.some(
					(c) => (typeof c.status === 'number' && c.status >= 400) || c.error
				),
				apiCalls,
				// Transform apiCalls to tools format for XRayPanel
				tools: apiCalls.map((call, index) => ({
					id: `tool-${index}`,
					name: call.endpoint,
					duration: parseInt(call.duration.replace('ms', '')) || 0,
					cached: call.cacheStatus === 'hit',
					cacheStatus: call.cacheStatus || 'miss',
					params: call.params,
					status: call.status,
					error: call.error,
					response: call.response // Include full MCP server response for debugging
				})),
				// Add detailed timing breakdown
				timings: {
					endpointDiscovery: timings.endpointDiscovery || 0,
					llmDecision: timings.llmDecision || 0,
					mcpExecution: timings.mcpExecution || 0,
					contextFormatting: timings.contextFormatting || 0,
					llmResponse: timings.llmResponse || 0,
					// Add percentages for easy visualization
					breakdown: {
						'Endpoint Discovery': `${timings.endpointDiscovery || 0}ms (${Math.round(((timings.endpointDiscovery || 0) / totalDuration) * 100)}%)`,
						'LLM Decision Making': `${timings.llmDecision || 0}ms (${Math.round(((timings.llmDecision || 0) / totalDuration) * 100)}%)`,
						'MCP Tool Execution': `${timings.mcpExecution || 0}ms (${Math.round(((timings.mcpExecution || 0) / totalDuration) * 100)}%)`,
						'Context Formatting': `${timings.contextFormatting || 0}ms (${Math.round(((timings.contextFormatting || 0) / totalDuration) * 100)}%)`,
						'LLM Response Generation': `${timings.llmResponse || 0}ms (${Math.round(((timings.llmResponse || 0) / totalDuration) * 100)}%)`
					}
				},
				// Add full prompt for debugging complex prompts
				fullPrompt: fullPromptData
			};
		}

		return json(result, {
			headers: {
				'X-Chat-Model': 'gpt-4o-mini',
				'X-Chat-Duration': `${totalDuration}ms`,
				'X-Chat-API-Calls': String(apiCalls.length)
			}
		});
	} catch (error) {
		logger.error('Chat stream error', {
			error: error instanceof Error ? error.message : 'Unknown error',
			stack: error instanceof Error ? error.stack : undefined,
			type: error?.constructor?.name
		});

		// Return more detailed error in development
		const isDev = import.meta.env.DEV || process.env.NODE_ENV === 'development';

		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Internal server error',
				timestamp: new Date().toISOString(),
				...(isDev && {
					details: {
						message: error instanceof Error ? error.message : 'Unknown error',
						stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5) : undefined,
						type: error?.constructor?.name
					}
				})
			},
			{ status: 500 }
		);
	}
};
