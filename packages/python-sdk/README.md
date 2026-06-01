# translation-helps-mcp-client

Python client for the Translation Helps MCP v2 server.

## Installation

```bash
pip install translation-helps-mcp-client
```

Or with httpx for async support:

```bash
pip install translation-helps-mcp-client httpx
```

## Usage

### Synchronous (built-in urllib)

```python
from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient()

# Fetch scripture
scripture = client.fetch_scripture({"reference": "JHN 3:16", "language": "en"})
print(scripture)

# Get all translation helps for a passage
bundle = client.get_bundle({"reference": "JHN 3:16", "language": "en"})

# Semantic search
results = client.rag_query({
    "query": "How should I translate figurative language?",
    "language": "en",
    "resourceTypes": ["ta", "tn"],
    "topK": 5,
})

# List languages
languages = client.list_languages()

# Fetch a translation word
word = client.fetch_translation_word({
    "path": "bible/kt/grace",  # use path from fetch_translation_word_links
    "language": "en",
})
```

### Async (requires httpx)

```python
import asyncio
from translation_helps import AsyncTranslationHelpsClient

async def main():
    async with AsyncTranslationHelpsClient() as client:
        scripture = await client.fetch_scripture({"reference": "JHN 3:16"})
        print(scripture)

asyncio.run(main())
```

## API Reference

### Client Options

```python
TranslationHelpsClient(
    server_url="https://translation-helps-mcp.workers.dev/mcp",
    timeout=90.0,
    headers=None,
)
```

### Methods

| Method                               | Description                         |
| ------------------------------------ | ----------------------------------- |
| `fetch_scripture(opts)`              | Fetch Bible text                    |
| `fetch_translation_notes(opts)`      | Fetch translation notes             |
| `fetch_translation_questions(opts)`  | Fetch comprehension questions       |
| `fetch_translation_word_links(opts)` | Fetch word links for a reference    |
| `fetch_translation_word(opts)`       | Fetch a dictionary article          |
| `fetch_translation_academy(opts)`    | Fetch a Translation Academy article |
| `list_languages(opts?)`              | List available languages            |
| `list_subjects(opts?)`               | List available resource subjects    |
| `list_resources_for_language(opts)`  | List resources for a language       |
| `rag_query(opts)`                    | Semantic search                     |
| `get_bundle(opts)`                   | Get all helps for a passage         |
| `index_resource(opts)`               | Index a resource (admin)            |
| `call_tool(name, args)`              | Raw tool call                       |

## Error Handling

```python
result = client.call_tool("fetch_scripture", {"reference": "invalid"})
if result.get("isError"):
    import json
    error = json.loads(result["content"][0]["text"])
    print(f"{error['code']}: {error['message']}")
    for hint in error.get("hints", []):
        print(f"  • {hint['message']}")
```

Error codes: `INVALID_REFERENCE`, `INVALID_LANGUAGE`, `RESOURCE_NOT_FOUND`, `UPSTREAM_DCS_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## License

MIT
