# CoreAI / CORE Project Context

We are building CORE / CoreAI, an AI agent marketplace.

## Current MVP Goal

The current priority is FIRST REVENUE. Build the complete buyer revenue loop first.

The first paid agent is:

AI Receptionist / Missed Call Text-Back for service businesses, starting with dental practices.

This first agent must use:

* Twilio for telephony, business phone numbers, missed-call detection, call forwarding, SMS
* Vapi AI for AI voice conversations with patients/customers
* Google Calendar for booking appointments

## Critical UI Rule

Do not change the visual UI unless explicitly asked.

Keep:

* existing layout
* spacing
* colors
* animations
* Tailwind classes
* page structure
* component structure where possible

Only add functionality, type fixes, backend routes, integrations, test IDs, and wiring.

## Playwright Rule

Every meaningful frontend element should have stable `data-testid` attributes.

Do not remove existing `data-testid` attributes.
Do not rename existing `data-testid` attributes unless absolutely necessary.
When adding new ones, use readable stable IDs.

## Current Stack in This Repo

Frontend:

* Next.js
* TypeScript
* Tailwind CSS
* App Router

Backend:

* Node.js
* Hono
* TypeScript
* Prisma
* PostgreSQL
* Redis

Do not migrate the whole stack unless explicitly asked.

## Important Folder Structure

Architect frontend files are under:

* `apps/frontend/src/components/architect/features`
* `apps/frontend/src/components/architect/ui`

Do not create or import from:

* `apps/frontend/src/features/architect`

## Next Typed Routes Rule

Next typed routes are enabled.

For `Link`, `redirect`, `router.push`, `router.replace`, and props typed as `Route`, route strings often need to be cast:

```ts
import type { Route } from "next";

const HOME_ROUTE = "/" as Route;
const AGENTS_ROUTE = "/architect/agents" as Route;

router.push(`/architect/workflows/${id}/builder` as Route);
redirect("/architect/agents" as Route);
```

Do not disable typed routes just to fix errors.

## Multi-Business Twilio Rule

A single Twilio number for all businesses is not acceptable.

Each business / installed agent should have its own Twilio phone number or mapped phone identity.

Incoming Twilio events must resolve the business by Twilio `To` / `Called` number:

Twilio To number
→ BusinessPhoneNumber
→ Business
→ InstalledAgent
→ Workflow
→ BusinessProfile
→ BusinessKnowledgeBase

## Business Context Rule

Agent replies must not be hardcoded for dentists only.

Every reply must be based on per-business context:

* business name
* business type
* services
* FAQs
* business hours
* booking URL
* team phone
* tone
* escalation rules
* knowledge base
* previous conversation history

The same agent should work for:

* dentists
* AC installation agencies
* salons
* law firms
* gyms
* other service businesses

## Customer Onboarding Rule

Normal businesses should not need to enter Twilio API keys.

Default product flow:

1. Business signs up.
2. Business buys/installs the AI Receptionist agent.
3. CoreAI assigns/provisions a Twilio number or maps a Twilio number to that business.
4. Business enters forwarding phone, business info, services, FAQs, hours, booking URL, and team phone.
5. CoreAI configures Twilio/Vapi/Calendar backend wiring.

Advanced later:

* Bring your own Twilio account

## Complete AI Receptionist Flow

1. Customer/patient calls the business CoreAI/Twilio number.
2. Twilio sends voice webhook to CoreAI.
3. CoreAI resolves the business by Twilio `To` / `Called` number.
4. CoreAI returns TwiML to dial/forward to the business phone.
5. Twilio sends the dial result callback.
6. If answered, do nothing.
7. If no-answer/busy/failed/canceled:

   * store/update conversation
   * capture/update lead
   * send context-aware SMS through Twilio
   * optionally start Vapi outbound AI voice callback
8. If customer replies by SMS, Twilio sends inbound SMS webhook.
9. CoreAI loads business context + conversation history.
10. AI replies based on the business profile/knowledge.
11. If appointment booking is needed, create event in Google Calendar.
12. Send appointment confirmation SMS.

## Connector Responsibilities

Twilio:

* business phone number
* voice webhook
* call forwarding
* missed-call detection via DialCallStatus
* SMS send/receive

Vapi AI:

* AI voice receptionist
* outbound voice callback
* patient/customer conversation
* tool call back into CoreAI for booking or escalation

Google Calendar:

* availability lookup
* appointment event creation
* booking confirmation

## Safety Rules

* Do not commit secrets.
* Do not include `.env` files in ZIPs.
* Do not change production PM2 process ids 1 or 5.
* Do not make broad UI rewrites unless explicitly asked.
* Prefer focused changes, then run typecheck.Continue the Architect Publish + All Agents fix.

I accidentally rejected the needed backend route edit. Re-apply it carefully.

Issue found:

* Architect publish/listing backend mostly exists.
* Architect My Agents / All Agents use real backend data.
* Marketplace/business side calls:
  GET /architect/listings/completed
* Backend does not have this endpoint, so marketplace cannot load published/completed agents.

Implement the smallest safe fix:

1. Add GET `/architect/listings/completed`.
2. This route must be buyer-visible, not ARCHITECT-only.
3. Register it before `architectRoutes.use("*", requireRole(["ARCHITECT"]))`.
4. Keep it protected with auth if the current marketplace requires login. If the route is before requireAuth, explicitly add `requireAuth`.
5. Do not duplicate existing route patterns.
6. Do not change UI.
7. Do not change className values.
8. Do not remove or rename data-testid attributes.
9. Do not break Architect publish.

Return listings with:

* listing data
* workflow data if needed by frontend
* architect basic info/profile if needed by frontend

For MVP visibility:

* Include listings with status `APPROVED`
* Also include `PENDING_REVIEW` if there is no admin approval flow yet, so newly published agents can appear during MVP testing.
* Exclude `DRAFT`, `REJECTED`, `SUSPENDED`.

After adding route:
Run:
npm run build:shared
npm run typecheck:backend
npm run typecheck:frontend

Then manually verify:

1. Architect can publish an agent.
2. Architect My Agents / All Agents shows it.
3. Marketplace no longer 404s on `/architect/listings/completed`.
4. Published/PENDING_REVIEW agent appears in marketplace data.
5. Missed Call Text-Back flow remains untouched.

Final response:

* What was broken
* What was fixed
* Files changed
* Endpoint added
* Typecheck results
