# Development Setup

## Using Local SDK for Development

For local development, you can use the local SDK package instead of the npm version:

### Setup (One-time)

1. **Link the local SDK:**

   ```bash
   cd packages/js-sdk
   npm link
   ```

2. **Link it in the UI:**
   ```bash
   cd ui
   npm link @translation-helps/mcp-client
   ```

### Verify

Check that the UI is using the local version:

```bash
cd ui
npm list @translation-helps/mcp-client
```

You should see:

```
`-- @translation-helps/mcp-client@1.2.1 -> .\..\packages\js-sdk
```

### Unlink (for Production)

To switch back to the npm version:

```bash
cd ui
npm unlink @translation-helps/mcp-client
npm install
```

### Rebuilding SDK

After making changes to the SDK, rebuild it:

```bash
cd packages/js-sdk
npm run build
```

The UI will automatically pick up changes (no need to reinstall).

## Production Builds

Production builds (CI/CD, deployments) will automatically use the npm version (`^1.2.1`) since `npm link` is not used in those environments.
