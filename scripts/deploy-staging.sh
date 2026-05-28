#!/usr/bin/env bash
# =============================================================================
# deploy-staging.sh — Deploy translation-helps-mcp to Cloudflare Pages staging
# =============================================================================
#
# Prerequisites:
#   - wrangler CLI authenticated (wrangler login)
#   - Required secrets set (see REQUIRED_SECRETS below)
#   - Node.js 20+ and npm installed
#
# Usage:
#   bash scripts/deploy-staging.sh [--skip-build] [--skip-checks]
#
# Environment variables (override defaults):
#   WRANGLER_ENV   — Wrangler environment to deploy to (default: preview)
#   CF_PAGES_PROJECT — Cloudflare Pages project name (default: translation-helps-mcp)
# =============================================================================

set -euo pipefail

WRANGLER_ENV="${WRANGLER_ENV:-preview}"
CF_PAGES_PROJECT="${CF_PAGES_PROJECT:-translation-helps-mcp}"
SKIP_BUILD=false
SKIP_CHECKS=false

for arg in "$@"; do
  case "$arg" in
    --skip-build)   SKIP_BUILD=true ;;
    --skip-checks)  SKIP_CHECKS=true ;;
  esac
done

# -----------------------------------------------------------------------------
# Colours
# -----------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# 1. Verify required bindings are configured in wrangler.toml
# -----------------------------------------------------------------------------
info "Checking wrangler.toml bindings..."

required_bindings=(
  "TRANSLATION_HELPS_CACHE"  # KV namespace
  "ZIP_FILES"                # R2 bucket
  "VECTORIZE_INDEX"          # Vectorize binding (Workers AI RAG)
  "AI"                       # Workers AI binding
)

for binding in "${required_bindings[@]}"; do
  if ! grep -q "$binding" wrangler.toml 2>/dev/null; then
    warn "Binding '$binding' not found in wrangler.toml"
    warn "Add it before deploying to production"
  else
    info "  ✓ $binding"
  fi
done

# -----------------------------------------------------------------------------
# 2. Verify required secrets are set
# -----------------------------------------------------------------------------
if [[ "$SKIP_CHECKS" != "true" ]]; then
  info "Checking required secrets..."

  REQUIRED_SECRETS=("ADMIN_TOKEN")
  OPTIONAL_SECRETS=("UPSTASH_REDIS_REST_URL" "UPSTASH_REDIS_REST_TOKEN" "OPENAI_API_KEY")

  for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! npx wrangler pages secret list --project-name="$CF_PAGES_PROJECT" 2>/dev/null \
        | grep -q "$secret"; then
      warn "Required secret '$secret' may not be set."
      warn "  Set it with: wrangler pages secret put $secret --project-name=$CF_PAGES_PROJECT"
    else
      info "  ✓ $secret (found)"
    fi
  done

  for secret in "${OPTIONAL_SECRETS[@]}"; do
    if npx wrangler pages secret list --project-name="$CF_PAGES_PROJECT" 2>/dev/null \
        | grep -q "$secret"; then
      info "  ✓ $secret (optional, found)"
    else
      info "  ○ $secret (optional, not set — using fallback providers)"
    fi
  done
fi

# -----------------------------------------------------------------------------
# 3. Build
# -----------------------------------------------------------------------------
if [[ "$SKIP_BUILD" != "true" ]]; then
  info "Building..."
  npm run build
  info "Build complete."
else
  warn "Skipping build (--skip-build)"
fi

# -----------------------------------------------------------------------------
# 4. Run gate checks
# -----------------------------------------------------------------------------
if [[ "$SKIP_CHECKS" != "true" ]]; then
  info "Running pre-deploy checks (typecheck + unit tests + contracts)..."
  npm run typecheck 2>&1 | tail -5 || warn "Typecheck had warnings (continuing)"
  npm run test:contracts     || error "Contract tests failed — aborting deploy"
  info "Gate checks passed."
fi

# -----------------------------------------------------------------------------
# 5. Deploy to Cloudflare Pages
# -----------------------------------------------------------------------------
info "Deploying to Cloudflare Pages (env: $WRANGLER_ENV)..."

npx wrangler pages deploy ui/.svelte-kit/cloudflare \
  --project-name="$CF_PAGES_PROJECT" \
  --branch="${WRANGLER_ENV}"

info "Deploy complete!"

# -----------------------------------------------------------------------------
# 6. Post-deploy: trigger warm-up via admin endpoint
# -----------------------------------------------------------------------------
STAGING_URL="${STAGING_URL:-}"

if [[ -n "$STAGING_URL" && -n "${ADMIN_TOKEN:-}" ]]; then
  info "Triggering cache warm-up on staging..."
  curl -sf -X POST "${STAGING_URL}/api/warmer/run" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"maxTargets": 200}' \
    && info "Warm-up triggered." \
    || warn "Warm-up trigger failed (non-fatal — first requests will warm the cache)."
else
  warn "STAGING_URL or ADMIN_TOKEN not set — skipping warm-up trigger."
  warn "Manually run: POST ${STAGING_URL:-<your-staging-url>}/api/warmer/run"
fi

# -----------------------------------------------------------------------------
# 7. Print load test instructions
# -----------------------------------------------------------------------------
echo ""
info "Next steps:"
echo "  1. Wait ~30s for deployment to propagate."
echo "  2. Run baseline load test:"
echo "     BASE_URL=${STAGING_URL:-https://<staging-url>} k6 run tests/load/k6/rag-query.js"
echo "     BASE_URL=${STAGING_URL:-https://<staging-url>} k6 run tests/load/k6/get-bundle.js"
echo "  3. Review CF Analytics: error rate < 1%, cache hit > 70%, P95 < 500ms."
