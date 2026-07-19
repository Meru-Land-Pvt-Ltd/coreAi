#!/usr/bin/env bash
set -euo pipefail

# Wrapper for production/VPS use. It runs the TypeScript script inside the
# backend service with the same production environment and database network.
# It NEVER purchases a number.

if [ "$#" -eq 0 ]; then
  cat <<'USAGE'
Usage:
  ./scripts/assign-existing-twilio-number.sh \
    --email=buyer@example.com \
    --phone=+12135550123

Add --apply only after reviewing the dry-run output.
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
    if [ -f scripts/assign-existing-twilio-number.ts ]; then
      exec npx tsx scripts/assign-existing-twilio-number.ts "$@"
    fi
    exec npx tsx apps/backend/scripts/assign-existing-twilio-number.ts "$@"
  ' -- "$@"
