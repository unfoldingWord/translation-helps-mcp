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

The server uses a **progressive-disclosure workflow** — call tools in order to
orient, survey, drill, and check a Bible passage.

### Synchronous (built-in urllib)

```python
from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient()

# 1. Discover available languages
langs = client.list_languages({"filter": "es"})

# 2a. Orient — scripture text, all versions (incl. original-language UGNT/UHB)
#     Cheap and repeatable; re-call any time you need the verse text
passage = client.get_passage({"reference": "JHN 3:16", "language": "en"})

# 2b. Orient — book/chapter background + which resources exist (no verse text)
ctx = client.get_passage_context({"reference": "JHN 3:16", "language": "en"})

# 3. Survey — compact index of issues + key terms (no full bodies)
index = client.get_passage_index({"reference": "JHN 3:16", "language": "en"})

# 4. Drill — fetch specific items using IDs/paths from the index
note = client.get_note({
    "reference": "JHN 3:16",
    "id": "abc123",           # from index["notes"][i]["id"]
    "language": "en",
})

ta_article = client.get_academy_article({
    "path": "translate/figs-metaphor",   # from index["notes"][i]["taArticle"]["path"]
    "language": "en",
})

tw_article = client.get_word_article({
    "path": "bible/kt/grace",            # from index["wordLinks"][i]["twArticle"]["path"]
    "language": "en",
})

# 5. Check — comprehension questions
questions = client.get_questions({"reference": "JHN 3:16", "language": "en"})

# 6. Lateral discovery — find articles by concept
hits = client.search_articles({
    "query": "How should I translate figurative language?",
    "language": "en",
    "resourceTypes": ["ta"],
    "topK": 5,
})
```

### Async (requires httpx)

```python
import asyncio
from translation_helps import AsyncTranslationHelpsClient

async def main():
    async with AsyncTranslationHelpsClient() as client:
        # Orient
        ctx = await client.get_passage_context({
            "reference": "JHN 3:16",
            "language": "en",
        })
        # Survey
        index = await client.get_passage_index({
            "reference": "JHN 3:16",
            "language": "en",
        })
        print(ctx, index)

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

### Workflow Methods

#### Step 1 — Orient

| Method | Required | Optional | Description |
| ------ | -------- | -------- | ----------- |
| `list_languages(opts?)` | — | `filter` | Discover valid BCP-47 language codes |
| `get_passage(opts)` | `reference` | `language` | Scripture text — all versions (literal, simplified, original UGNT/UHB). Cheap and repeatable. |
| `get_passage_context(opts)` | `reference` | `language`, `organization` | Book/chapter intro notes + resource availability. Does NOT include verse text (use `get_passage`). |

#### Step 2 — Survey

| Method | Required | Optional | Description |
| ------ | -------- | -------- | ----------- |
| `get_passage_index(opts)` | `reference` | `language`, `organization` | Compact index: note IDs + quotes + TA/TW paths (no article bodies). Includes `issues[]` and `keyTerms[]` rollups. |

#### Step 3 — Drill

| Method | Required | Optional | Description |
| ------ | -------- | -------- | ----------- |
| `get_note(opts)` | `reference` | `id`, `language`, `organization` | Full note body. Omit `id` to get all notes for the reference. |
| `get_academy_article(opts)` | `path` | `language`, `organization` | Full TA article markdown. Use `path` from index `taArticle.path`. |
| `get_word_article(opts)` | `path` | `language`, `organization` | Full TW article markdown. Use `path` from index `twArticle.path`. |

#### Step 4 — Check

| Method | Required | Optional | Description |
| ------ | -------- | -------- | ----------- |
| `get_questions(opts)` | `reference` | `language`, `organization` | Comprehension questions for a passage. |

#### Lateral Discovery

| Method | Required | Optional | Description |
| ------ | -------- | -------- | ----------- |
| `search_articles(opts)` | `query` | `language`, `resourceTypes`, `topK` | Lexical search over TA + TW article catalogs. Returns ranked paths. |

### Legacy Methods (deprecated)

These remain for backward compatibility but should be migrated to the workflow methods above.

| Legacy Method | Use Instead |
| ------------- | ----------- |
| `fetch_scripture(opts)` | `get_passage` |
| `fetch_translation_notes(opts)` | `get_note` |
| `fetch_translation_questions(opts)` | `get_questions` |
| `fetch_translation_word_links(opts)` | `get_passage_index` |
| `fetch_translation_word(opts)` | `get_word_article` |
| `fetch_translation_academy(opts)` | `get_academy_article` |
| `get_bundle(opts)` | `get_passage_context` + `get_passage_index` |

### Parsing Results

```python
import json

result = client.get_passage_context({"reference": "JHN 3:16"})
if result.get("isError"):
    error = json.loads(result["content"][0]["text"])
    print(f"{error['code']}: {error['message']}")
    for hint in error.get("hints", []):
        print(f"  • {hint['message']}")
else:
    data = json.loads(result["content"][0]["text"])
    print(data["versions"])
```

Error codes: `INVALID_REFERENCE`, `INVALID_LANGUAGE`, `RESOURCE_NOT_FOUND`, `UPSTREAM_DCS_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## License

MIT
