Generation Templates & Prompt Engineering

Purpose
Specifies how LLM is called with retrieval results, how grounding is enforced, and how citations are generated.

System prompt (for all translation help generation)

```
You are an expert Bible translation helper. Your role is to assist translators and reviewers with context, etymology, and notes for scripture passages.

CRITICAL RULES:
1. ONLY assert facts that are explicitly found in the provided retrieval results or your training knowledge of Biblical scholarship.
2. NEVER make up or speculate about translation alternatives not in the sources.
3. ALWAYS cite sources: format as "(Source: {path} from {project})".
4. If retrieval returns no relevant results, say explicitly: "I did not find specific resources for this query."
5. Provide direct quotes from sources when relevant, in block quotes: > quoted text

YOUR SOURCES:
The user has provided retrieval results (Translation Notes, Translation Words, Translation Academy articles). These are your primary ground truth.

OUTPUT FORMAT:
- Structure your response with clear headings.
- Use bullet points for lists.
- Include a "Sources" section at the end listing all cited resources.
- Cite using this format: [Source: bible/kt/love]
```

User prompt template (for `generateTranslationHelp`)

```
I have retrieved the following resources for {REFERENCE} ({LANGUAGE}):

SCRIPTURE:
{SCRIPTURE_TEXT}

TRANSLATION NOTES:
{NOTES_SUMMARY}

LINKED ARTICLES:
{LINKED_ARTICLES_SUMMARY}

User question: {USER_PROMPT}

Please provide a translation help response based on these resources. Format as:
1. Summary of key translation issues
2. Relevant notes from the sources
3. Etymology or cultural context (if available)
4. Suggested translation alternatives (if any in sources)
5. Sources

Remember: only use information present in the provided resources. Do not speculate.
```

Context assembly rules

- Scripture text: full verse range (limit to <500 tokens)
- Notes: summarize top-3 notes (limit to <300 tokens each)
- Linked articles: list titles and 1-sentence summaries (limit to <200 tokens)
- Total context budget: <2000 tokens before user prompt

Grounding validation (post-generation)

1. Extract claims from LLM response (sentences starting with "The", "This", etc.)
2. For each claim, check if it appears in or is supported by the retrieval results.
3. Flag unsupported claims as `[⚠️ ungrounded]` and rewrite or remove.
4. Alternative: use a small LLM (`text-davinci-003` or smaller) as a grounding checker in a separate call.

Citation format & extraction

- Parser regex: `\[Source:\s*([^\]]+)\]`
- Expected format: `[Source: bible/kt/love]` or `[Source: Notes from es_xxx/notes]`
- Validation: check that source appears in retrieval results
- If source not found: replace with `[Source: Unknown]` and flag

Fallback templates

- If retrieval empty: "I could not find specific resources for this passage. Please try rephrasing your question or selecting a different passage."
- If LLM fails: return the raw retrieval results formatted as a minimal response
- If citation parsing fails: return response without citations and log warning

Prompt versioning

- `v1`: basic generation without grounding checks (legacy)
- `v2`: generation + post-hoc grounding validation
- `v3`: generation with in-context grounding examples (CoT)

Example generation (sample)

User: "What translation issues are there with John 3:16?"

Retrieved resources:

- Scripture: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life."
- Notes:
  - "world (kosmos): Greek term for the entire created order or humanity in rebellion against God"
  - "believes (pisteuō): has faith in, trusts in, commits one's life to"
  - "perish (apollymi): be lost, destroyed, cease to exist"

## Generated response:

**Translation Issues for John 3:16**

1. **"world" (Greek: kosmos)**
   - The Greek term kosmos in this context refers to humanity in rebellion against God, not just the physical universe. [Source: bible/kt/world]
   - Translators must decide whether to render as "world", "humanity", or "people" depending on target language conventions.

2. **"believes" (Greek: pisteuō)**
   - This verb means more than intellectual agreement; it implies trusting in and committing one's life to Christ. [Source: bible/kt/believe]
   - Some languages may need to express this as "trusts in" or "commits to" rather than a simple "believes".

3. **"perish" (Greek: apollymi)**
   - Literally "be destroyed" or "be lost". The translation should convey the concept of eternal separation from God. [Source: bible/kt/perish]

**Sources:**

- [Source: bible/kt/world] Translation Words: World
- [Source: bible/kt/believe] Translation Words: Believe
- [Source: bible/kt/perish] Translation Words: Perish

---

Instrumentation

- Metrics: `generation.latency`, `generation.grounding_checks`, `generation.citations_extracted`
- Logs: full prompt and response for analysis and improvement

Next: read `DEV_ENVIRONMENT.md` for local setup to test these templates.
