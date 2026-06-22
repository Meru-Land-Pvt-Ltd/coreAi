# CoreAI Agent Marketplace

Monorepo MVP scaffold for an AI Agent Marketplace with:

- `apps/frontend`: Next.js + TypeScript + Tailwind + role-based routes
- `apps/backend`: Hono + Prisma + BullMQ + Redis + PostgreSQL
- Custom workflow engine skeleton (JSON workflow + node executor)

## Quick Start

1. Copy env files:
   - `cp apps/backend/.env.example apps/backend/.env`
   - `cp apps/frontend/.env.example apps/frontend/.env.local`
2. Start services: `docker compose up -d postgres redis`
3. Install deps: `npm install`
4. Run backend: `npm run dev:backend`
5. Run frontend: `npm run dev:frontend`

If Docker is not installed on macOS, install Docker Desktop first (see notes in `docs/system-design.md`).
