# SDK Publishing Guide — v2

## Overview

Both the JavaScript/TypeScript SDK (`@translation-helps/mcp-client`) and the Python SDK
(`translation-helps-client`) target the **v2 MCP server** on Cloudflare Workers with
Streamable HTTP + SSE at `/mcp`.

Versioning is managed by [Changesets](https://github.com/changesets/changeset).
Both SDKs are kept in version lockstep automatically by `release.yml`.

---

## Automated Release Flow (Recommended)

1. Merge changes to `main`.
2. The `release.yml` GitHub Action creates (or updates) a **Release PR**.
3. Merge the Release PR → both SDKs are published automatically.

**Required GitHub Secrets:**
| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | Publish to npm |
| `PYPI_TOKEN` | Publish to PyPI |
| `CLOUDFLARE_API_TOKEN` | Deploy Worker |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy Worker / Worker Logs API |
| `GH_TOKEN` | Log-to-Issues cron (optional) |

---

## Manual Release

### JavaScript SDK

```bash
# Ensure you have an NPM token
npm login  # or set NODE_AUTH_TOKEN env var

# Build and publish
cd packages/js-sdk
npm run build
npm publish --access public
```

### Python SDK

```bash
cd packages/python-sdk
pip install build twine

python -m build
python -m twine upload dist/*
# Enter your PyPI token when prompted, or set TWINE_PASSWORD/__token__
```

---

## Adding a Changeset

When adding new tools or changing the SDK API:

```bash
npm run changeset
# Select packages and bump type (major/minor/patch)
# Write a description of the change
```

---

## Version Sync

The `release.yml` workflow automatically syncs `packages/python-sdk/pyproject.toml`
version to match the JS SDK version after Changesets bumps it.
Do not manually edit versions in `pyproject.toml`.

---

## Deployment (Worker)

```bash
# Preview (staging)
npm run deploy:staging

# Production (manual)
npx wrangler deploy --config wrangler.toml --env production

# Via GitHub Actions (on push to main or manual dispatch)
# Settings → Secrets → Add CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
```

**Domain cutover** (v1 → v2):
1. Deploy v2 Worker to production
2. In Cloudflare Dashboard → Workers → `translation-helps-mcp` → Custom Domains
3. Add `tc-helps.mcp.servant.bible` (or update DNS CNAME to point to the Workers route)
4. Remove the same domain from the v1 Pages project under Pages → Custom Domains
