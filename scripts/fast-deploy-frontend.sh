#!/usr/bin/env bash
# Fast lane: rebuild + swap ONLY the frontend container.
# Use for UI-only changes. Backend/workers/db untouched -> no API downtime at all.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build frontend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-deps --force-recreate frontend
sleep 8
curl -fsS -o /dev/null -w 'frontend: HTTP %{http_code}\n' http://127.0.0.1:3000/
echo "Fast deploy complete."
