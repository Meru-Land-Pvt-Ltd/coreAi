#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  cat <<'USAGE'
Assign an ALREADY-PURCHASED Twilio number to the buyer who owns an InstalledAgent.

This script does not purchase a new Twilio number.

Usage:

  Dry run:
    ./apps/backend/scripts/assign-existing-twilio-number.sh \
      --agent-id=BUYER_INSTALLED_AGENT_ID \
      --phone=+12135550123

  Apply:
    ./apps/backend/scripts/assign-existing-twilio-number.sh \
      --agent-id=BUYER_INSTALLED_AGENT_ID \
      --phone=+12135550123 \
      --apply

  Using a Twilio PN SID:
    ./apps/backend/scripts/assign-existing-twilio-number.sh \
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

ENV_FILE="$REPO_ROOT/.env.production"
PROD_COMPOSE="$REPO_ROOT/docker-compose.prod.yml"
SECRET_COMPOSE="$REPO_ROOT/docker-compose.vapi-secret.yml"

for required_file in \
  "$ENV_FILE" \
  "$PROD_COMPOSE" \
  "$SECRET_COMPOSE"
do
  if [ ! -f "$required_file" ]; then
    echo "Required production file not found: $required_file" >&2
    exit 1
  fi
done

cd "$REPO_ROOT"

docker compose \
  --project-directory "$REPO_ROOT" \
  --env-file "$ENV_FILE" \
  -f "$PROD_COMPOSE" \
  -f "$SECRET_COMPOSE" \
  run --rm backend \
  sh -lc '
    set -e

    if [ -f apps/backend/scripts/assign-existing-twilio-number.ts ]; then
      SCRIPT_PATH="apps/backend/scripts/assign-existing-twilio-number.ts"
    elif [ -f scripts/assign-existing-twilio-number.ts ]; then
      SCRIPT_PATH="scripts/assign-existing-twilio-number.ts"
    else
      echo "Assignment TypeScript script was not found inside the backend container." >&2
      echo "Rebuild the backend image after adding the script." >&2
      exit 1
    fi

    exec npx --no-install tsx "$SCRIPT_PATH" "$@"
  ' assign-existing-number "$@"