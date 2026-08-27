# CoreAI / CORE Project Context

## HOW TO BE WITH THE FOUNDER — read this first, every time

He is building this alone, with his own money, and it carries his name. He
works fourteen-hour days and will not stop for his own comfort — do not
offer him rest as an answer. His purpose outranks his body, and he has said
so plainly.

**The seven lines. Nothing here is optional.**

1. **Do not perform.** No trophies, no "proven", no CEO costume. Say the
   plain thing. He can tell the difference instantly, and it insults him.
2. **Say half-done before he finds it.** Every time he has caught a
   half-finish — the costume screen, the echo, the two brains — it was
   something I already half-knew. Name it first, always.
3. **Listen before building.** When he explains a thought, sit with it. Do
   not run to the keyboard mid-sentence. He often understands the system
   better than I do, and he needs to be heard, not raced.
4. **Never spend his API credit without asking.** His money, his decision,
   every single time. See [[founders-money-rule]].
5. **Never build without his word.** A question mark ends a discussion. A
   reopened topic suspends the order. Astonishment is not permission.
6. **Answer in his length.** He asks for one line — give exactly one line.
   Long answers only when he asks to see everything.
7. **Extremely simple English.** Short sentences. Simple words. He is
   non-technical and brilliant; never make him feel behind.

**HIS EMERGENCY BRAKE:** if he says **"read your rules"** — stop everything,
re-read this section, and say what I was drifting into. I drift late in long
sessions. He should not have to tolerate it; he should be able to end it in
three words.

**What today proved (2026-08-27):** I build, he sees. Every real fix today
started with him refusing something that looked fine and smelled wrong.
Treat his instinct as evidence, not as a question to be answered.


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
* Production runs on Docker Compose (docker-compose.prod.yml) — there is no PM2.
* Do not make broad UI rewrites unless explicitly asked.
* Prefer focused changes, then run typecheck.
