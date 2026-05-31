MCP Prompts — existing and redesigned for RAG-aware chat

Current prompts (existing in `src/mcp/prompts-registry.ts`)

- `translation-helps-report` — analyzes a passage and returns translation help
- `translation-helps-for-passage` — returns notes + words for a passage
- `translation-helps-discovery` — discovers available resources
- Plus internal-only administrative prompts

Redesign for RAG integration

All existing prompts should remain but with enhanced instructions:

- Add explicit instruction to call `rag_query` with the reference and user query.
- Add instruction to prioritize exact matches (scripture by reference, TW/TA by path).
- Add instruction to cite sources using `provenance.r2Key` and `path`.
- Add grounding rule: "Only assert facts found in the retrieval results. If retrieval returns no results, say so explicitly."

Prompt: `translation-helps-for-passage` (updated)

```
You are a Bible translation helper. The user has asked about a specific scripture passage.

Steps:
1. Use tool `rag_query` with:
   - query: [user's question or "give me notes for this passage"]
   - language: [detected from context or English]
   - reference: [book chapter:verse from user input]
   - filters: { resourceType: ["tsv"], subject: ["TSV Translation Notes"] }
   - k: 10

2. Review the returned documents. Each has provenance (r2Key, path, license).

3. From the documents, extract and summarize the most relevant notes.

4. For each note cited, include the source: "(from {path} in {project})"

5. If the user asks for linked articles (translation words or academy), call rag_query again with:
   - filters: { resourceType: ["md"], subject: ["Translation Word", "Translation Academy"] }

6. Combine results into a coherent translation help response.

Grounding rule: Never assert facts not found in the retrieval results. If retrieval returns no results, respond: "I did not find notes for this passage in the available resources."
```

New Skill-specific prompts

- `skill-fetch-passage-with-context` — returns a bundle (scripture + notes + linked articles) for a reference
- `skill-generate-translation-help` — given a bundle, generates narrative translation help
- `skill-check-grounding` — validates that all claims in generated text are grounded in sources

Prompt versioning

- Version prompts as `v1`, `v2`, etc. in the registry.
- Existing prompts remain at `v1`; RAG-integrated versions are `v2`.
- MCP clients can specify `prompt_version` in request; default to latest.
- Deprecation: phase out `v1` over 6 months with warnings.

Backwards compatibility

- MCP clients that don't call `rag_query` explicitly still work; prompts don't require it.
- But prompts encourage RAG usage in instructions.

SDK/prompt execution flow

- MCP client calls `executePrompt(promptName, args, {version: 'v2'})`
- SDK fetches prompt template and argument definitions
- SDK validates args
- SDK calls LLM with prompt template + args
- LLM returns response (which may include tool calls to `rag_query`)

Next: read `SKILL_LAYER.md` to see how Skill primitives wrap and orchestrate these prompts.
