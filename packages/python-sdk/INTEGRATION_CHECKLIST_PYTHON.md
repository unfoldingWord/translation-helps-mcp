# State Injection Interceptor - Python Integration Checklist

## ✅ **Phase 1: Verify Files Created** (2 minutes)

Check that these files exist in `packages/python-sdk/`:

- [x] `translation_helps/context_manager.py` (178 lines)
- [x] `translation_helps/state_injection_interceptor.py` (202 lines)
- [x] `translation_helps/validators.py` (298 lines)
- [x] `translation_helps/default_tool_config.py` (96 lines)
- [x] `tests/test_interceptor.py` (570 lines)

---

## ✅ **Phase 2: Update Client Class** (20 minutes)

Open `translation_helps/client.py`:

### **A. Add Imports** (Top of file)
```python
from .context_manager import ContextManager
from .state_injection_interceptor import (
    StateInjectionInterceptor,
    InterceptorOptions
)
from .default_tool_config import DEFAULT_TOOL_CONTEXT_CONFIG, ToolContextConfig
from .validators import (
    LANGUAGE_CODE_VALIDATOR,
    ORGANIZATION_VALIDATOR,
    STAGE_VALIDATOR,
    REFERENCE_VALIDATOR,
    FORMAT_VALIDATOR,
    BOOLEAN_VALIDATOR
)
from typing import Optional, Dict, Any
```

- [ ] Added imports for interceptor components
- [ ] Added type hints imports

### **B. Add Class Properties** (In `__init__`)
```python
def __init__(
    self,
    server_url: Optional[str] = None,
    timeout: int = 90000,
    enable_metrics: bool = False,
    # New interceptor parameters
    enable_interceptor: bool = False,
    tool_context_config: Optional[ToolContextConfig] = None,
    interceptor_options: Optional[InterceptorOptions] = None,
    initial_context: Optional[Dict[str, Any]] = None,
    **kwargs
):
    # ... existing code ...
    
    # Initialize Context Manager
    self._context_manager = ContextManager()
    self._interceptor = None
    self._interceptor_enabled = False
    
    # Register validation rules
    self._context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
    self._context_manager.add_validation_rule('organization', ORGANIZATION_VALIDATOR)
    self._context_manager.add_validation_rule('stage', STAGE_VALIDATOR)
    self._context_manager.add_validation_rule('reference', REFERENCE_VALIDATOR)
    self._context_manager.add_validation_rule('format', FORMAT_VALIDATOR)
    self._context_manager.add_validation_rule('includeAlignment', BOOLEAN_VALIDATOR)
    self._context_manager.add_validation_rule('includeContext', BOOLEAN_VALIDATOR)
    self._context_manager.add_validation_rule('includeIntro', BOOLEAN_VALIDATOR)
    
    # Initialize interceptor if enabled
    if enable_interceptor:
        self.enable_state_injection(tool_context_config, interceptor_options)
    
    # Pre-populate context if provided
    if initial_context:
        self._context_manager.set_many(initial_context)
```

- [ ] Added `_context_manager` property
- [ ] Added `_interceptor` property
- [ ] Added `_interceptor_enabled` property
- [ ] Registered validation rules
- [ ] Added initialization logic

### **C. Add New Public Methods**

Add these methods to the `TranslationHelpsClient` class:

```python
def enable_state_injection(
    self,
    tool_config: Optional[ToolContextConfig] = None,
    options: Optional[InterceptorOptions] = None
) -> None:
    """Enable the State Injection Interceptor."""
    final_config = tool_config or DEFAULT_TOOL_CONTEXT_CONFIG
    self._interceptor = StateInjectionInterceptor(
        self._context_manager,
        final_config,
        options or InterceptorOptions()
    )
    self._interceptor_enabled = True

def disable_state_injection(self) -> None:
    """Disable the State Injection Interceptor."""
    self._interceptor = None
    self._interceptor_enabled = False

def get_context_manager(self) -> ContextManager:
    """Get the context manager instance."""
    return self._context_manager

def get_interceptor(self) -> Optional[StateInjectionInterceptor]:
    """Get the interceptor instance."""
    return self._interceptor

def set_context(self, key: str, value: Any) -> bool:
    """Set a context value."""
    return self._context_manager.set(key, value)

def get_context(self, key: str, default: Any = None) -> Any:
    """Get a context value."""
    return self._context_manager.get(key, default)

def set_context_many(self, values: Dict[str, Any]) -> Dict[str, bool]:
    """Set multiple context values at once."""
    return self._context_manager.set_many(values)

def clear_context(self) -> None:
    """Clear all context."""
    self._context_manager.clear()

def get_all_context(self) -> Dict[str, Any]:
    """Get all context values."""
    return self._context_manager.get_all()
```

- [ ] Added `enable_state_injection()` method
- [ ] Added `disable_state_injection()` method
- [ ] Added `get_context_manager()` method
- [ ] Added `get_interceptor()` method
- [ ] Added `set_context()` convenience method
- [ ] Added `get_context()` convenience method
- [ ] Added `set_context_many()` convenience method
- [ ] Added `clear_context()` convenience method
- [ ] Added `get_all_context()` convenience method

### **D. Update `call_tool` Method**

Find the existing `call_tool` method and update it:

```python
async def call_tool(
    self,
    name: str,
    arguments_: Dict[str, Any]
) -> Any:
    """Call a tool by name (with interceptor support)."""
    await self._ensure_initialized()
    
    # Apply state injection interceptor if enabled
    final_arguments = arguments_
    interception_metadata = None
    
    if self._interceptor_enabled and self._interceptor:
        result = self._interceptor.intercept(name, arguments_)
        final_arguments = result.arguments
        
        # Store metadata for debugging/logging
        if result.modified:
            interception_metadata = {
                'injected': result.injected,
                'synced': result.synced,
                'original_args': arguments_,
                'final_args': final_arguments
            }
            
            print(f'[SDK] 🔄 State Injection Applied: tool={name}, '
                  f'injected={list(result.injected.keys())}, '
                  f'synced={list(result.synced.keys())}')
    
    # Call the MCP server with potentially modified arguments
    response = await self._send_request('tools/call', {
        'name': name,
        'arguments': final_arguments
    })
    
    # Attach interception metadata if metrics are enabled
    if self._enable_metrics and interception_metadata:
        if not hasattr(response, 'metadata'):
            response.metadata = {}
        response.metadata['state_injection'] = interception_metadata
    
    return response
```

- [ ] Added interceptor check at method start
- [ ] Call `interceptor.intercept()` if enabled
- [ ] Use modified arguments for MCP call
- [ ] Added debug logging
- [ ] Attach metadata if metrics enabled

---

## ✅ **Phase 3: Update Exports** (3 minutes)

Open `translation_helps/__init__.py`:

### **Add Imports:**
```python
# Interceptor components
from .context_manager import ContextManager
from .state_injection_interceptor import (
    StateInjectionInterceptor,
    InterceptorOptions,
    InterceptionResult
)
from .default_tool_config import (
    DEFAULT_TOOL_CONTEXT_CONFIG,
    PERSISTENT_CONTEXT_KEYS,
    VOLATILE_CONTEXT_KEYS,
    create_tool_config,
    bulk_add_context_requirements
)
from .validators import (
    LANGUAGE_CODE_VALIDATOR,
    ORGANIZATION_VALIDATOR,
    RESOURCE_TYPE_VALIDATOR,
    REFERENCE_VALIDATOR,
    BOOK_CODE_VALIDATOR,
    CHAPTER_VALIDATOR,
    VERSE_VALIDATOR,
    FORMAT_VALIDATOR,
    BOOLEAN_VALIDATOR,
    STAGE_VALIDATOR,
    create_string_length_validator,
    create_number_range_validator,
    create_enum_validator,
    create_composite_validator
)
```

### **Update `__all__`:**
```python
__all__ = [
    # ... existing exports ...
    
    # Interceptor
    'ContextManager',
    'StateInjectionInterceptor',
    'InterceptorOptions',
    'InterceptionResult',
    'DEFAULT_TOOL_CONTEXT_CONFIG',
    'PERSISTENT_CONTEXT_KEYS',
    'VOLATILE_CONTEXT_KEYS',
    'create_tool_config',
    'bulk_add_context_requirements',
    
    # Validators
    'LANGUAGE_CODE_VALIDATOR',
    'ORGANIZATION_VALIDATOR',
    'RESOURCE_TYPE_VALIDATOR',
    'REFERENCE_VALIDATOR',
    'BOOK_CODE_VALIDATOR',
    'CHAPTER_VALIDATOR',
    'VERSE_VALIDATOR',
    'FORMAT_VALIDATOR',
    'BOOLEAN_VALIDATOR',
    'STAGE_VALIDATOR',
    'create_string_length_validator',
    'create_number_range_validator',
    'create_enum_validator',
    'create_composite_validator',
]
```

- [ ] Added imports to `__init__.py`
- [ ] Updated `__all__` list

---

## ✅ **Phase 4: Run Tests** (5 minutes)

```bash
cd packages/python-sdk

# Install test dependencies
pip install pytest pytest-asyncio

# Run interceptor tests
pytest tests/test_interceptor.py -v

# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/test_interceptor.py --cov=translation_helps --cov-report=html
```

### **Expected Results:**
- [ ] All tests pass (60+ tests)
- [ ] No import errors
- [ ] Coverage > 90%

---

## ✅ **Phase 5: Build Package** (2 minutes)

```bash
cd packages/python-sdk

# Install build tools
py -m pip install build twine

# Build package
py -m build

# Verify distribution files created
ls dist/
# Should see: translation_helps_mcp_client-X.X.X.tar.gz
#             translation_helps_mcp_client-X.X.X-py3-none-any.whl
```

- [ ] Build completed successfully
- [ ] Distribution files created
- [ ] No build errors

---

## ✅ **Phase 6: Test Import** (2 minutes)

```bash
# Install locally for testing
py -m pip install -e packages/python-sdk

# Test imports
python -c "from translation_helps import ContextManager; print('✅ ContextManager imported')"
python -c "from translation_helps import StateInjectionInterceptor; print('✅ Interceptor imported')"
python -c "from translation_helps import LANGUAGE_CODE_VALIDATOR; print('✅ Validators imported')"
```

- [ ] All imports work without errors
- [ ] No module not found errors

---

## ✅ **Phase 7: Verify in Application** (5 minutes)

Create a test script `test_interceptor_integration.py`:

```python
import asyncio
from translation_helps import TranslationHelpsClient

async def test_interceptor():
    # Enable interceptor
    client = TranslationHelpsClient(
        server_url='http://localhost:5173/mcp',
        enable_interceptor=True,
        initial_context={'language': 'en'},
        interceptor_options={'debug': True}
    )
    
    await client.connect()
    
    # Test 1: Auto-injection
    print("\n🧪 Test 1: Auto-injection (missing language)")
    result1 = await client.fetch_scripture(reference='John 3:16')
    print(f"✅ Result: {result1 is not None}")
    
    # Test 2: Explicit language change
    print("\n🧪 Test 2: Language change (explicit)")
    result2 = await client.fetch_scripture(reference='John 3:16', language='es-419')
    print(f"✅ Context synced: {client.get_context('language')}")
    
    # Test 3: Auto-injection with new language
    print("\n🧪 Test 3: Auto-injection (new language)")
    result3 = await client.fetch_translation_notes(reference='Romans 1:1')
    print(f"✅ Result: {result3 is not None}")
    
    print(f"\n📊 Final context: {client.get_all_context()}")

if __name__ == '__main__':
    asyncio.run(test_interceptor())
```

Run the test:
```bash
python test_interceptor_integration.py
```

- [ ] Test script runs without errors
- [ ] Debug logs show injection/sync events
- [ ] Context is properly maintained

---

## ✅ **Phase 8: Publish to PyPI** (3 minutes)

```bash
cd packages/python-sdk

# Upload to PyPI
py -m twine upload dist/*

# Or test PyPI first
py -m twine upload --repository testpypi dist/*
```

- [ ] Package published successfully
- [ ] Version number incremented (e.g., 1.5.0 → 1.6.0)
- [ ] Package installable via pip

---

## 🐛 **Troubleshooting Checklist**

If something doesn't work:

### **Import Errors?**
- [ ] Check `__init__.py` has all exports
- [ ] Verify all files are in `translation_helps/` directory
- [ ] Run `pip install -e .` to install in editable mode
- [ ] Check for typos in import statements

### **Tests Failing?**
- [ ] Install pytest: `pip install pytest pytest-asyncio`
- [ ] Check if test file is in `tests/` directory
- [ ] Run with verbose: `pytest -v`
- [ ] Check Python version (3.8+ required)

### **Interceptor Not Working?**
- [ ] Verify `enable_interceptor=True` in client init
- [ ] Check `client.get_interceptor()` returns non-None
- [ ] Enable debug mode: `InterceptorOptions(debug=True)`
- [ ] Verify context is set: `client.get_all_context()`

### **Parameters Not Being Injected?**
- [ ] Check tool name in `DEFAULT_TOOL_CONTEXT_CONFIG`
- [ ] Verify context key exists: `client.get_context('language')`
- [ ] Check if parameter is in tool's required list
- [ ] Enable debug logging to see what's happening

### **Validation Failing?**
- [ ] Check validator is registered for that key
- [ ] Test validator directly: `validator.validate(value)`
- [ ] Check validation error message in console
- [ ] Verify value format matches expected pattern

### **Build Errors?**
- [ ] Install build tools: `py -m pip install build`
- [ ] Check `pyproject.toml` is valid
- [ ] Verify all source files have no syntax errors
- [ ] Try: `py -m build --no-isolation`

---

## 📊 **Integration Progress Tracker**

### **Core Files:**
- [x] `context_manager.py` created
- [x] `state_injection_interceptor.py` created
- [x] `validators.py` created
- [x] `default_tool_config.py` created
- [x] `test_interceptor.py` created

### **Client Integration:**
- [ ] Imports added to `client.py`
- [ ] Properties added to `__init__`
- [ ] New methods added to class
- [ ] `call_tool` method updated

### **Package Updates:**
- [ ] Exports added to `__init__.py`
- [ ] `__all__` updated

### **Testing:**
- [ ] Tests run successfully
- [ ] All 60+ tests pass
- [ ] No import errors

### **Build & Publish:**
- [ ] Package builds successfully
- [ ] No build warnings
- [ ] Published to PyPI (or TestPyPI)

---

## 🎯 **Quick Verification Commands**

```bash
# Check files exist
ls translation_helps/context_manager.py
ls translation_helps/state_injection_interceptor.py
ls translation_helps/validators.py
ls translation_helps/default_tool_config.py
ls tests/test_interceptor.py

# Test imports
python -c "from translation_helps.context_manager import ContextManager; print('✅')"
python -c "from translation_helps.state_injection_interceptor import StateInjectionInterceptor; print('✅')"
python -c "from translation_helps.validators import LANGUAGE_CODE_VALIDATOR; print('✅')"

# Run tests
pytest tests/test_interceptor.py -v

# Build package
py -m build

# Check distribution
ls dist/
```

---

## 🎉 **Completion Criteria**

You're done when:

- ✅ All files exist in correct locations
- ✅ Client class has all new methods
- ✅ Exports are updated in `__init__.py`
- ✅ All tests pass (60+)
- ✅ Package builds successfully
- ✅ Integration test runs without errors
- ✅ Debug logs show injection/sync working

---

## 📚 **Reference Documentation**

- **Implementation Guide:** `PYTHON_INTERCEPTOR_IMPLEMENTATION.md`
- **Usage Examples:** `INTERCEPTOR_USAGE_EXAMPLES.md`
- **Quick Reference:** `QUICK_REFERENCE_PYTHON.md`
- **Tests:** `tests/test_interceptor.py`

---

**Estimated Total Time: ~40 minutes** ⏱️

**Print this checklist and mark off items as you complete them!** ✓
