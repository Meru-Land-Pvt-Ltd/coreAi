#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "Missing .env.production. Create it from .env.production.example first."
  exit 1
fi

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend npx prisma db push
docker compose --env-file .env.production -f docker-compose.prod.yml up -d

echo "Deployment finished. Check: docker ps"
echo "Local backend health: curl http://127.0.0.1:8787/health"
echo "Public backend health after Nginx/SSL: curl https://globalbrandgrowth.com/api/health"
