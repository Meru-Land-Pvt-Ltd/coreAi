#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  cat <<'USAGE'
Assign an ALREADY-PURCHASED Twilio number to the buyer who owns an InstalledAgent.

This script does not purchase a new Twilio number.

Usage:

  Dry run:
    ./scripts/assign-existing-twilio-number.sh \
      --agent-id=BUYER_INSTALLED_AGENT_ID \
      --phone=+12135550123

  Apply:
    ./scripts/assign-existing-twilio-number.sh \
      --agent-id=BUYER_INSTALLED_AGENT_ID \
      --phone=+12135550123 \
      --apply

  Using a Twilio PN SID:
    ./scripts/assign-existing-twilio-number.sh \
      --agent-id=BUYER_INSTALLED_AGENT_ID \
      --twilio-sid=PNXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
      --apply

Optional:

  --forward-to=+916396039675
  --backend-url=https://triven.ai/api
  --skip-twilio-webhook-update

Important:

  --agent-id must be the buyer-specific InstalledAgent ID.
  Do not pass the marketplace listingId.
USAGE
  exit 1
fi

cd "$(dirname "$0")/.."

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.vapi-secret.yml \
  run --rm backend \
  sh -lc '
    set -e

    if [ -f apps/backend/scripts/assign-existing-twilio-number.ts ]; then
      SCRIPT_PATH="apps/backend/scripts/assign-existing-twilio-number.ts"
    elif [ -f scripts/assign-existing-twilio-number.ts ]; then
      SCRIPT_PATH="scripts/assign-existing-twilio-number.ts"
    else
      echo "Assignment script was not found inside the backend container." >&2
      echo "Rebuild the backend image after adding the TypeScript script." >&2
      exit 1
    fi

    exec npx --no-install tsx "$SCRIPT_PATH" "$@"
  ' assign-existing-number "$@"