# translation-helps-mcp-client

Official Python client SDK for the Translation Helps MCP Server.

## Installation

```bash
pip install translation-helps-mcp-client
```

## Quick Start

### Basic MCP Client Usage

```python
import asyncio
from translation_helps import TranslationHelpsClient

async def main():
    # Create a client instance
    async with TranslationHelpsClient() as mcp_client:
        # Get available tools and prompts
        tools = await mcp_client.list_tools()
        prompts = await mcp_client.list_prompts()

        # Use tools/prompts directly with MCP-compatible interfaces
        # (e.g., Claude Desktop, Cursor, OpenAI Agents SDK)

asyncio.run(main())
```

### Using with OpenAI Chat Completions API

```python
import asyncio
from translation_helps import TranslationHelpsClient
from translation_helps.adapters import prepare_tools_for_provider
from openai import OpenAI

async def main():
    mcp_client = TranslationHelpsClient()
    await mcp_client.connect()

    # Get tools and prompts
    tools = await mcp_client.list_tools()
    prompts = await mcp_client.list_prompts()

    # Optional: Use adapter utility to prepare tools for OpenAI
    openai_client = OpenAI(api_key="your-api-key")
    openai_tools = prepare_tools_for_provider("openai", tools, prompts)

    # Use with OpenAI
    response = openai_client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "What does John 3:16 say?"}],
        tools=openai_tools
    )

    # When AI requests a tool call, execute it via SDK:
    # result = await mcp_client.call_tool(tool_name, tool_args)
    # Feed result back to AI for final response

asyncio.run(main())
```

**Note:** The adapter utilities are **optional**. You can also write your own conversion logic or use MCP tools/prompts directly if your provider supports MCP natively.

## Usage with Context Manager

```python
import asyncio
from translation_helps import TranslationHelpsClient

async def main():
    async with TranslationHelpsClient() as client:
        scripture = await client.fetch_scripture({
            "reference": "John 3:16"
        })
        print(scripture)

asyncio.run(main())
```

## API Reference

### `TranslationHelpsClient`

Main client class for interacting with the Translation Helps MCP server.

#### Constructor

```python
TranslationHelpsClient(options: Optional[ClientOptions] = None)
```

**Options:**

- `serverUrl: Optional[str]` - Server URL (default: production server)
- `timeout: Optional[int]` - Request timeout in ms (default: 30000)
- `headers: Optional[Dict[str, str]]` - Custom headers

#### Methods

##### `async connect() -> None`

Initialize connection to the MCP server. Automatically called by convenience methods.

##### `async close() -> None`

Close the HTTP client connection.

##### `async fetch_scripture(options: FetchScriptureOptions) -> str`

Fetch Bible scripture text.

```python
text = await client.fetch_scripture({
    "reference": "John 3:16",
    "language": "en",
    "organization": "unfoldingWord",
    "format": "text",  # or "usfm"
    "includeVerseNumbers": True,
    "resource": "all",  # Optional: 'ult', 'ust', 't4t', 'ueb', 'all', or comma-separated (e.g., 'ult,ust')
    "includeAlignment": False  # Optional: Include word alignment data (only available with USFM format)
})
```

##### `async fetch_translation_notes(options: FetchTranslationNotesOptions) -> Dict`

Fetch translation notes for a passage.

```python
notes = await client.fetch_translation_notes({
    "reference": "John 3:16",
    "language": "en",
    "includeIntro": True,
    "includeContext": True
})
```

##### `async fetch_translation_questions(options: FetchTranslationQuestionsOptions) -> Dict`

Fetch translation questions for a passage.

```python
questions = await client.fetch_translation_questions({
    "reference": "John 3:16",
    "language": "en"
})
```

##### `async fetch_translation_word(options: FetchTranslationWordOptions) -> Dict`

Fetch translation word article by term or reference.

```python
# By term
word = await client.fetch_translation_word({
    "term": "love",
    "language": "en"
})

# By reference (gets words used in passage)
words = await client.fetch_translation_word({
    "reference": "John 3:16",
    "language": "en"
})
```

##### `async fetch_translation_word_links(options: FetchTranslationWordLinksOptions) -> Dict`

Fetch translation word links for a passage.

```python
links = await client.fetch_translation_word_links({
    "reference": "John 3:16",
    "language": "en"
})
```

##### `async fetch_translation_academy(options: FetchTranslationAcademyOptions) -> Any`

Fetch translation academy articles.

```python
articles = await client.fetch_translation_academy({
    "reference": "John 3:16",
    "language": "en",
    "format": "json"  # or "markdown"
})
```

##### `async list_languages(options: Optional[ListLanguagesOptions] = None) -> Dict`

List all available languages from Door43 catalog (~1 second).

```python
languages = await client.list_languages({
    "organization": "unfoldingWord",  # or omit for all orgs
    "stage": "prod"
})
print(f"Found {len(languages['languages'])} languages")
```

##### `async list_subjects(options: Optional[ListSubjectsOptions] = None) -> Dict`

List all available resource subjects/types from Door43 catalog.

```python
subjects = await client.list_subjects({
    "language": "en",
    "organization": "unfoldingWord",
    "stage": "prod"
})
print(f"Found {len(subjects['subjects'])} resource types")
```

##### `async list_resources_for_language(options: ListResourcesForLanguageOptions) -> Dict` ⭐ RECOMMENDED

List all resources for a specific language. Fast single API call (~1-2 seconds).

```python
# Discover what's available for Spanish (es-419)
resources = await client.list_resources_for_language({
    "language": "es-419",
    "organization": "",  # empty = all orgs (es-419_gl, unfoldingWord, BSA, etc.)
    # topic defaults to "tc-ready" if not provided
})

print(f"Found {resources['totalResources']} resources")
print(f"Subjects: {', '.join(resources['subjects'])}")
print(f"Organizations discovered: {len(set(r['organization'] for r in resources['resourcesBySubject'].values()))}")
```

**Recommended Discovery Workflow:**

```python
# Step 1: Discover available languages (~1s)
langs = await client.list_languages()
print("Available languages:", [l['code'] for l in langs['languages']])

# Step 2: Get resources for chosen language (~1-2s)
# topic defaults to "tc-ready" (production-ready only)
resources = await client.list_resources_for_language({"language": "es-419"})

# Step 3: Fetch specific resources
scripture = await client.fetch_scripture({
    "reference": "John 3:16",
    "language": "es-419",
    "organization": "es-419_gl"
})
```

##### `async list_tools() -> List[MCPTool]`

List all available MCP tools.

##### `async list_prompts() -> List[MCPPrompt]`

List all available MCP prompts.

##### `async call_tool(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]`

Call any MCP tool directly.

##### `async get_prompt(name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]`

Get a prompt template.

##### `async check_prompts_support() -> bool`

Dynamically check if the MCP server supports prompts.

##### `async get_capabilities() -> Dict[str, Any]`

Get the server's capabilities (tools and prompts support).

## Optional Adapter Utilities

The SDK includes **optional** adapter utilities for converting MCP tools and prompts to different AI provider formats. These are convenience helpers - you can use them, write your own conversion logic, or use MCP tools/prompts directly if your provider supports MCP natively.

### Using Adapters

```python
from translation_helps import TranslationHelpsClient
from translation_helps.adapters import (
    prepare_tools_for_provider,
    convert_all_to_openai,
    provider_supports_prompts
)

# Declarative approach (recommended)
tools = await client.list_tools()
prompts = await client.list_prompts()
openai_tools = prepare_tools_for_provider("openai", tools, prompts)

# Low-level approach (more control)
openai_tools = convert_all_to_openai(tools, prompts)

# Check provider capabilities
if provider_supports_prompts("claude-desktop"):
    # Use prompts natively
    prompt = await client.get_prompt("translation-helps-for-passage", {...})
else:
    # Convert prompts to tools
    tools = prepare_tools_for_provider("openai", tools, prompts)
```

### Available Adapter Functions

- `prepare_tools_for_provider(provider, tools, prompts)` - Declarative helper that automatically handles conversion
- `convert_tools_to_openai(tools)` - Convert MCP tools to OpenAI format
- `convert_prompts_to_openai(prompts)` - Convert MCP prompts to OpenAI format (workaround)
- `convert_all_to_openai(tools, prompts)` - Convert both tools and prompts
- `convert_tools_to_anthropic(tools)` - Convert MCP tools to Anthropic format
- `provider_supports_prompts(provider)` - Check if provider supports MCP prompts natively
- `get_prompt_strategy(provider, tools, prompts)` - Get conversion strategy
- `detect_prompts_support_from_client(client)` - Dynamically detect prompts support

See the [adapters module documentation](https://github.com/unfoldingWord/translation-helps-mcp) for more details.

## Optimized System Prompts

The SDK includes optimized, contextual system prompts for AI interactions with Translation Helps data. These prompts reduce token usage by 60-70% while maintaining all critical functionality.

### Usage

```python
from translation_helps.prompts import get_system_prompt, detect_request_type

# Auto-detect request type and get optimized prompt
prompt = get_system_prompt(None, endpoint_calls, message)

# Or manually specify request type
prompt = get_system_prompt('comprehensive')

# Use in OpenAI call
messages = [
    {"role": "system", "content": prompt},
    {"role": "user", "content": message}
]
```

### Request Types

- `comprehensive`: Uses translation-helps-for-passage prompt
- `list`: User wants concise lists
- `explanation`: User wants detailed explanations
- `term`: User asking about translation words
- `concept`: User asking about translation concepts
- `default`: Fallback

### Benefits

- **60-70% token reduction** compared to legacy prompts
- **Contextual rules** injected based on request type
- **Automatic detection** from endpoint calls and message patterns
- **Type-hinted** with full Python type support

## Examples

### Basic Usage

```python
import asyncio
from translation_helps import TranslationHelpsClient

async def main():
    client = TranslationHelpsClient()
    await client.connect()

    # Fetch scripture
    scripture = await client.fetch_scripture({
        "reference": "John 3:16"
    })

    # Fetch comprehensive helps
    notes = await client.fetch_translation_notes({
        "reference": "John 3:16"
    })

    questions = await client.fetch_translation_questions({
        "reference": "John 3:16"
    })

    words = await client.fetch_translation_word({
        "reference": "John 3:16"
    })

    await client.close()

asyncio.run(main())
```

### Error Handling

```python
try:
    scripture = await client.fetch_scripture({
        "reference": "John 3:16"
    })
except Exception as e:
    print(f"Failed to fetch scripture: {e}")
```

### Custom Server URL

```python
client = TranslationHelpsClient({
    "serverUrl": "https://your-custom-server.com/api/mcp",
    "timeout": 60000  # 60 seconds
})
```

## License

MIT

## Links

- [Documentation](https://tc-helps.mcp.servant.bible)
- [GitHub Repository](https://github.com/unfoldingWord/translation-helps-mcp)
- [MCP Protocol](https://modelcontextprotocol.io)
