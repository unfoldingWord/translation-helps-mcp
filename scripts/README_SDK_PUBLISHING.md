# SDK Publishing Pre-Commit Check

## Overview

A pre-commit hook automatically checks if SDK packages have unpublished changes before allowing commits. This prevents committing code that depends on unpublished SDK changes, which would break production builds.

## What It Checks

The `scripts/check-sdk-published.js` script checks:

1. **Version Comparison**: Local version vs published npm version
2. **Uncommitted Changes**: Files modified but not committed
3. **Unpushed Commits**: Commits that haven't been pushed (may contain unpublished changes)

## When It Warns

The hook will **block commits** if:

- ✅ Local SDK version is newer than published version
- ✅ SDK package has uncommitted changes
- ✅ SDK package has unpushed commits (and version isn't older)

## Publishing Process

When you make SDK changes:

1. **Update version** in `packages/js-sdk/package.json`
2. **Build the SDK:**
   ```bash
   cd packages/js-sdk
   npm run build
   ```
3. **Publish to npm:**
   ```bash
   npm publish
   ```
4. **Update UI dependency** (if version changed):
   ```bash
   cd ui
   npm install
   ```

## Bypassing the Check

⚠️ **Not recommended** - Only use if you're certain the changes don't affect production:

```bash
git commit --no-verify
```

## Configuration

SDK packages are configured in `scripts/check-sdk-published.js`:

```javascript
const SDK_PACKAGES = [
  { path: "packages/js-sdk", name: "@translation-helps/mcp-client" },
  // Add more packages here
];
```

## Testing

Test the check manually:

```bash
node scripts/check-sdk-published.js
```
