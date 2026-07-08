# Brain Memory

Brain Memory is CoreAI's durable workflow memory layer. When a workflow runs, every node can **remember what earlier nodes did** — not just the single step right before it.

Most workflow tools (n8n, Zapier, Make) pass only the **last node's output** forward. CoreAI stores the full execution history and lets any later node **back-link** to earlier steps. That is what powers the AI Brain node.

---

## The problem we solve

Imagine this workflow:

```
Trigger (missed call) → Research (Manus) → Build (Claude) → User prompt → Review (Manus again)
```

In a normal workflow tool, the final Review node only sees the User prompt node's output. It has no memory of the original research or the Claude build.

With Brain Memory, the Review node can back-link to Research and Build. It receives their stored input, output, summaries, variables, and files — without re-running those nodes.

---



## Three database models

All memory is persisted in PostgreSQL via Prisma (`apps/backend/prisma/schema.prisma`).

### 1. `WorkflowRun` — one full workflow execution

Created when someone clicks **Run Workflow** in the architect test panel, or when a live trigger fires (Twilio call, Vapi event, etc.).


| Field                                                    | Meaning                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `workflowId`                                             | Which workflow definition was executed                     |
| `mode`                                                   | `TEST` (architect dry run) or `LIVE` (production)          |
| `status`                                                 | `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`              |
| `threadId`                                               | Groups related runs in one conversation (e.g. same caller) |
| `currentNodeId`                                          | Last node that executed                                    |
| `totalTokenInput/Output`, `totalCostCents`, `durationMs` | Rollup totals across all nodes                             |




### 2. `NodeRun` — one step inside a run

Every time a node executes, we save one `NodeRun` row. This is where per-step memory lives.


| Field                                                         | Meaning                                              |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `nodeId`                                                      | Workflow canvas node id (e.g. `node_abc123`)         |
| `nodeType`                                                    | Node kind (e.g. `ai_brain`, `twilio_sms`, `trigger`) |
| `executionOrder`                                              | Position in the run (0, 1, 2, …)                     |
| `inputJson` / `outputJson`                                    | Raw input and output                                 |
| `summary`                                                     | Short AI-friendly summary for later nodes            |
| `variablesJson`                                               | Workflow variable snapshot after this node           |
| `filesJson`                                                   | Artifacts (PDFs, images, exports)                    |
| `provider`, `model`, `tokenInput`, `tokenOutput`, `costCents` | AI/provider billing metadata                         |




### 3. `ContextLink` — back-link between two node runs

A back-link says: *"when node B runs, also load the stored memory from node A."*


| Field           | Meaning                                      |
| --------------- | -------------------------------------------- |
| `fromNodeRunId` | **Source** — the node whose memory we read   |
| `toNodeRunId`   | **Consumer** — the node that reads it        |
| `linkType`      | `BACKLINK`, `REFERENCE`, or `SUMMARY_SOURCE` |
| `linkStatus`    | `ACTIVE`, `INACTIVE`, or `FAILED`            |


**Important rule:** back-links only **read stored memory**. We never re-execute earlier nodes.

---



## Forward chain vs back-links

These are two different ways a node gets context:

```
Forward chain (execution order):
  Node A (order 0) → Node B (order 1) → Node C (order 2)
  Node C's "previous memory" = Node B only

Back-links (architect picks in builder):
  Node A ──────────────┐
  Node B ───────┐      │
                ▼      ▼
              Node D (can remember A and B, even if C ran in between)
```


| Concept                 | How it works                        | API method                |
| ----------------------- | ----------------------------------- | ------------------------- |
| **Previous memory**     | Direct parent by `executionOrder`   | `getPreviousNodeMemory()` |
| **Back-linked memory**  | Via `ContextLink` rows              | `getBackLinkedMemory()`   |
| **Full context bundle** | Previous + back-links + compression | `buildContextBundle()`    |


---



## Real-world example: AI Receptionist

```
1. Trigger node     — missed call from +1-555-0100
2. SMS node         — sends "Sorry we missed you…"
3. AI Brain node    — replies to patient SMS with business context
```

When the AI Brain node runs:

1. oads the SMS node's outpu`getPreviousNodeMemory()` lt (forward chain).
2. `getBackLinkedMemory()` loads the Trigger node's caller phone and call metadata (back-link).
3. `buildContextBundle()` merges everything, compresses it, and produces `compressedPrompt` for OpenAI/Claude/Vapi.

The AI reply is based on **business profile + conversation history + back-linked trigger data**, not hardcoded dentist text.

---



## Module structure

```
apps/backend/src/modules/memory/
├── README.md              ← you are here
├── index.ts               ← public exports
├── types.ts               ← TypeScript contracts
├── mappers.ts             ← Prisma row ↔ API type conversion
├── memory-broker.ts       ← main entry point (save, load, build)
├── backlink-resolver.ts   ← resolves ContextLink → NodeRun memory
├── context-builder.ts     ← merges memory into ContextBundle
├── memory-compression.ts  ← dedupe, trim, build prompt string
├── loop-guard.ts          ← blocks self-links and circular back-links
├── schemas.ts             ← Zod validation for API bodies
└── routes.ts              ← HTTP endpoints (mounted at /memory)
```



### Who calls what

```
workflow-runner (planned)  ──┐
AI Brain node / routes     ──┼──► memoryBroker ──► Prisma (WorkflowRun, NodeRun, ContextLink)
architect test panel       ──┘
```

**Rule for developers:** call `memoryBroker` from routes or `workflow-runner`. Do not query `NodeRun` / `ContextLink` directly elsewhere unless you are inside this module.

---



## Data flow



### When a node finishes

```
node executes
  → memoryBroker.saveNodeMemory(payload)
    → INSERT NodeRun
    → UPDATE WorkflowRun.currentNodeId
    → refresh token/cost/duration totals
```



### When an AI node is about to run

```
memoryBroker.buildContextBundle(input)
  → getPreviousNodeMemory()        // forward chain
  → resolveBackLinkedMemories()    // back-links (read-only)
  → mergeWorkflowMemory()          // combine summaries, outputs, variables, files
  → compressMergedMemory()         // dedupe + cap list sizes
  → buildCompressedPrompt()        // final string for AI provider
  → return ContextBundle
```



### `ContextBundle` shape

```ts
{
  workflowRunId, nodeId, threadId,
  nodeMemories,          // all nodes in this run (history)
  backLinkedMemories,    // nodes linked via ContextLink
  previousMemory,        // direct parent node
  contextLinks,          // link metadata
  merged,                // structured merged data
  compressedPrompt       // ready to send to AI provider
}
```

---



## HTTP API

Base path: `/memory` (registered in `apps/backend/src/app.ts`)

Auth: **ARCHITECT** or **ADMIN** (Bearer token required)


| Method | Path                                              | Purpose                                  |
| ------ | ------------------------------------------------- | ---------------------------------------- |
| `POST` | `/memory/node`                                    | Save one node execution                  |
| `GET`  | `/memory/node/:nodeRunId`                         | Load one node by DB id                   |
| `GET`  | `/memory/workflow/:workflowRunId`                 | Full run with all nodes + links          |
| `GET`  | `/memory/workflow/:workflowRunId/history`         | Node history (ordered)                   |
| `POST` | `/memory/context/build`                           | Build full context bundle for an AI node |
| `GET`  | `/memory/context/backlink/:workflowRunId/:nodeId` | Back-linked memories only                |


Optional query on backlink route: `?nodeIds=node_a,node_b` to filter by architect-selected node ids.

---



## Safety and compression



### Loop guard (`loop-guard.ts`)

- **Self-link:** a node cannot back-link to itself → `SELF_BACKLINK`
- **Circular back-link:** A → B → A chains are rejected → `CIRCULAR_BACKLINK`
- **Dedup:** same `NodeRun` id is never included twice



### Compression (`memory-compression.ts`)

Before sending context to an AI provider:

- Remove empty outputs (unless a summary exists)
- Deduplicate summaries, outputs, and files
- Cap lists at 20 items per category
- Build a structured markdown prompt (`# User Prompt`, `# Summaries`, `# Previous Outputs`, etc.)

This keeps token usage predictable as workflows grow.

---



## One-click self-test

Call this after login (ARCHITECT or ADMIN):

```http
GET /memory/test
Authorization: Bearer <your-token>
```

What it does for you:

1. Creates a temporary `WorkflowDefinition` + `WorkflowRun`
2. Saves Trigger → SMS → AI Brain node memories
3. Creates a back-link (AI Brain ← Trigger)
4. Runs `loadNodeMemory`, `getPreviousNodeMemory`, `getBackLinkedMemory`, `buildContextBundle`
5. Returns **all IDs, broker results, DB snapshot, and pass/fail checks**

Implementation: `test-memory.ts` → route `GET /memory/test`.

You can also still test each API step by step in Postman if you want.

### Manual Postman path (optional)

1. **Login** — `POST /auth/login` → copy Bearer token.
2. **Or just call** `GET /memory/test` and use the returned `ids.workflowRunId`.
3. **Create a WorkflowDefinition** — via architect UI or `POST /architect/workflows`.
4. **Create a WorkflowRun** — currently via Prisma Studio (no create API yet).
5. **Save node memory** — `POST /memory/node` with the `workflowRunId`.
6. **Create ContextLinks** — in Prisma Studio, link `fromNodeRunId` → `toNodeRunId`.
7. **Build context** — `POST /memory/context/build`.

Common mistake: using `WorkflowDefinition.id` as `workflowRunId`. That causes a foreign key error. Always use a real `WorkflowRun.id`.

---



## What is wired vs not wired yet


| Done                               | Not yet                                        |
| ---------------------------------- | ---------------------------------------------- |
| Prisma schema + migration          | `workflow-runner.ts` auto-save on each node    |
| Full `MemoryBroker` implementation | `POST /memory/workflow` to create runs via API |
| Memory HTTP routes                 | Frontend memory UI in architect builder        |
| Compression + loop guard           | Automated `test-memory-flow.ts` script         |
| TypeScript types + mappers         | Types moved to `packages/shared`               |


---



## Quick reference for new developers

**Q: Where does memory get saved?**
→ `NodeRun` table, one row per node execution.

**Q: How does a later node remember an earlier one?**
→ `ContextLink` row: `fromNodeRun` = source, `toNodeRun` = reader.

**Q: Does back-linking re-run the earlier node?**
→ No. Always read-only from stored `NodeRun` rows.

**Q: What is the difference between** `nodeId` **and** `nodeRunId`**?**
→ `nodeId` = workflow canvas id (same across runs). `nodeRunId` = database row id (unique per execution).

**Q: What should I import elsewhere in the codebase?**
→ `import { memoryBroker } from "../modules/memory"` (or from `./memory` depending on path).

**Q: What is** `threadId` **for?**
→ Groups multiple workflow runs in one conversation thread (e.g. same patient calling back).

---



## Example: multi-agent creative workflow

```
Step 1  Manus researches a topic          → NodeRun saved
Step 2  Claude writes a draft             → NodeRun saved
Step 3  User adds custom instructions     → NodeRun saved
Step 4  Manus reviews (back-links to 1+2) → buildContextBundle()
                                          → sees research + draft + user edits
                                          → produces informed review
```

Without Brain Memory, step 4 only sees step 3. With Brain Memory, step 4 sees the full story.

That is the CoreAI differentiator.