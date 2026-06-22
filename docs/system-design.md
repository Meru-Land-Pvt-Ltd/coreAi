# AI Agent Marketplace - System Design (MVP -> Scale)

## 1) Product Overview

CoreAI is a multi-tenant SaaS marketplace where businesses install ready-made AI agents or hire AI Architects to build custom agents and workflows. The platform includes a native workflow engine (no n8n/Zapier/Make/Pabbly), connector framework, multi-LLM gateway, execution tracking, human approvals, payments, and admin moderation.

## 2) Core Roles and Permissions

### Admin
- Full platform governance: user management, architect approvals, listing approvals, disputes, commissions, connectors, LLM providers.
- Can suspend unsafe users/agents and audit workflow executions.

### Business
- Creates workspace, connects apps/credentials, installs agents, posts projects, hires architects, approves risky actions.

### AI Architect
- Builds/publishes agent templates, applies to projects, submits proposals and solutions, earns from project and marketplace sales.

## 3) High-Level Architecture

```text
[Next.js Frontend]
   | REST + WebSocket
[Hono API Gateway]
   |-- Auth / RBAC
   |-- Marketplace / Projects / Billing
   |-- Workflow Control Plane
   |-- LLM Gateway
   |-- Connector Service
   |-- Approval Service
   |
   +--> [PostgreSQL + Prisma]  (control data, workflows, logs, billing)
   +--> [Redis]                (queue, cache, distributed locks)
   +--> [BullMQ Workers]       (workflow execution runtime)
   +--> [Object Storage S3/R2] (artifacts, prompt files, exports)
```

## 4) User Workflows

### Business Workflow
1. Signup -> create workspace.
2. Add members and role permissions.
3. Connect apps (OAuth/API keys) and LLM keys.
4. Install marketplace agents or post custom project.
5. Test in sandbox mode.
6. Enable production run policy (human approval on risky nodes).
7. Monitor runs, costs, logs, failures.

### AI Architect Workflow
1. Register architect profile + portfolio.
2. Submit KYC/profile for admin approval.
3. Build agent templates in workflow builder.
4. Publish listing (admin moderation).
5. Apply to business projects with proposals.
6. Deliver workflow version, business tests/accepts.
7. Receive payouts after milestones.

### Admin Workflow
1. Review architect and listing queues.
2. Resolve disputes and refunds.
3. View revenue/cost dashboards.
4. Monitor unsafe execution patterns and suspend entities.

## 5) Marketplace + Hiring + Installation Flows

```text
Architect -> submit listing -> Admin moderation -> Published
Business -> install listing -> configure credentials -> test run -> activate
```

```text
Business posts project -> architects propose -> business shortlists -> contract
-> architect builds -> business UAT -> accept -> release payment
```

## 6) Workflow Builder Design

- React Flow canvas with node palette (trigger/action/logic/AI/approval).
- Right panel for node config schema (Zod-driven).
- Versioned workflow JSON saved in Postgres JSONB.
- Validation pipeline:
  - graph integrity (entry + reachable nodes)
  - connector/credential resolution
  - runtime policy checks (approval-required actions)

## 7) Custom Workflow Engine Design

### Workflow JSON Contract
- Trigger: manual/webhook/schedule/event.
- Nodes: typed config + input mapping + output schema.
- Edges: source/target + conditional routing.
- Settings: retries/timeouts/idempotency keys.

### Execution Lifecycle
1. Trigger received.
2. Runtime creates run record (QUEUED).
3. BullMQ worker locks and starts run (RUNNING).
4. Node-by-node execution with checkpoint logs.
5. If risky action -> WAITING_APPROVAL.
6. Resume after approval/rejection.
7. Finalize SUCCESS/FAILED/CANCELLED.

## 8) Trigger System

- Manual trigger via API.
- Webhook trigger with signed secrets + replay protection.
- Scheduled trigger using BullMQ repeat jobs.
- Event trigger from connector webhooks.

## 9) Node System

Node categories:
- Trigger nodes
- LLM nodes
- Connector action nodes
- Condition nodes
- Transform/code nodes
- Delay nodes
- Human approval nodes

Each node implements:
- `validate(config)`
- `execute(context)`
- `estimateCost(input)`

## 10) Connector System

- Connector manifest defines auth type, actions, triggers.
- Workspace-scoped connector installs store encrypted secrets.
- Worker fetches decrypted secret only in execution sandbox.

MVP connectors: webhook, HTTP, Gmail, Google Sheets, Slack.

## 11) LLM Gateway

- Provider adapter pattern with common `chat()` interface.
- Unified model metadata: context window, token prices, rate limits.
- Workspace policy decides provider priority/fallback.
- Tracks usage per run and writes token/cost logs.

## 12) Human Approval System

- Approval node generates pending approval record.
- Notification (in-app + email + Slack optional).
- Business user approves/rejects with audit reason.
- Timeout policy can auto-reject.

## 13) Payments + Commission

- Stripe and Razorpay supported in parallel.
- Marketplace purchase split:
  - gross amount
  - platform commission
  - architect net
- Milestone project payouts with escrow-like release policy in MVP logic.

## 14) Security Architecture

- JWT auth + workspace RBAC + route guards.
- Secret storage encrypted at rest using envelope encryption.
- Audit logs for all privileged actions.
- Per-workspace data isolation and query scoping.

### Prevent Architect Access to Business Secrets
- Architect never receives raw connector/API keys.
- Keys stored encrypted and only decrypted in worker runtime for specific workspace execution.
- Redacted configs shown in builder UI.
- Backend enforces workspace ownership check for all secret reads.

## 15) API Structure (Representative)

- `/api/auth/*`
- `/api/users/*`
- `/api/admin/*`
- `/api/marketplace/*`
- `/api/projects/*`
- `/api/workflows/*`
- `/api/connectors/*`
- `/api/llm/*`
- `/api/payments/*`
- `/api/approvals/*`
- `/api/logs/*`

## 16) Backend Module Structure

```text
src/
  common/
    lib/ (env, prisma, redis, queue)
    middleware/ (auth, rbac, audit)
  modules/
    auth, users, admin, marketplace, projects,
    workflows (engine), connectors, llm, approvals, payments, logs
```

## 17) Frontend Structure

```text
src/app/
  (auth)/admin/login
  (auth)/business/login
  (auth)/architect/login
  (dashboard)/admin
  (dashboard)/business
  (dashboard)/architect/workflow-builder
  marketplace
  projects
```

## 18) Deployment (Hostinger KVM 4)

```text
Internet -> Cloudflare -> Nginx/Caddy (TLS)
  -> Frontend container (Next.js)
  -> Backend container (Hono)
  -> PostgreSQL container / managed DB
  -> Redis container
  -> Worker container (same backend image, worker command)
```

- Ubuntu 24.04, Docker Engine + Compose plugin.
- Daily DB backups + object storage backups.
- Sentry for error monitoring, Uptime Kuma for service health.

## 19) MVP Phases

1. Foundation (auth, RBAC, workspace, DB, infra).
2. Marketplace + Architect onboarding.
3. Workflow builder + runtime + logs.
4. Connectors (webhook/http/slack/gmail/sheets).
5. Billing + commissions + admin moderation.

## 20) Timeline (small team estimate)

- Week 1-2: foundation + auth + schema.
- Week 3-4: marketplace + projects.
- Week 5-7: workflow builder + engine + approvals.
- Week 8-9: connectors + llm gateway + usage tracking.
- Week 10: billing, hardening, QA, deploy.

## 21) Scale Plan

- Split API and worker services.
- Add queue partitions by workspace tier.
- Read replicas for logs/reporting queries.
- Introduce event bus for connector triggers.
- Add per-tenant throttling and rate governance.

## 22) Risks and Challenges

- Connector API drift and OAuth complexity.
- LLM reliability/cost spikes.
- Long-running workflow retries and idempotency.
- Multi-tenant isolation mistakes if query scoping is weak.
- Payment dispute handling complexity.

## 23) Recommended MVP Feature Cut

Must-have:
- Auth + 3 roles + workspace
- Listing publish/install
- Project post + proposal flow
- Workflow builder MVP + manual/webhook triggers
- 5 connectors (webhook/http/slack/gmail/sheets)
- Human approval node
- Run logs + usage/cost dashboards
- Admin moderation + basic payouts
