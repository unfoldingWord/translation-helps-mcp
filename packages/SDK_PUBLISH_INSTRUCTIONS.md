# SDK Publishing Instructions - v1.2.0 (JS) / v1.3.0 (Python)

## ✅ Pre-Publishing Checklist

### JS SDK v1.2.0

- [x] Version updated to `1.2.0` in `package.json`
- [x] CHANGELOG.md updated with new discovery tools
- [x] Code built (`npm run build` - ✅ completed)
- [x] README updated with discovery workflow examples
- [x] Example updated with discovery workflow
- [x] `ui/package.json` updated to use `^1.2.0`

### Python SDK v1.3.0

- [x] Version updated to `1.3.0` in `pyproject.toml`
- [x] Version updated to `1.3.0` in `translation_helps/__init__.py`
- [x] CHANGELOG.md updated with new discovery tools
- [x] README updated with discovery workflow examples
- [x] `examples/python-chatbot/requirements.txt` updated to `>=1.3.0`

## 📦 Publishing JS SDK to npm

### 1. Verify Build

```bash
cd packages/js-sdk
ls dist/  # Should show: client.js, client.d.ts, index.js, index.d.ts, etc.
```

### 2. Test Locally (Optional)

```bash
# In a test project
npm install ../packages/js-sdk
node -e "import('@translation-helps/mcp-client').then(m => console.log(Object.keys(m)))"
```

### 3. Publish to npm

```bash
cd packages/js-sdk
npm publish
```

**Requirements:**

- npm account with access to `@translation-helps` scope
- Authentication: `npm login` (if not already done)

### 4. Verify Publication

- Check: https://www.npmjs.com/package/@translation-helps/mcp-client
- Test: `npm install @translation-helps/mcp-client@1.2.0`
- Verify exports: `import { TranslationHelpsClient } from '@translation-helps/mcp-client'`

## 🐍 Publishing Python SDK to PyPI

### Option 1: Use Build Script (Recommended)

**Windows:**

```cmd
cd packages/python-sdk
build_and_publish.bat
```

**Linux/Mac:**

```bash
cd packages/python-sdk
chmod +x build_and_publish.sh
./build_and_publish.sh
```

### Option 2: Manual Steps

#### 1. Configure PyPI Token (One-Time Setup)

See [SETUP_PYPI_TOKEN.md](./python-sdk/SETUP_PYPI_TOKEN.md) for detailed instructions.

**Quick setup:**

```bash
# Create ~/.pypirc with your token
cat > ~/.pypirc << 'EOF'
[pypi]
username = __token__
password = pypi-YourActualTokenHere
EOF
```

#### 2. Install Build Tools

```bash
py -m pip install build twine
```

#### 3. Clean Previous Builds

```bash
cd packages/python-sdk
rm -rf dist build *.egg-info translation_helps_mcp_client.egg-info/
```

#### 4. Build Package

```bash
py -m build
```

#### 5. Check Package

```bash
py -m twine check dist/*
```

#### 6. Publish to PyPI

**Test on TestPyPI first (recommended):**

```bash
py -m twine upload --repository testpypi dist/*
```

**Then publish to PyPI:**

```bash
py -m twine upload dist/*
```

**Note:** If you've configured `.pypirc`, you won't be prompted for credentials!

**PyPI Credentials:**

- Username: `__token__`
- Password: Your PyPI API token
- Get token: https://pypi.org/manage/account/token/

### 6. Verify Publication

- Check: https://pypi.org/project/translation-helps-mcp-client/
- Test: `pip install translation-helps-mcp-client==1.3.0`
- Verify: `python -c "from translation_helps import TranslationHelpsClient; print('OK')"`

## 🔄 After Publishing

### Update Project Dependencies

1. **UI Project** (already updated):

   ```bash
   cd ui
   npm install @translation-helps/mcp-client@^1.2.0
   ```

2. **Example Projects** (already updated):
   - `examples/python-chatbot/requirements.txt` → `>=1.3.0`

### Test New Features

1. **Discovery Workflow:**

   ```typescript
   // JS SDK
   const langs = await client.listLanguages();
   const resources = await client.listResourcesForLanguage({
     language: "es-419",
   });
   ```

   ```python
   # Python SDK
   langs = await client.list_languages()
   resources = await client.list_resources_for_language({"language": "es-419"})
   ```

2. **All 11 Tools Available:**
   - ✅ fetch_scripture
   - ✅ fetch_translation_notes
   - ✅ fetch_translation_questions
   - ✅ fetch_translation_word
   - ✅ fetch_translation_word_links
   - ✅ fetch_translation_academy
   - ✅ search_translation_word_across_languages (NEW in SDK)
   - ✅ list_languages
   - ✅ list_subjects
   - ✅ list_resources_by_language
   - ✅ list_resources_for_language

## 📝 What's New in This Release

### JS SDK v1.2.0

- Added 5 discovery tools (listLanguages, listSubjects, listResourcesByLanguage, listResourcesForLanguage, searchTranslationWordAcrossLanguages)
- All 11 MCP tools now available
- Updated README with discovery workflow examples
- Performance notes and recommendations

### Python SDK v1.3.0

- Added 5 discovery tools (list_languages, list_subjects, list_resources_by_language, list_resources_for_language, search_translation_word_across_languages)
- All 11 MCP tools now available
- Updated README with discovery workflow examples
- Performance notes and recommendations

## 🚀 Next Steps

1. Publish JS SDK: `cd packages/js-sdk && npm publish`
2. Publish Python SDK: Use build script or manual steps above
3. Update any external projects using the SDKs
4. Test the new discovery tools in production
5. Update documentation if needed
