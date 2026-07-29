#!/usr/bin/env bash
# Deploy v2 side-by-side under /v2 without touching Pages production (v1).
# Target: unfoldingWord Cloudflare account
#   - Workers: translation-helps-api-v2 + translation-helps-mcp-v2
#   - Route:   tc-helps.mcp.servant.bible/v2*
#   - Leaves:  Pages project "translation-helps-mcp" at domain root

set -euo pipefail

# Prevent Git Bash (MSYS) from rewriting /v2 into a Windows path.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3ffd86280d3ed086be76d955829242}"
export BASE_PATH="${BASE_PATH:-/v2}"

echo "==> Building web with BASE_PATH=${BASE_PATH}"
# Windows: workerd/node can lock .svelte-kit/cloudflare and break adapter rimraf.
if command -v taskkill >/dev/null 2>&1; then
  taskkill //F //IM workerd.exe >/dev/null 2>&1 || true
fi
rm -rf web/.svelte-kit/cloudflare
cd web
npm install --no-fund --no-audit
# Pass BASE_PATH via env only (do not put /v2 on a command argv under Git Bash).
npm run build
cd ..

echo "==> Deploying API worker (translation-helps-api-v2)"
npx wrangler deploy --config wrangler.api.toml --env production

echo "==> Deploying MCP + website worker (translation-helps-mcp-v2)"
npx wrangler deploy --config wrangler.toml --env production

echo ""
echo "✓ v2 deployed beside production (Pages v1 untouched)."
echo "  Website:  https://tc-helps.mcp.servant.bible/v2/"
echo "  Chat:     https://tc-helps.mcp.servant.bible/v2/chat"
echo "  MCP:      https://tc-helps.mcp.servant.bible/v2/mcp"
echo "  workers.dev (also): https://translation-helps-mcp-v2.<account>.workers.dev/v2/"
echo ""
echo "Remember to set secrets if missing:"
echo "  npx wrangler secret put OPENAI_API_KEY --config wrangler.toml --env production"
echo "  npx wrangler secret put OPENAI_API_KEY --config wrangler.api.toml --env production"
