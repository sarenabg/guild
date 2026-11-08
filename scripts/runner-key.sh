#!/usr/bin/env bash
# Give the Guild runner/reviewer account a key that can ONLY call the Guild
# contract (no transfers, no other contracts), with a small gas allowance.
# The key is saved to ~/.near-credentials; this script never prints it.
#
# Usage:
#   GUILD_NETWORK=testnet GUILD_RUNNER=you.testnet GUILD_CONTRACT=guild.you.testnet ./scripts/runner-key.sh
set -euo pipefail
: "${GUILD_RUNNER:?Set GUILD_RUNNER (the runner/reviewer account)}"
: "${GUILD_CONTRACT:?Set GUILD_CONTRACT (the Guild contract account)}"
NETWORK="${GUILD_NETWORK:-testnet}"
ALLOWANCE="${GUILD_ALLOWANCE:-1 NEAR}"
METHODS="submit_review,assign_crew,charge_fuel,deliver,check_delivery,release,expire_job,runner_withdraw"

echo "==> Adding a function-call key to $GUILD_RUNNER (only $CONTRACT: $METHODS; gas allowance $ALLOWANCE)"
near account add-key "$GUILD_RUNNER" grant-function-call-access \
  --allowance "$ALLOWANCE" --contract-account-id "$GUILD_CONTRACT" --function-names "$METHODS" \
  autogenerate-new-keypair save-to-legacy-keychain \
  network-config "$NETWORK" sign-with-keychain send

DIR="$HOME/.near-credentials/$NETWORK/$GUILD_RUNNER"
FILE=$(ls -t "$DIR"/*.json 2>/dev/null | head -1 || true)
[ -n "$FILE" ] || FILE="$HOME/.near-credentials/$NETWORK/$GUILD_RUNNER.json"
echo
echo "Saved. Point the app at the key file (it is never printed):"
echo "  GUILD_OPERATOR_KEY_FILE=$FILE"
