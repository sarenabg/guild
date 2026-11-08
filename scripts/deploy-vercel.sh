#!/usr/bin/env bash
# Put the Guild website on Vercel, with every /api call forwarded to the
# Google Cloud Run runner (so visitors see one address).
#
# Before running: `vercel login` (you sign in; Claude never does).
# Usage:
#   GUILD_BACKEND_URL=https://guild-xxxx.a.run.app ./scripts/deploy-vercel.sh
set -euo pipefail
: "${GUILD_BACKEND_URL:?Set GUILD_BACKEND_URL to the Cloud Run URL from deploy-gcp.sh}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/web"

[ -d .vercel ] || vercel link --yes --project "${GUILD_VERCEL_PROJECT:-guild}"
vercel env rm GUILD_BACKEND_URL production --yes >/dev/null 2>&1 || true
printf '%s' "$GUILD_BACKEND_URL" | vercel env add GUILD_BACKEND_URL production >/dev/null
vercel deploy --prod --yes
