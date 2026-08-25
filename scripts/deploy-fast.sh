#!/usr/bin/env bash
#
# DEPLOY ONLY WHAT CHANGED.
#
# deploy-prod.sh rebuilds and recreates all four services every time. A one-line
# backend change therefore paid for the frontend's Next.js build, and a one-line
# frontend change paid for three backend images — about eight minutes either way,
# most of it spent rebuilding things nobody touched.
#
# This works out which services the changed files actually belong to and builds
# only those. Everything else is identical to the full deploy: same compose file,
# same migrations when the schema moved, same health checks afterwards. It is a
# smaller deploy, not a looser one.
#
#   bash scripts/deploy-fast.sh                # since the last deployed commit
#   bash scripts/deploy-fast.sh backend        # force one service
#   bash scripts/deploy-fast.sh --all          # everything (same as deploy-prod)
#
# When in doubt it deploys MORE, not less: an unrecognised path rebuilds
# everything, because a stale container is far more expensive than a spare build.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
STAMP=".last-deployed-commit"

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
step() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found in $REPO_ROOT"
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found in $REPO_ROOT"

BACKEND_SERVICES=(backend email-worker telegram-worker)
ALL_SERVICES=(backend email-worker telegram-worker frontend)

step "Pulling latest code"
BEFORE="$(git rev-parse HEAD)"
git pull --quiet
AFTER="$(git rev-parse HEAD)"

# What to compare against: the commit we last deployed from, or the commit we
# were on before this pull. Both beat HEAD~1, which is wrong the moment two
# commits land between deploys.
BASE="$(cat "$STAMP" 2>/dev/null || echo "$BEFORE")"
git cat-file -e "$BASE" 2>/dev/null || BASE="$BEFORE"

SERVICES=()
MIGRATE=""

case "${1:-}" in
  --all)
    SERVICES=("${ALL_SERVICES[@]}")
    MIGRATE=1
    ;;
  backend|frontend|email-worker|telegram-worker)
    SERVICES=("$1")
    ;;
  "")
    CHANGED="$(git diff --name-only "$BASE" "$AFTER" || true)"
    if [ -z "$CHANGED" ]; then
      printf '\n\033[1;32mNothing changed since the last deploy. Nothing to do.\033[0m\n'
      exit 0
    fi
    echo "$CHANGED" | sed 's/^/  /'

    want_frontend=""
    want_backend=""
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      case "$file" in
        apps/frontend/*) want_frontend=1 ;;
        apps/backend/prisma/*) want_backend=1; MIGRATE=1 ;;
        apps/backend/*) want_backend=1 ;;
        # Shared code and anything at the root (compose, Dockerfiles, lockfiles)
        # can reach every service, so every service is rebuilt.
        packages/*|docker-compose*|Dockerfile*|package*.json|turbo.json)
          want_frontend=1; want_backend=1 ;;
        docs/*|scripts/*|*.md) ;;
        *) want_frontend=1; want_backend=1 ;;
      esac
    done <<< "$CHANGED"

    [ -n "$want_backend" ] && SERVICES+=("${BACKEND_SERVICES[@]}")
    [ -n "$want_frontend" ] && SERVICES+=(frontend)
    ;;
  *)
    fail "Unknown argument: $1"
    ;;
esac

if [ ${#SERVICES[@]} -eq 0 ]; then
  printf '\n\033[1;32mOnly docs or scripts changed. Nothing to deploy.\033[0m\n'
  git rev-parse HEAD > "$STAMP"
  exit 0
fi

step "Deploying: ${SERVICES[*]}"

step "Starting infrastructure"
compose up -d postgres redis

step "Building (${SERVICES[*]})"
compose build "${SERVICES[@]}"

if [ -n "$MIGRATE" ]; then
  step "Applying database migrations"
  compose run --rm --no-deps backend npx prisma migrate deploy
else
  echo "  (no schema change — skipping migrations)"
fi

step "Recreating (${SERVICES[*]})"
compose up -d --force-recreate --no-deps "${SERVICES[@]}"

step "Verifying"
for service in "${SERVICES[@]}"; do
  case "$service" in
    backend)
      echo -n "  backend health:  "
      ok=""
      for _ in $(seq 1 30); do
        curl -fsS -m 2 http://127.0.0.1:8787/health >/dev/null 2>&1 && { ok=1; break; }
        sleep 2
      done
      [ -n "$ok" ] || fail "backend health check failed (no response within 60s)"
      echo "OK"
      ;;
    frontend)
      echo -n "  frontend:        "
      ok=""
      for _ in $(seq 1 30); do
        curl -fsS -o /dev/null -m 2 http://127.0.0.1:3000/ >/dev/null 2>&1 && { ok=1; break; }
        sleep 2
      done
      [ -n "$ok" ] || fail "frontend health check failed (no response within 60s)"
      echo "OK"
      ;;
    *)
      status="$(docker inspect -f '{{.State.Status}}' "coreai-$service" 2>/dev/null || echo missing)"
      [ "$status" = running ] || fail "$service is not running (status: $status)"
      echo "  $service: running"
      ;;
  esac
done

# Only stamped after everything above passed, so a failed deploy is retried
# against the same base rather than quietly narrowing the next one.
git rev-parse HEAD > "$STAMP"

printf '\n\033[1;32mDeploy complete (%s).\033[0m\n' "${SERVICES[*]}"
