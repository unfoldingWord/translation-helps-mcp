# SDK Changelog Updates

## ✅ Summary

Both SDKs now have **complete, up-to-date changelogs** that will be visible on their respective package store websites:

- **JavaScript SDK (npm)**: `CHANGELOG.md` included in package
- **Python SDK (PyPI)**: `CHANGELOG.md` included in distribution

---

## 📝 Changelog Files

### JavaScript SDK (`packages/js-sdk/CHANGELOG.md`)

**Latest Versions:**
- **v1.4.2** (2026-03-20) - Organization parameter fix
- **v1.4.1** (2026-03-20) - Enhanced LLM prompt system
- **v1.3.0** (2025-12-09) - Tool removals and topic default

**Package Inclusion:**
- ✅ Added to `package.json` "files" array
- ✅ Will appear on npmjs.com package page
- ✅ Accessible via GitHub repository link on npm

### Python SDK (`packages/python-sdk/CHANGELOG.md`)

**Latest Versions:**
- **v1.5.2** (2026-03-20) - Organization parameter fix
- **v1.5.1** (2026-03-20) - Enhanced LLM prompt system
- **v1.5.0** (2026-03-20) - State Injection Interceptor
- **v1.4.0** (2025-12-09) - Tool removals and topic default

**Package Inclusion:**
- ✅ Added to `MANIFEST.in` file
- ✅ Verified in build output (copied to distribution)
- ✅ Will appear on PyPI package page
- ✅ Accessible via GitHub repository link on PyPI

---

## 🔄 Recent Changes Documented

### v1.4.2 / v1.5.2 - Organization Parameter Fix

**Breaking Change:**
- Removed implicit `"unfoldingWord"` default from all fetch methods
- Now correctly searches **all organizations** when `organization` parameter is omitted
- Only includes `organization` in request if explicitly provided

**Affected Methods:**
- `fetchScripture()` / `fetch_scripture()`
- `fetchTranslationNotes()` / `fetch_translation_notes()`
- `fetchTranslationQuestions()` / `fetch_translation_questions()`
- `fetchTranslationWord()` / `fetch_translation_word()`
- `fetchTranslationWordLinks()` / `fetch_translation_word_links()`
- `fetchTranslationAcademy()` / `fetch_translation_academy()`

**Migration Guide:**
```javascript
// Before (relied on implicit default)
await client.fetchScripture({ reference: "John 3:16" });

// After (must be explicit if you want unfoldingWord only)
await client.fetchScripture({ 
  reference: "John 3:16", 
  organization: "unfoldingWord" 
});
```

### v1.4.1 / v1.5.1 - Enhanced LLM Prompt System

**Improvements:**
- Added mandatory format enforcement: `🚨 MANDATORY TRANSLATION NOTES FORMAT 🚨`
- Requires matching Greek quotes to scripture text for accurate note display
- Ensures all notes are shown individually with complete content
- Updated `list` mode contextual rules for comprehensive note display
- Full parity between JavaScript and Python SDKs

---

## 📦 Package Store Visibility

### npm (JavaScript SDK)

**Where users will see the changelog:**
1. **npmjs.com package page** - "Repository" tab will link to GitHub
2. **GitHub repository** - Direct access to CHANGELOG.md
3. **npm install output** - Can run `npm view @translation-helps/mcp-client` to see package info
4. **IDE/Editor** - Some IDEs show changelog when updating packages

**Example:**
```bash
npm info @translation-helps/mcp-client
# Shows repository URL with changelog
```

### PyPI (Python SDK)

**Where users will see the changelog:**
1. **pypi.org package page** - "Project description" section
2. **GitHub repository** - "Homepage" and "Source" links on PyPI
3. **pip install output** - Can run `pip show translation-helps-mcp-client`
4. **Documentation sites** - ReadTheDocs, etc. can pull from changelog

**Example:**
```bash
pip show translation-helps-mcp-client
# Shows metadata with links to source/changelog
```

---

## ✅ Verification Steps Completed

1. ✅ **JavaScript SDK:**
   - CHANGELOG.md exists: ✓
   - Added to package.json "files": ✓
   - Rebuild completed: ✓
   - All versions documented: ✓

2. ✅ **Python SDK:**
   - CHANGELOG.md exists: ✓
   - Added to MANIFEST.in: ✓
   - Rebuild completed: ✓
   - Verified in build output: ✓
   - All versions documented: ✓

---

## 🚀 Ready for Publishing

Both SDKs are now ready to be published with complete changelog documentation:

### JavaScript SDK v1.4.2
```bash
cd packages/js-sdk
npm publish
```

### Python SDK v1.5.2
```bash
cd packages/python-sdk
py -m twine upload dist/*
```

---

## 📖 Changelog Format

Both changelogs follow **[Keep a Changelog](https://keepachangelog.com/)** format:

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security vulnerabilities

This makes it easy for developers to:
- Quickly scan for breaking changes
- Understand what's new in each version
- Plan upgrades and migrations
- Track bug fixes

---

## 🎯 Next Steps

1. **Publish SDKs** to their respective registries
2. **Verify changelog visibility** on package store websites
3. **Monitor user feedback** on breaking changes
4. **Update main project CHANGELOG.md** to reference SDK versions

---

*Generated: 2026-03-20*
