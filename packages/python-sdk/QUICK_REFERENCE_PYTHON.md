# State Injection Interceptor - Python Quick Reference Card

## 🚀 **Enable in 30 Seconds**

```python
from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient(
    enable_interceptor=True,
    initial_context={'language': 'en', 'organization': 'unfoldingWord'}
)
```

---

## 🎯 **Common Operations**

### **Set Context**

```python
client.set_context('language', 'en')
client.set_context('organization', 'unfoldingWord')

# Or batch set
client.set_context_many({
    'language': 'es-419',
    'organization': 'door43',
    'stage': 'prod'
})
```

### **Get Context**

```python
language = client.get_context('language')  # 'en'
all_context = client.get_all_context()  # {'language': 'en', ...}
```

### **Clear Context**

```python
client.clear_context()  # Clear all
```

---

## 🔧 **Enable After Initialization**

```python
from translation_helps import TranslationHelpsClient
from translation_helps.state_injection_interceptor import InterceptorOptions

client = TranslationHelpsClient()
await client.connect()

# Enable later
client.enable_state_injection(
    tool_config=None,  # Use default config
    options=InterceptorOptions(debug=True)
)
```

---

## 🛠️ **Custom Configuration**

```python
from translation_helps.default_tool_config import create_tool_config

config = create_tool_config({
    'my_custom_tool': ['language', 'customParam']
})

client = TranslationHelpsClient(
    enable_interceptor=True,
    tool_context_config=config
)
```

---

## ✅ **Add Validation**

```python
from translation_helps.validators import LANGUAGE_CODE_VALIDATOR

context_manager = client.get_context_manager()
context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)

# Now invalid values are rejected
client.set_context('language', 'invalid!!!')  # Returns False
```

---

## 🎨 **Custom Validator**

```python
from translation_helps.context_manager import Validator

my_validator = Validator(
    validate_fn=lambda v: isinstance(v, str) and len(v) > 0,
    error_message='Must be non-empty string'
)

client.get_context_manager().add_validation_rule('myParam', my_validator)
```

---

## 📊 **Debug Mode**

```python
from translation_helps.state_injection_interceptor import InterceptorOptions

client = TranslationHelpsClient(
    enable_interceptor=True,
    interceptor_options=InterceptorOptions(
        debug=True,  # Enable logging
        on_context_injected=lambda tool, injected: print(
            f"✅ Injected into {tool}: {injected}"
        ),
        on_context_synced=lambda tool, synced: print(
            f"🔄 Synced from {tool}: {synced}"
        )
    )
)
```

---

## 🔍 **Inspect State**

```python
# Check what's in context
print('Current context:', client.get_all_context())

# Get interceptor for advanced config
interceptor = client.get_interceptor()
if interceptor:
    print('Tool config:', interceptor.get_tool_config())
```

---

## 🧪 **Test Pattern (pytest)**

```python
import pytest
from translation_helps import TranslationHelpsClient

@pytest.mark.asyncio
async def test_should_inject_language_from_context():
    client = TranslationHelpsClient(
        enable_interceptor=True,
        initial_context={'language': 'en'}
    )

    await client.connect()

    # Language will be injected automatically
    result = await client.fetch_scripture(reference='John 3:16')

    assert result is not None
```

---

## 🎯 **Default Tool Config**

These tools automatically get context injection:

| Tool                           | Injected context (default) |
| ------------------------------ | -------------------------- |
| `fetch_scripture`              | `language`, `stage`        |
| `fetch_translation_notes`      | `language`, `stage`        |
| `fetch_translation_questions`  | `language`, `stage`        |
| `fetch_translation_word`       | `language`, `stage`        |
| `fetch_translation_word_links` | `language`, `stage`        |
| `fetch_translation_academy`    | `language`, `stage`        |
| `list_languages`               | `stage`                    |
| `list_subjects`                | `stage`                    |
| `list_resources_for_language`  | `stage`                    |

TN/TQ and many languages: omit `organization` so all Door43 orgs are searched (Spanish TN is rarely under unfoldingWord). Pass `organization` only when you want a specific owner.

---

## 📦 **Built-in Validators**

```python
from translation_helps.validators import (
    LANGUAGE_CODE_VALIDATOR,    # 'en', 'en-US', 'es-419'
    ORGANIZATION_VALIDATOR,    # 'unfoldingWord', 'door43'
    REFERENCE_VALIDATOR,       # 'John 3:16', 'Romans 1:1-7'
    BOOK_CODE_VALIDATOR,       # 'GEN', 'JHN', '3JN'
    CHAPTER_VALIDATOR,         # 1-150
    VERSE_VALIDATOR,           # 1-176
    FORMAT_VALIDATOR,          # 'json', 'text', 'usfm'
    BOOLEAN_VALIDATOR,         # True, False
    STAGE_VALIDATOR,           # 'prod', 'preprod', 'latest'
    create_string_length_validator,  # Factory
    create_number_range_validator,   # Factory
    create_enum_validator            # Factory
)
```

---

## 🚨 **Troubleshooting**

### **Interceptor not working?**

```python
# Check if enabled
interceptor = client.get_interceptor()
print('Enabled:', interceptor is not None)

# Check context
print('Context:', client.get_all_context())
```

### **Parameters not being injected?**

```python
# Enable debug mode
from translation_helps.state_injection_interceptor import InterceptorOptions

client = TranslationHelpsClient(
    enable_interceptor=True,
    interceptor_options=InterceptorOptions(debug=True)
)

# Check tool config
interceptor = client.get_interceptor()
print('Config:', interceptor.get_tool_config())
```

### **Validation failing?**

```python
# Check which validator is rejecting
context_manager = client.get_context_manager()
success = context_manager.set('language', 'invalid')
print('Validation passed:', success)
```

---

## 💡 **Pro Tips**

1. **Always enable debug mode during development**
2. **Set initial context during client initialization**
3. **Use validation rules for critical parameters**
4. **Clear context between user sessions**
5. **Monitor `get_all_context()` to debug issues**
6. **Use `pytest` for comprehensive testing**

---

## 📚 **Full Documentation**

- **Complete Guide:** `PYTHON_INTERCEPTOR_IMPLEMENTATION.md`
- **Usage Examples:** `INTERCEPTOR_USAGE_EXAMPLES.md` (11 examples)
- **API Reference:** Docstrings in source files
- **Tests:** `tests/test_interceptor.py`

---

## 🏃 **Running Tests**

```bash
# Run all interceptor tests
pytest tests/test_interceptor.py -v

# Run specific test class
pytest tests/test_interceptor.py::TestContextManager -v

# Run with coverage
pytest tests/test_interceptor.py --cov=translation_helps
```

---

## 📋 **Installation**

```bash
# Install package
pip install translation-helps-mcp-client

# For development
cd packages/python-sdk
pip install -e ".[dev]"
```

---

**Print this card and keep it handy!** 📌
