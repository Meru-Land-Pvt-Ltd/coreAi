#!/usr/bin/env bash
set -euo pipefail

cd ~/coreAi

echo "Pulling latest code..."
git fetch origin
git checkout Devansh
git pull --ff-only origin Devansh

export COMPOSE_PARALLEL_LIMIT=1

COMPOSE=(
  docker compose
  --env-file .env.production
  -f docker-compose.prod.yml
)

echo "Validating Docker Compose configuration..."
"${COMPOSE[@]}" config >/dev/null

echo "Building all services..."
"${COMPOSE[@]}" --progress plain build

echo "Starting complete production stack..."
"${COMPOSE[@]}" up -d --remove-orphans

echo "Current service status:"
"${COMPOSE[@]}" ps

echo "Recent logs:"
"${COMPOSE[@]}" logs --tail=100
