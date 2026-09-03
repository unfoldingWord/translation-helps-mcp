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
from translation_helps import (
    TranslationHelpsClient,
    get_structured_content,
    is_resource_not_available,
)

client = TranslationHelpsClient()

# 1. Discover available languages (paginated)
langs = client.list_languages({"filter": "es", "limit": 20})

# 1b. Check which resource types exist for a language / book
resources = client.list_resources({"language": "en", "book": "TIT"})

# 2a. Orient — scripture text, all versions (incl. original-language UGNT/UHB)
#     Cheap and repeatable; re-call any time you need the verse text
passage = client.get_passage({
    "reference": "JHN 3:16",
    "language": "en",
    "format": "text",  # or "usfm"
})

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

# Or match notes by strategic-language phrase
by_phrase = client.get_note({
    "reference": "TIT 2:12",
    "phrase": "teaching us",
    "language": "en",
})

ta_article = client.get_academy_article({
    "path": "translate/figs-metaphor",   # from notes[i]["taArticle"]["path"]
    "language": "en",
})

tw_article = client.get_word_article({
    "path": "bible/kt/grace",            # from words[i]["twArticle"]["path"]
    "language": "en",
})

# 5. Check — comprehension questions
questions = client.get_questions({"reference": "JHN 3:16", "language": "en"})

# 6. Lateral discovery — find articles by concept
hits = client.search_articles({
    "query": "How should I translate figurative language?",
    "language": "en",
    "types": "ta",   # "ta", "tw", or "ta,tw"
    "limit": 5,
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
    server_url="https://translation-helps-mcp-v2.workers.dev/mcp",
    timeout=90.0,
    headers=None,
)
```

### Workflow Methods

Results include `content`, optional `structuredContent`, and optional `isError`.
Use `get_structured_content(result)` or `TranslationHelpsClient.parse_result(result)`
(both prefer `structuredContent` when present). Soft not-available responses use
`isError: false` with `code: "RESOURCE_NOT_AVAILABLE"` — check with
`is_resource_not_available(data)`.

#### Step 1 — Orient

| Method                      | Required    | Optional                    | Description                                                                                        |
| --------------------------- | ----------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `list_languages(opts?)`     | —           | `filter`, `limit`, `offset` | Discover valid BCP-47 language codes (default limit 50)                                            |
| `list_resources(opts)`      | `language`  | `book`, `reference`         | Resource types for a language; optional book filter for partial coverage                           |
| `get_passage(opts)`         | `reference` | `language`, `format`        | Scripture text — all versions. `format`: `"text"` (default) or `"usfm"`. Cheap and repeatable.     |
| `get_passage_context(opts)` | `reference` | `language`                  | Book/chapter intro notes + resource availability. Does NOT include verse text (use `get_passage`). |

#### Step 2 — Survey

| Method                    | Required    | Optional                | Description                                                                                                       |
| ------------------------- | ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `get_passage_index(opts)` | `reference` | `language`, `skipNotes` | Compact index: note IDs + quotes + TA/TW paths (no article bodies). Includes `issues[]` and `keyTerms[]` rollups. |

#### Step 3 — Drill

| Method                      | Required    | Optional                   | Description                                                       |
| --------------------------- | ----------- | -------------------------- | ----------------------------------------------------------------- |
| `get_note(opts)`            | `reference` | `id`, `phrase`, `language` | Full note body. Omit `id`/`phrase` to get all notes for the ref.  |
| `get_academy_article(opts)` | `path`      | `language`                 | Full TA article markdown. Use `path` from index `taArticle.path`. |
| `get_word_article(opts)`    | `path`      | `language`                 | Full TW article markdown. Use `path` from index `twArticle.path`. |

#### Step 4 — Check

| Method                | Required    | Optional   | Description                            |
| --------------------- | ----------- | ---------- | -------------------------------------- |
| `get_questions(opts)` | `reference` | `language` | Comprehension questions for a passage. |

#### Lateral Discovery

| Method                  | Required | Optional                     | Description                                                                      |
| ----------------------- | -------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `search_articles(opts)` | `query`  | `language`, `types`, `limit` | Lexical search over TA + TW. `types`: `"ta"` / `"tw"` / `"ta,tw"`. `limit` 1–30. |

#### Open Bible Stories (OBS)

Reference examples: `"1:1"` (single frame), `"3:1-3"` (frames 1–3), `"3"` (whole story).
Language accepts BCP-47 (`"es"`) or ISO 639-2/639-3 aliases (`"spa"`).

```python
story = client.get_obs_story({"reference": "3:1-3", "language": "spa"})
notes = client.get_obs_notes({"reference": "3:1-3", "language": "spa"})
```

| Method                    | Required    | Optional   | Description                                                                 |
| ------------------------- | ----------- | ---------- | --------------------------------------------------------------------------- |
| `get_obs_story(opts)`     | `reference` | `language` | Fetch OBS story text and frames for a story:frame reference (e.g. "3:1-3"). |
| `get_obs_notes(opts)`     | `reference` | `language` | Fetch OBS Translation Notes for a story:frame reference.                    |
| `get_obs_questions(opts)` | `reference` | `language` | Fetch OBS Translation Questions for a story:frame reference.                |

### Migration from legacy tools

Legacy MCP tools (`fetch_*`, `get_bundle`, `list_subjects`, `list_resources_for_language`, etc.) have been removed from the server. Map them as follows:

| Removed                                                      | Use instead                                           |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `fetch_scripture`                                            | `get_passage`                                         |
| `fetch_translation_notes`                                    | `get_note`                                            |
| `fetch_translation_questions`                                | `get_questions`                                       |
| `fetch_translation_word_links`                               | `get_passage_index`                                   |
| `fetch_translation_word`                                     | `get_word_article`                                    |
| `fetch_translation_academy`                                  | `get_academy_article`                                 |
| `get_bundle`                                                 | `get_passage_context` + `get_passage_index`           |
| `list_resources_for_language` / `list_resources_by_language` | `list_resources`                                      |
| `list_subjects`                                              | `list_resources` (availability includes subject/role) |
| `list_translation_academy` / `list_translation_words`        | `search_articles` + drill methods                     |

### Parsing Results

```python
from translation_helps import (
    TranslationHelpsClient,
    get_structured_content,
    is_resource_not_available,
)

client = TranslationHelpsClient()
result = client.get_passage_context({"reference": "JHN 3:16"})
data = get_structured_content(result)

if is_resource_not_available(data):
    # Soft not-available: isError is false; code is RESOURCE_NOT_AVAILABLE
    print(f"{data['code']}: {data['message']}")
    for hint in data.get("hints", []):
        print(f"  • {hint}")
elif result.get("isError"):
    print(f"{data.get('code')}: {data.get('message')}")
else:
    print(data)
```

Error codes: `INVALID_REFERENCE`, `INVALID_LANGUAGE`, `RESOURCE_NOT_FOUND`, `RESOURCE_NOT_AVAILABLE`, `UPSTREAM_DCS_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## License

MIT
