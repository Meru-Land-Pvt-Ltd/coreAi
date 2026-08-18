set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

INFRA_SERVICES=(postgres redis)
# Telegram webhooks only enqueue updates. The telegram-worker is what performs
# owner verification and executes the installed agent workflow (including AI
# Brain nodes), so it must be rebuilt and recreated with every app deployment.
APP_SERVICES=(backend email-worker telegram-worker frontend)

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

step() {
  printf '\n\033[1;33m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31mFAILED: %s\033[0m\n' "$1" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found in $REPO_ROOT"
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found in $REPO_ROOT"

if [ "${1:-}" != "--no-pull" ]; then
  step "Pulling latest code"
  git pull
fi

step "Checking compose config resolves"
BLANKED="$(compose config 2>/dev/null | grep -E '^\s+[A-Z_]+: ""$' || true)"
if [ -n "$BLANKED" ]; then
  printf '\033[1;31mWARNING — these resolve to an empty string and will override apps/backend/.env.production:\033[0m\n'
  printf '%s\n' "$BLANKED"
  printf 'Add them to %s, or give them a default in %s.\n\n' "$ENV_FILE" "$COMPOSE_FILE"
fi

step "Starting infrastructure (${INFRA_SERVICES[*]})"
compose up -d "${INFRA_SERVICES[@]}"

step "Waiting for infrastructure to report healthy"
for container in coreai-postgres coreai-redis; do
  for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo missing)"
    [ "$status" = healthy ] && break
    [ "$status" = missing ] && fail "$container is not running"
    sleep 2
  done
  [ "$status" = healthy ] || fail "$container never became healthy (last status: $status)"
  echo "  $container: healthy"
done

step "Building images (${APP_SERVICES[*]})"
compose build "${APP_SERVICES[@]}"

step "Applying database migrations"
compose run --rm --no-deps backend npx prisma migrate deploy

step "Recreating app containers (${APP_SERVICES[*]})"
compose up -d --force-recreate --no-deps "${APP_SERVICES[@]}"

step "Verifying"
compose ps

echo
echo -n "  redis ping:      "
docker exec coreai-redis redis-cli ping || fail "redis is not responding"

echo -n "  backend REDIS_URL: "
backend_redis="$(docker exec coreai-backend printenv REDIS_URL 2>/dev/null || true)"
if [ -z "$backend_redis" ]; then
  fail "REDIS_URL is EMPTY inside coreai-backend — Redis is disabled silently"
fi
echo "$backend_redis"

echo -n "  telegram-worker:  "
telegram_worker_status="$(docker inspect -f '{{.State.Status}}' coreai-telegram-worker 2>/dev/null || echo missing)"
if [ "$telegram_worker_status" != running ]; then
  fail "telegram-worker is not running (status: $telegram_worker_status)"
fi
telegram_worker_redis="$(docker exec coreai-telegram-worker printenv REDIS_URL 2>/dev/null || true)"
if [ -z "$telegram_worker_redis" ]; then
  fail "REDIS_URL is EMPTY inside coreai-telegram-worker"
fi
echo "running ($telegram_worker_redis)"

echo -n "  backend health:  "
# The container needs a few seconds to boot — a check fired instantly after
# `up -d` fails on a perfectly healthy deploy. Retry for up to 60s.
backend_ok=""
for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:8787/health 2>/dev/null; then
    backend_ok=1
    break
  fi
  sleep 2
done
[ -n "$backend_ok" ] || fail "backend health check failed (no response within 60s)"
echo

echo -n "  frontend:        "
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/ || fail "frontend not responding"

echo
echo "  email-worker (last 20 lines):"
compose logs --tail=20 email-worker | sed 's/^/    /'

echo
echo "  telegram-worker (last 20 lines):"
compose logs --tail=20 telegram-worker | sed 's/^/    /'

printf '\n\033[1;32mDeploy complete.\033[0m\n'
