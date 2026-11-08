#!/usr/bin/env bash
# Deploy the Guild runner (and a full copy of the site) to Google Cloud Run.
#
# Before running:
#   1. gcloud auth login                       (you sign in; Claude never does)
#   2. gcloud config set project <project-id>  (a project with billing turned on)
#
# Usage (all optional except GUILD_CONTRACT/GUILD_OPERATOR_ID for the Live version):
#   GUILD_CONTRACT=guild.you.near GUILD_OPERATOR_ID=you.near \
#   GUILD_OPERATOR_KEY_FILE=~/.near-credentials/mainnet/you.near/ed25519_xxx.json \
#   ./scripts/deploy-gcp.sh
#
# It keeps one instance always on (the runner must keep watching the contract),
# which costs roughly US$1.50 a day. Data (agent instructions, work, logs) is
# kept in a Cloud Storage bucket. Secrets go to Secret Manager and are never printed.
set -euo pipefail

REGION="${GUILD_REGION:-us-central1}"
SERVICE="${GUILD_SERVICE:-guild}"
NETWORK="${NEAR_NETWORK:-mainnet}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT" ] || { echo "Run: gcloud config set project <project-id>"; exit 1; }
BUCKET="${GUILD_BUCKET:-$PROJECT-guild-data}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Project $PROJECT, region $REGION, service $SERVICE, network $NETWORK"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com --quiet

echo "==> Data bucket gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access

# Store a secret from stdin without echoing it.
put_secret() {
  local name="$1"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets versions add "$name" --data-file=- >/dev/null
  else
    gcloud secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
  fi
  echo "    saved secret $name"
}

SECRETS=()
if [ -n "${NEARAI_API_KEY:-}" ]; then
  printf '%s' "$NEARAI_API_KEY" | put_secret guild-nearai-key
elif ! gcloud secrets describe guild-nearai-key >/dev/null 2>&1; then
  read -r -s -p "NEAR AI API key (typed, not shown; Enter to skip): " K; echo
  [ -n "$K" ] && printf '%s' "$K" | put_secret guild-nearai-key
fi
gcloud secrets describe guild-nearai-key >/dev/null 2>&1 && SECRETS+=("NEARAI_API_KEY=guild-nearai-key:latest")

if [ -n "${GUILD_OPERATOR_KEY_FILE:-}" ]; then
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.stdout.write(d.get("private_key") or d["secret_key"])' \
    "${GUILD_OPERATOR_KEY_FILE/#\~/$HOME}" | put_secret guild-operator-key
fi
gcloud secrets describe guild-operator-key >/dev/null 2>&1 && SECRETS+=("GUILD_OPERATOR_KEY=guild-operator-key:latest")

# Let Cloud Run read the secrets and the bucket.
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for s in guild-nearai-key guild-operator-key; do
  gcloud secrets describe "$s" >/dev/null 2>&1 && gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor --quiet >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin --quiet >/dev/null

ENV="NEAR_NETWORK=$NETWORK,GUILD_DATA_DIR=/data"
[ -n "${GUILD_CONTRACT:-}" ] && ENV="$ENV,GUILD_CONTRACT=$GUILD_CONTRACT"
[ -n "${GUILD_OPERATOR_ID:-}" ] && ENV="$ENV,GUILD_OPERATOR_ID=$GUILD_OPERATOR_ID"
[ -n "${NEARAI_MODEL:-}" ] && ENV="$ENV,NEARAI_MODEL=$NEARAI_MODEL"

echo "==> Building and deploying (takes a few minutes)"
gcloud run deploy "$SERVICE" --source "$ROOT/web" --region "$REGION" \
  --allow-unauthenticated --port 8080 --memory 1Gi --cpu 1 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling --timeout 300 \
  --execution-environment gen2 \
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "$ENV" \
  ${SECRETS:+--set-secrets "$(IFS=,; echo "${SECRETS[*]}")"}

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
cat <<DONE

Guild is running at: $URL
  Demo: $URL/
  Live: $URL/live

To put the website on Vercel with this as its backend:
  GUILD_BACKEND_URL=$URL ./scripts/deploy-vercel.sh
DONE
