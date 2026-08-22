#!/usr/bin/env bash
set -euo pipefail

cd ~/coreAi

git fetch origin
git pull --ff-only origin Devansh

export COMPOSE_PARALLEL_LIMIT=1

COMPOSE=(
  docker compose
  --env-file .env.production
  -f docker-compose.prod.yml
)

"${COMPOSE[@]}" config >/dev/null
"${COMPOSE[@]}" --progress plain build backend
"${COMPOSE[@]}" up -d --no-deps backend
"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail=100 backend
