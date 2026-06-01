#!/usr/bin/env bash
# Deploy to the preview environment (staging).
# Requires: wrangler auth (CLOUDFLARE_API_TOKEN env var or `wrangler login`)

set -euo pipefail

echo "Building web..."
cd web && npm install && npm run build && cd ..

echo "Deploying to preview..."
npx wrangler deploy --config wrangler.toml --env preview

echo "✓ Staging deployment complete."
echo "  URL: https://translation-helps-mcp-preview.<account>.workers.dev"
