# MCP Inspector Testing Guide

## Official Tool for Testing MCP Servers

The **MCP Inspector** is Anthropic's official browser-based tool for testing and debugging MCP servers.

---

## Quick Start

### 1. Start the Inspector

```bash
npx @modelcontextprotocol/inspector mcp-inspector-config.json
```

The Inspector will start and open in your browser at **http://localhost:5173**

### 2. What You'll See

The Inspector UI has several sections:

#### **Left Panel: Server Connection**
- Shows your connected MCP server
- Displays connection status
- Lists available tools and prompts

#### **Center Panel: Testing Interface**
- **Tools Tab**: Test individual MCP tools
- **Prompts Tab**: Test MCP prompts
- **Resources Tab**: View available resources (if any)

#### **Right Panel: Request/Response**
- Shows raw JSON-RPC requests
- Shows raw responses
- Useful for debugging

---

## Testing Your Tools

### Example: Test `fetch_scripture`

1. **Click "Tools" tab** in the center panel
2. **Select `fetch_scripture`** from the list
3. **Fill in parameters**:
   ```json
   {
     "reference": "John 3:16",
     "language": "en",
     "resource": "ult"
   }
   ```
4. **Click "Run Tool"**
5. **View results** in the response panel

### Example: Test `fetch_translation_notes`

1. **Select `fetch_translation_notes`**
2. **Parameters**:
   ```json
   {
     "reference": "John 3:16",
     "language": "en"
   }
   ```
3. **Click "Run Tool"**
4. **See translation notes** appear

### Example: Test `list_languages`

1. **Select `list_languages`**
2. **Parameters**:
   ```json
   {
     "organization": "unfoldingWord"
   }
   ```
3. **Click "Run Tool"**
4. **View list of languages**

---

## Testing Your Prompts

Your server has 5 prompts available:

### 1. `translation-helps-for-passage`
Complete translation help for a passage

**Arguments**:
```json
{
  "reference": "John 3:16",
  "language": "en"
}
```

### 2. `get-translation-words-for-passage`
Get translation words for a passage

**Arguments**:
```json
{
  "reference": "John 3:16",
  "language": "en"
}
```

### 3. `get-translation-academy-for-passage`
Get Translation Academy articles for a passage

**Arguments**:
```json
{
  "reference": "John 3:16",
  "language": "en"
}
```

### 4. `discover-resources-for-language`
Discover resources for a language

**Arguments**:
```json
{
  "language": "en",
  "organization": "unfoldingWord"
}
```

### 5. `discover-languages-for-subject`
Discover languages for a resource type

**Arguments**:
```json
{
  "subject": "Bible",
  "organization": "unfoldingWord"
}
```

---

## Inspector Features

### 🔍 **Request/Response Inspection**
- See exact JSON-RPC messages
- Debug parameter passing
- View error messages

### ⚡ **Live Server Connection**
- Real-time testing
- Instant feedback
- Connection status monitoring

### 📝 **Parameter Editing**
- JSON editor for parameters
- Syntax highlighting
- Validation errors

### 📊 **Result Formatting**
- Pretty-printed JSON
- Expandable/collapsible sections
- Easy to read responses

---

## Common Test Scenarios

### Scenario 1: Test Scripture Fetching
```
Tool: fetch_scripture
Parameters: { "reference": "Genesis 1:1", "language": "en", "resource": "all" }
Expected: Multiple scripture translations
```

### Scenario 2: Test Word Lookup
```
Tool: fetch_translation_word
Parameters: { "term": "believe", "language": "en" }
Expected: Translation word article for "believe"
```

### Scenario 3: Test Academy Articles
```
Tool: fetch_translation_academy
Parameters: { "moduleId": "figs-metaphor", "language": "en" }
Expected: Metaphor training article
```

### Scenario 4: Test Discovery
```
Tool: list_resources_for_language
Parameters: { "language": "en", "organization": "unfoldingWord" }
Expected: All resources available in English
```

---

## Troubleshooting

### Inspector Won't Start
```bash
# Kill any existing Inspector processes
taskkill //F //IM node.exe //FI "WINDOWTITLE eq MCP Inspector*"

# Restart Inspector
npx @modelcontextprotocol/inspector mcp-inspector-config.json
```

### Server Connection Failed
1. Check if MCP server is running (Inspector starts it automatically)
2. Look at terminal output for errors
3. Verify `mcp-inspector-config.json` is correct

### Tool Returns Error
1. Check parameter format (must be valid JSON)
2. Verify required parameters are provided
3. Look at raw response for error details

---

## Configuration File

Your Inspector config is in `mcp-inspector-config.json`:

```json
{
  "mcpServers": {
    "translation-helps-mcp-local": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

### To Add Environment Variables

```json
{
  "mcpServers": {
    "translation-helps-mcp-local": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "NODE_ENV": "development",
        "ANTHROPIC_API_KEY": "your-key-here",
        "DEBUG": "true"
      }
    }
  }
}
```

---

## Advanced Testing

### Test All Tools Systematically

1. **Discovery Tools** (no external dependencies):
   - `list_languages`
   - `list_subjects`
   - `list_resources_for_language`

2. **Scripture Tools** (require reference):
   - `fetch_scripture`
   - `fetch_translation_notes`
   - `fetch_translation_questions`
   - `fetch_translation_word_links`

3. **Content Tools** (require term/moduleId):
   - `fetch_translation_word`
   - `fetch_translation_academy`

### Test Prompts in Order

1. **Discovery prompts** (learn what's available):
   - `discover-resources-for-language`
   - `discover-languages-for-subject`

2. **Content prompts** (fetch actual content):
   - `translation-helps-for-passage`
   - `get-translation-words-for-passage`
   - `get-translation-academy-for-passage`

---

## Comparison with Other Testing Methods

| Method | Pros | Cons |
|--------|------|------|
| **MCP Inspector** | ✅ Official tool<br>✅ Visual UI<br>✅ Request/response inspection<br>✅ Easy parameter editing | ⚠️ Requires browser<br>⚠️ Additional setup |
| **Direct stdio** | ✅ Programmatic<br>✅ Scriptable | ⚠️ Complex JSON-RPC<br>⚠️ No UI |
| **HTTP Bridge** (`/api/mcp`)| ✅ REST-like<br>✅ Easy to use | ⚠️ Not standard MCP |
| **Cursor/Claude** | ✅ Real-world use<br>✅ AI interaction | ⚠️ Harder to debug |

---

## Tips

1. **Start with Simple Tools**: Test `list_languages` first to verify connection
2. **Use Copy/Paste**: Copy working parameters and modify them
3. **Watch Terminal**: Keep an eye on server logs for errors
4. **Test Incrementally**: Test one tool at a time
5. **Save Good Examples**: Keep note of working parameter combinations

---

## Next Steps

Once you've tested your tools in Inspector:

1. ✅ **Verify all tools work** with various parameters
2. ✅ **Test edge cases** (empty results, invalid parameters)
3. ✅ **Document examples** of working tool calls
4. ✅ **Test prompts** to ensure workflows work end-to-end
5. ✅ **Share with team** for integration testing

---

## Resources

- **MCP Documentation**: https://modelcontextprotocol.io
- **MCP Inspector GitHub**: https://github.com/modelcontextprotocol/inspector
- **Your Server Docs**: See `README.md` in this repo

---

## Stopping the Inspector

When done testing:

```bash
# Stop Inspector (Ctrl+C in terminal or close browser)
# Inspector will stop the MCP server automatically
```

Or find and kill the process:

```bash
taskkill //F //PID <pid_from_terminal>
```

The MCP Inspector is the best way to test your server during development!
