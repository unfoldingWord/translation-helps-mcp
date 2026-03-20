# Build Instructions

## What Needs to Be Rebuilt

After the citation and condensed prompt fixes, the following need to be rebuilt:

### 1. MCP Server (Main Package)
**Location**: Root directory  
**Why**: Updated prompt templates in `src/mcp/prompts-registry.ts`

```bash
npm run build
```

### 2. JavaScript SDK Package
**Location**: `packages/js-sdk/`  
**Why**: Updated system prompts in `src/prompts.ts`

```bash
cd packages/js-sdk
npm run build
cd ../..
```

### 3. Python SDK Package
**Location**: `packages/python-sdk/`  
**Why**: Updated type hints in `translation_helps/types.py`

```bash
cd packages/python-sdk
py -m build
cd ../..
```

### 4. Shared Prompts Package
**Location**: `packages/shared-prompts/`  
**Why**: Updated core prompts with citation instructions

**TypeScript:**
```bash
cd packages/shared-prompts
npm run build
cd ../..
```

**Python:**
```bash
cd packages/shared-prompts/python
py -m build
cd ../../..
```

---

## Full Rebuild (Recommended)

To rebuild everything at once:

```bash
# Clean old builds
npm run clean

# Rebuild all packages
npm run build

# Rebuild JS SDK
cd packages/js-sdk && npm run build && cd ../..

# Rebuild Python packages
cd packages/python-sdk && py -m build && cd ../..
cd packages/shared-prompts/python && py -m build && cd ../../..
```

---

## What Changed

### Files Modified

#### MCP Server
- `src/mcp/prompts-registry.ts` - Added `translation-helps-report` prompt
- Updated existing prompts with citation instructions

#### JavaScript SDK
- `packages/js-sdk/src/prompts.ts` - Added citation instructions to CORE_PROMPT
- Added `condensed` request type
- Added detection for `translation-helps-report` prompt

#### Python SDK
- `packages/shared-prompts/python/prompts.py` - Added citation instructions
- Added `condensed` request type
- Added detection for `translation-helps-report` prompt

---

## Verification After Build

### 1. Check MCP Server Build

```bash
# Verify prompts are compiled
node -e "import('./dist/mcp/prompts-registry.js').then(m => console.log(Object.keys(m)))"
```

Should show: `MCP_PROMPTS` and `getPromptTemplate`

### 2. Check JS SDK Build

```bash
# Verify dist files exist
ls packages/js-sdk/dist/
```

Should show: `prompts.js`, `prompts.d.ts`, `prompts.js.map`

### 3. Test MCP Server

```bash
# Start MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js
```

Then:
- List prompts - should show `translation-helps-report`
- Test the new prompt with Spanish reference
- Verify response is condensed (~2,000-3,000 chars)

---

## Publishing (Optional)

If you want to publish updated SDK packages:

### JavaScript SDK

```bash
cd packages/js-sdk
npm version patch  # or minor/major
npm publish
cd ../..
```

### Python SDK

```bash
cd packages/python-sdk
py -m build
py -m twine upload dist/*
cd ../..
```

---

## Common Build Issues

### Issue 1: TypeScript Errors

**Symptom**: Build fails with TS errors  
**Solution**: Check `tsconfig.json` and ensure all types are correct

```bash
npx tsc --noEmit
```

### Issue 2: Missing Dependencies

**Symptom**: Module not found errors  
**Solution**: Reinstall dependencies

```bash
npm install
cd packages/js-sdk && npm install && cd ../..
```

### Issue 3: Outdated Dist Files

**Symptom**: Changes not reflected in output  
**Solution**: Clean and rebuild

```bash
rm -rf dist packages/js-sdk/dist
npm run build
cd packages/js-sdk && npm run build && cd ../..
```

---

## Quick Test Script

Create `test-build.sh`:

```bash
#!/bin/bash

echo "🔨 Building MCP Server..."
npm run build

echo "🔨 Building JS SDK..."
cd packages/js-sdk && npm run build && cd ../..

echo "✅ Build complete!"

echo "🧪 Testing MCP Server..."
node -e "
  import('./dist/mcp/prompts-registry.js').then(m => {
    const prompts = m.MCP_PROMPTS;
    console.log('Available prompts:', prompts.map(p => p.name));
    const report = prompts.find(p => p.name === 'translation-helps-report');
    if (report) {
      console.log('✅ translation-helps-report found!');
    } else {
      console.log('❌ translation-helps-report NOT found!');
      process.exit(1);
    }
  }).catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
"

echo "✅ All tests passed!"
```

Run with:
```bash
chmod +x test-build.sh
./test-build.sh
```

---

## Post-Build Checklist

- [ ] `dist/` directory exists and is populated
- [ ] `packages/js-sdk/dist/` has updated prompts.js
- [ ] MCP server starts without errors
- [ ] `translation-helps-report` prompt is listed
- [ ] Citation instructions are in CORE_PROMPT
- [ ] Test with Spanish reference (TIT 3:11-15)
- [ ] Verify condensed response size (~2,000-3,000 chars)
- [ ] Verify citations use actual resource names (GLT, not ULT)

---

## Ready to Test!

After building:

1. Start MCP Inspector: `npx @modelcontextprotocol/inspector dist/index.js`
2. Test new prompt: `translation-helps-report`
3. Use args: `{reference: "TIT 3:11-15", language: "es-419"}`
4. Verify response is condensed with correct citations

🎉 Done!
