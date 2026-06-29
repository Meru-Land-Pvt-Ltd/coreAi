#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "Missing .env.production. Create it from .env.production.example first."
  exit 1
fi

docker compose --env-file .env.production -f docker-compose.prod.yml build

docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis

docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy --schema prisma/schema.prisma

docker compose --env-file .env.production -f docker-compose.prod.yml up -d

echo "Deployment finished."
echo "Check containers: docker ps"
echo "Local frontend: curl http://127.0.0.1:3000"
echo "Local backend: curl http://127.0.0.1:8787/health"
echo "Public frontend: curl https://triven.ai"
echo "Public backend: curl https://triven.ai/api/health"