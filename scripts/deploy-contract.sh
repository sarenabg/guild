#!/usr/bin/env bash
# Deploy the Guild contract to NEAR testnet or mainnet.
#
# Needs: near-cli-rs (`near`), cargo-near, and a funded account whose key is
# already in the near CLI keychain. On mainnet this spends real NEAR (about
# 3.5 NEAR, mostly storage for the contract code): run it yourself.
#
# Usage:
#   GUILD_ACCOUNT=you.testnet ./scripts/deploy-contract.sh
#   GUILD_NETWORK=mainnet GUILD_ACCOUNT=you.near ./scripts/deploy-contract.sh
#
# Optional settings:
#   GUILD_NETWORK      testnet (default) or mainnet
#   GUILD_CONTRACT     contract account   (default: guild.$GUILD_ACCOUNT)
#   GUILD_REVIEWER     AI safety reviewer (default: $GUILD_ACCOUNT)
#   GUILD_RUNNER       agent runner       (default: $GUILD_ACCOUNT)
#   GUILD_COUNCIL      dispute council    (default: $GUILD_ACCOUNT)
#   GUILD_RELEASE_SECS auto-release wait  (default: 120 s on testnet, 3600 s on mainnet)
#   GUILD_FUND         NEAR for the new contract account (default: 3.5)
set -euo pipefail

: "${GUILD_ACCOUNT:?Set GUILD_ACCOUNT to your funded testnet account, e.g. GUILD_ACCOUNT=you.testnet}"
NETWORK="${GUILD_NETWORK:-testnet}"
case "$NETWORK" in testnet|mainnet) ;; *) echo "GUILD_NETWORK must be testnet or mainnet"; exit 1 ;; esac
CONTRACT="${GUILD_CONTRACT:-guild.$GUILD_ACCOUNT}"
REVIEWER="${GUILD_REVIEWER:-$GUILD_ACCOUNT}"
RUNNER="${GUILD_RUNNER:-$GUILD_ACCOUNT}"
COUNCIL="${GUILD_COUNCIL:-$GUILD_ACCOUNT}"
if [ "$NETWORK" = mainnet ]; then DEFAULT_RELEASE=3600; else DEFAULT_RELEASE=120; fi
RELEASE_SECS="${GUILD_RELEASE_SECS:-$DEFAULT_RELEASE}"
FUND="${GUILD_FUND:-3.5}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/contracts/swarm"
WASM="$CRATE/target/near/hive_swarm.wasm"

command -v near >/dev/null || { echo "near CLI not found (install near-cli-rs)"; exit 1; }
command -v cargo-near >/dev/null || { echo "cargo-near not found"; exit 1; }
if [ "$NETWORK" = testnet ]; then
  case "$GUILD_ACCOUNT" in *.testnet) ;; *) echo "On testnet, GUILD_ACCOUNT must end in .testnet"; exit 1 ;; esac
else
  case "$GUILD_ACCOUNT" in *.testnet) echo "On mainnet, use a mainnet account (e.g. you.near)"; exit 1 ;; esac
  echo "!! MAINNET: this spends real NEAR from $GUILD_ACCOUNT (about $FUND NEAR)."
  read -r -p "Type 'yes' to continue: " OK; [ "$OK" = yes ] || exit 1
fi
case "$RELEASE_SECS" in ''|*[!0-9]*) echo "GUILD_RELEASE_SECS must be a whole number"; exit 1 ;; esac

RELEASE_NS="${RELEASE_SECS}000000000"
INIT_ARGS=$(printf '{"reviewer":"%s","runner":"%s","council":"%s","release_after_ns":%s}' \
  "$REVIEWER" "$RUNNER" "$COUNCIL" "$RELEASE_NS")

echo "==> Contract:  $CONTRACT"
echo "    Reviewer:  $REVIEWER"
echo "    Runner:    $RUNNER"
echo "    Council:   $COUNCIL"
echo "    Release:   ${RELEASE_SECS}s after a passed check"
echo

echo "==> 1/3 Building the wasm"
(cd "$CRATE" && cargo near build non-reproducible-wasm --skip-rust-version-check)
[ -f "$WASM" ] || { echo "Build did not produce $WASM"; exit 1; }

echo "==> 2/3 Creating $CONTRACT with $FUND NEAR from $GUILD_ACCOUNT"
if near account view-account-summary "$CONTRACT" network-config "$NETWORK" now >/dev/null 2>&1; then
  echo "    $CONTRACT already exists, skipping."
else
  near account create-account fund-myself "$CONTRACT" "$FUND NEAR" \
    autogenerate-new-keypair save-to-keychain \
    sign-as "$GUILD_ACCOUNT" \
    network-config "$NETWORK" sign-with-keychain send
fi

echo "==> 3/3 Deploying and calling new()"
near contract deploy "$CONTRACT" use-file "$WASM" \
  with-init-call new json-args "$INIT_ARGS" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config "$NETWORK" sign-with-keychain send

cat <<NEXT

Done. Guild is live at: $CONTRACT ($NETWORK)

Next steps:
  1. Check it:
       near contract call-function as-read-only $CONTRACT get_config json-args '{}' network-config $NETWORK now
  2. Give the runner a key that can only call this contract:
       GUILD_NETWORK=$NETWORK GUILD_RUNNER=$RUNNER GUILD_CONTRACT=$CONTRACT ./scripts/runner-key.sh
  3. Run the app against it (web/.env.local):
       NEAR_NETWORK=$NETWORK
       GUILD_CONTRACT=$CONTRACT
       GUILD_OPERATOR_ID=$RUNNER
       GUILD_OPERATOR_KEY_FILE=<the file runner-key.sh prints>
       NEARAI_API_KEY=<your NEAR AI key>
     then open http://localhost:3300/live
NEXT
