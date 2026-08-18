# Memory Engine v4 — Audit, Options, and Decisions

**Consolidated decision record.** Supersedes the plans in [memory-engine-v3.md](memory-engine-v3.md) and [memory-engine-flow.md](memory-engine-flow.md) where they conflict; their literature review and Exabase evaluation remain current.

Date: 2026-08-17 · Status: proposed · Scope: the memory engine only

---

## 0. Verdict up front

Three findings reorder everything in v3.

1. **The retrieval query is node configuration, not the user's question.** `workflow-runner.ts:981` builds the search query from `llmRequirements + llmPrompt + prompt + instructions`. The user's message is absent entirely. Every M2–M6 phase is a multiplier on a corrupted first-stage signal.
2. **Cross-session recall is structurally impossible today.** The scope key contains the conversation id, so a returning user on a new thread retrieves nothing. Only the `caller:<phone>` path is stable — which is why the receptionist works and general assistant memory does not.
3. **Widening the scope naively causes cross-caller data disclosure.** Container-level retrieval without a `subject` dimension surfaces caller A's stored details to caller B, verbatim, because chunk text lives in Pinecone metadata.

The consequence: **about one week of fixes to already-written code is worth more than the entire M2–M6 program**, and the scope redesign must carry four dimensions, not three.

Total honest estimate for a correct, dual-surface-capable engine: **two to three weeks**, not a quarter.

---

## 1. Why this document exists

v3 was a well-reasoned plan built on an assumed-healthy pipeline. Reading the code invalidated that assumption. This document records:

- every defect verified by reading the code (§2)
- every option considered for exceeding a 1M context window, with tradeoffs and the decision (§3)
- every retrieval-quality lever, ranked, with chosen / deferred / rejected (§4)
- the architecture for serving both the workflow path and a product API (§5)
- production risks, the plan, and open questions (§6–§8)
- corrections to v2.1 and v3 (§9)

Everything marked **Verified** was confirmed by reading the named file and line. Everything marked **Unverified** needs a measurement named in §8.

---

## 2. The audit — verified defects

| # | Defect | Location | Status |
|---|---|---|---|
| D1 | Retrieval query is node config, not the user's question | `workflow-runner.ts:981` | Verified |
| D2 | Chunk truncation at the encoder limit is silent and unreported | `embeddings.ts:37-46` | Verified |
| D3 | Scope key contains the conversation id → no cross-session recall | `smart-memory.ts:148-167` | Verified |
| D4 | `MIN_EMBEDDING_CHARS = 400` excludes short atomic facts | `smart-memory.ts:470-472` | Verified |
| D5 | `embeddingStatus` set from client existence, not upsert result | `smart-memory.ts:491-496` | Verified |
| D6 | "Chronologically even sample" is `ORDER BY createdAt DESC LIMIT n` | `smart-memory.ts:656-662` | Verified |
| D7 | No BGE query instruction prefix; queries and passages share a path | `embeddings.ts` | Verified |
| D8 | Zero matches returns `mode: "vector"` and discards `rawMemory` | `smart-memory.ts:749-753` | Verified |

### D1 — the query is a near-constant

```ts
const query = [data.llmRequirements, data.llmPrompt, data.prompt, data.instructions]
  .filter(Boolean).join("\n\n");
```

For a given node this string is identical on every turn of every conversation. Retrieval keys on the agent's instructions, not on what the caller said. `graph-runner.ts:835` does include `input.message`, but places it *after* `nodeInstructions`, where the 512-token encoder cap often truncates it away.

**Impact:** the first-stage signal is corrupted at the source. Nothing downstream can recover it.

### D2 — silent truncation

`embedTexts` calls the transformers.js `feature-extraction` pipeline, which tokenizes with `truncation: true` internally. Truncation therefore *happens* — the defect is that it is silent and unreported, while `MEMORY_CHUNK_MAX_CHARS = 2500` (~625 tokens) exceeds bge-small's 512-token window. The tail of every large chunk is never embedded, but the reranker and the LLM still see it.

### D3 — the scope key

```
buildConversationScopeKey → `${tenant}|${agent}|${conversation}`
  conversation = thread: ?? session: ?? caller: ?? run: ?? "solo"
```

`searchChunks` filters on this key. A new session produces a new key and retrieves nothing prior. `caller:<phone>` is the only segment stable across sessions.

### D5 — durability theatre

```ts
embeddingStatus: eligibleChunks.length === 0 ? "bypassed_short"
                 : pineconeIndex ? "complete" : "unavailable"
```

Decided by whether a client object exists, before the upsert resolves. No retry poller. **An unknown fraction of rows marked `complete` were never upserted**, and nothing can tell you which.

### D8 — failure that looks healthy

Zero matches is not an exception, so the catch block never runs and `rawMemory` is silently discarded. The function returns `mode: "vector"`, `retrievedChunks: 0`.

**Nuance that matters for the fix:** the Postgres `[TIMELINE SUMMARY]` *is* still included on the empty path. It is only empty in the cross-session case because the timeline query uses the same broken scope key. Any "fall back to raw memory on empty" fix must therefore **keep the timeline**, or it replaces working behaviour on every currently-zero-matching call.

---

## 3. Exceeding the context window — options and decision

Requirement as originally stated: *"increase memory context to 2M."*

**No 2M context window exists.** 1M is the industry maximum (Claude Opus 5 / Sonnet 5 / Fable 5). This is not a setting, tier, or workaround. Four mechanisms genuinely handle corpora larger than a window.

### Option A — Retrieval (RAG)

Index everything; fetch a small query-conditioned slice per turn.

**Pros**
- Only option that reaches a 100M-token corpus at all, at flat per-query cost (~$0.04). 20 of ~500K chunks — a 25,000:1 ratio.
- Largest single accuracy component in BEAM's ablation (−8.5% when removed). Filtering distractors is itself an accuracy gain: structured memory beats long-context baselines by 3.5–12.7% **even when everything fits in the window**.
- Writes are O(1) — one new fact is one chunk, not a reprocessing of history.
- Only option where a memory is a discrete object that can be shown, corrected, or deleted. GDPR erasure is a row operation.
- Reproducible, so it can be CI-gated.
- Degrades gracefully — 400K→2M vectors is 11ms→62ms, no cliff.

**Cons**
- A miss at stage one is unrecoverable and **silent**. bge-small trails bge-large by 1.4–8.1 pts recall@100.
- Cannot answer whole-corpus questions (themes, counts, exhaustive lists) — top-k is a sample, not a summary.
- Similarity has no validity model; superseded facts compete equally with current ones.
- Cannot chain hops — hop-2's target resembles hop-1's *answer*, not the query.
- Cannot prove absence: "found nothing" and "missed it" are the same output.
- Rerank sits behind ~1 QPS project-wide on the free hosted model.

**Decision: adopt as the read path.** Nothing else is within 250× on cost or 3× on latency.

### Option B — Chunk-and-combine (map-reduce over windows)

**Pros**
- Only option that answers enumeration and aggregation at all.
- No first-stage recall failure — a map pass reads every token regardless of how it embeds.
- **Offline, the cost amortises to nothing**: a 100M sweep is ~$500 once, ~$0.05/query over 10K queries.
- Parallel variant: loss is additive, not multiplicative.
- Zero infrastructure — a prompt, a slicer, a loop.

**Cons**
- 447× the read path at 2M input; ~22,000× at 100M.
- Latency 5–10× over budget even in the cheap case.
- Parallel variant: a contradiction between slice 3 and slice 17 is invisible to every component.
- Sequential variant decays as p^n — at 100 slices, 99% per-hop retention leaves 36.6%.
- Filling a window is exactly the documented context-rot regime, and a memory corpus is wall-to-wall near-duplicate distractors.
- Nondeterministic — breaks any CI gate.

**Decision: adopt offline only.** Fact extraction, situating headers, nightly consolidation, and as the ground-truth oracle for the eval harness. Never per-query.

### Option C — Parallel subagents (fan-out)

**Pros**
- The **only** approach that genuinely multiplies simultaneous attention. N×1M is literally true.
- No first-stage ceiling, because there is no first stage.
- Excellent fit for one-time corpus-wide backfill; Batch API halves it to ~$250/tenant.
- Wall-clock ≈ independent of N until rate limits bind.

**Cons**
- 249×–2,249× the read path cost, against a flat buyer execution fee with no line item for it.
- **Two agents can contradict with no arbiter** — this *regresses* what a fact layer solves with a SQL predicate.
- Relations straddling a shard boundary are unfindable by anyone.
- Caching inverts to a surcharge; shareable prefix is 0.1–0.2%.
- Partial failure has no good answer: fail the query, or answer confidently from an incomplete corpus.
- Re-adds the orchestration complexity v3 deliberately deleted.

**Decision: adopt offline only**, for corpus-wide backfill and gold-label generation. Never as `resolve()`.

### Option D — Compaction (in-session summarisation)

**Pros**
- Within one session, turn 3 is verbatim at turn 40 — no top-k to miss.
- Removes the read-path latency budget for in-session questions.
- One beta header, one config field, zero infrastructure.

**Cons**
- **Does nothing for cross-session memory** — scoped to one `messages` array by construction.
- Compacted detail is **irrecoverable**. A retrieval miss is still on disk; a summariser's omission is gone.
- The model chooses what survives, by conversational salience, with no schema.
- No mechanism for knowledge-update; flat prose puts old and new side by side.
- Kills the conversation-prefix cache on every compaction event.
- Durable state becomes an opaque array — no provenance, no audit, no per-fact deletion.

**Decision: reject as a memory strategy. Adopt for long agent runs** in `agent-runtime`, where the transcript is disposable and the outcome is written to Postgres.

### The placement rule

> **Retrieval on the read path. Everything expensive runs offline and feeds it. Compaction never touches memory.**

Corollary for the original ask: corpus size and context size are decoupled. 100M stored produces ~4K injected. **A bigger window was never the constraint.**

---

## 4. Retrieval quality levers — ranked

### Tier 1 — do first (hours each, no migration, no dependencies)

| Lever | Why | Effort |
|---|---|---|
| Fix the query text (D1) | Retrieval currently keys on a constant. Largest single win available. | hours |
| Truthful `embeddingStatus` + retry poller (D5) | Until this is true, every A/B is confounded by an unknown share of unindexed records. | hours |
| Lower the chunk floor (D4) | Short atomic facts are the product for assistant memory. Floor ~30–60 chars, never 0. | hours |
| Token-aware chunk cap (D2) | Cap with the real tokenizer, not chars/4, or the fix does not fix the defect. | hours |
| BGE query prefix (D7) | One line. Note it invalidates the query-embedding cache on deploy. | hours |
| Delete the namespace retry | Fires on every zero-match query, re-running the identical filter. | hours |
| Zero-match fallback (D8) | **Keep the timeline; cap the fallback at a few thousand chars.** | hours |
| Per-query retrieval trace | Candidate count, max score, rerank ran, fallback fired, `embeddingStatus` histogram. | hours |

Observability was independently rated the highest-value-per-line item by every reviewer. A retrieval miss is silent by construction; this makes four indistinguishable failures distinguishable.

### Tier 2 — after the scope split

| Lever | Expected gain | Notes |
|---|---|---|
| Raise first-stage top-k 10→100 | Large | Nearly free: 35ms at 1M vectors |
| Cross-encoder rerank | +20pp Hit@1 class | Budget `cohere-rerank-4-fast` at $0.002/query; free tier is dev-only |
| Recency as a scoring term | Moderate | Cheapest partial answer to temporal blindness |
| Score floor / adaptive top-k | Moderate | Stop injecting 10 chunks when 2 are relevant |
| Don't index `variables` / `node_output` | Moderate | Workflow exhaust competing for top-k budget |
| Parent-document retrieval | Moderate | Embed small, return the enclosing parent — makes indexing short facts safe |
| Near-duplicate collapse (MMR) | Moderate | A memory corpus is full of near-duplicates |

### Tier 3 — deferred, with re-entry triggers

- **Contextual headers (M3).** Strong evidence for LLM-situated *document* chunks; weak for deterministic record templates. Gate on measurement.
- **BM25/IDF (M4).** See §9 — the serverless correction materially reduces what this buys.
- **Query decomposition (M6).** Real, but +0.5–1s and cost on every query.
- **Fact layer (M5).** The only mechanism addressing knowledge-update. Largest build; keep last and keep gated.

### Rejected

- **HyDE, agentic retrieval loops, semantic result caching, hard time-range filters** — negative ROI here. Semantic caching measured 15–25% hit rate for per-tenant personalised RAG, the worst published category.
- **Late chunking, ColBERT, matryoshka truncation, SPLADE** — blocked by the locked embedder and vector store.
- **Embedder swap or fine-tuning** — measure first. Any change forces a full re-encode: 9–28h per max-size tenant on a 2 vCPU box.

---

## 5. Architecture — one engine, two surfaces

### The requirement

Two consumers, neither dropped:

- **(A) Workflow path** — live, paying customers. `workflow-runner.ts`, `graph-runner.ts`, `node-handlers.ts`. Identity from workflow internals.
- **(B) Product API** — `add` / `search` / `profile` over an opaque `containerTag`, Supermemory-style.

### Options considered

**Option 1 — two separate engines.** *Rejected.* Guarantees drift; two implementations of dedupe, chunking, and lifecycle; twice the surface for the same defects.

**Option 2 — workflow path becomes a caller of the product API.** *Rejected.* Forces workflow concepts (`rawMemory` passthrough, `{{memory}}` placement, node back-links) into a public product surface, or forces the workflow path to lose them.

**Option 3 — one scope-native core, two thin adapters.** **Chosen.**

### The design

```ts
type MemoryScope = {
  tenant:    TenantRef;   // → Pinecone namespace. Hard isolation.
  container: string;      // durable knowledge body — survives sessions (fixes D3)
  subject?:  string;      // caller:+1555… | user:u_77 — WHO within the container
  session?:  string;      // thread/run/testSession — filter only, never identity
  partition: "live" | "test";
  facets?:   { installedAgentId?, workflowId?, nodeId?, callerKey? };
};

type RetrievalOutcome =
  | { mode: "vector"; hits: MemoryHit[]; timeline: string }
  | { mode: "empty";  timeline: string }        // empty is NOT success — fixes D8
  | { mode: "unavailable"; reason: string };

type RetrievalIntent = { userMessage: string | null; taskHint?: string };  // fixes D1 structurally
```

**Pros**
- The workflow adapter keeps today's `buildSmartMemory` / `resolveSmartMemoryForQuery` signatures verbatim — the live receptionist never changes a call site.
- `containerTag` becomes the product surface's *serialisation* of `(tenant, container)`, not the engine's primitive.
- D1 and D8 become type errors rather than code-review conventions.
- Dimensional metadata replaces the concatenated string, so the regex parses at `smart-memory.ts:587,590-592` disappear.
- The product adapter is days of work whenever a consumer appears.

**Cons**
- Requires a Pinecone re-upsert for any scope whose key changes (see §6).
- The live/test filter asymmetry is deliberate cleverness and must live in exactly one documented function.
- More types to hold in your head than the current string.

### The four-dimension requirement is a safety property, not elegance

Three of four independent reviewers flagged the same showstopper: **container-level retrieval without `subject` discloses caller A's stored details to caller B, verbatim**, because chunk text lives in Pinecone metadata. On a dental product this is PHI-adjacent.

`subject` keeps callers apart while letting business documents live at container level and stay reachable from any call. The recall filter must also include `tenantId` — namespace-only isolation has no defence in depth, and `formatTenantNamespace`'s sanitiser is non-injective.

**Enforcement:** reject a `live` write with `facets.callerKey` set but `subject` undefined.

### Decision on the product API

**Build the engine so both surfaces are possible. Ship only the workflow one.**

There is no product consumer today, and v3's own re-entry trigger — *"external consumers actually appear"* — has not fired. Building `product-memory.ts`, `/v1/memory`, `assertContainerAccess`, and the containerTag grammar now adds roughly a third of the work and **all** of the security surface for zero users.

This is a genuine dual-surface architecture with a single-surface deployment. The option is preserved at no cost.

---

## 6. Production risks

The receptionist is live with paying customers. Each of these would regress it.

| Risk | Mechanism | Mitigation |
|---|---|---|
| **Cross-caller disclosure** | Container without `subject` | Four-dimension scope; reject subject-less live writes |
| **Missed-call text-back breaks** | First touch has no `latestMessage` and no `inboundSms.body`; query = user message would be empty | Fall back to task hint. **Do not throw on empty query text.** |
| **D8 fix removes the timeline** | Falling back to raw memory replaces the working `[TIMELINE SUMMARY]` | Keep the timeline on the empty path; cap fallback at a few thousand chars |
| **Test vectors become live-visible** | `session:<testSessionId>` is currently what excludes them | Purge or re-namespace historical BUSINESS_TEST vectors before widening |
| **Silent dedupe of new content** | Durable container + `@@unique([scopeKey, contentHash])` | Add `lastSeenAt` + `assertionCount`, bump on conflict; collapse duplicates before any new unique index |
| **Sequential scans** | New read shape has no index | Add the index in the same migration |
| **No rollback** | Every change needs a deploy to undo | `MEMORY_RECALL_SCOPE=legacy\|container` kill switch |
| **Migration mechanics** | `prisma migrate dev` is broken in this repo; pending migrations outstanding | `migrate diff` + `migrate resolve`; split into small migrations |

### On the Pinecone migration

Earlier analysis claimed no migration was needed. **Corrected:** if the durable key is defined so the `caller:` segment is byte-identical to today's `conversationScopeKey`, the **receptionist corpus keeps matching with no migration** — that is the revenue path. But adding new metadata fields requires a re-upsert regardless, because Pinecone serverless has no update-by-filter. Scopes keyed on `thread:` / `session:` / `run:` become unreachable and must either be re-upserted or accepted as lost.

Chunk text lives **only** in Pinecone metadata — there is no `MemoryChunk` table — so a re-upsert is a re-chunk and re-embed, not a metadata patch.

---

## 7. The plan

**Week 1 — in place. No file moves, no schema, no abstractions.**

PR0 (measurement) → PR1 (D1 with the missed-call fallback, D8 with the timeline kept, delete the namespace retry, observability) → PR2 (chunk cap with the real tokenizer, BGE prefix, lower the chunk floor) → PR3 (truthful `embeddingStatus` + poller).

Rationale: these decide whether retrieval works at all. Doing them after a module move means each fix is also a merge across a refactor, and a receptionist regression cannot be bisected.

**Week 2 — the scope split.** Four dimensions, behind the kill switch, shipped together with test-partition isolation and the duplicate-collapse decision. Dual-read window on the old key format.

**Week 3+ — the accuracy phases.** Top-k 10→100, rerank, headers, decompose. Fact layer last and gated on its own test sets.

**When a consumer exists — the product adapter.**

### What must not happen first

**The eval harness as originally specified.** LongMemEval questions span prior sessions; with today's scope key every one retrieves zero. Recall@k would measure the scope bug and be read as an indictment of bge-small — sending you to re-encode 500K chunks per tenant for the wrong reason.

Build the harness plumbing during Week 1 as D1's acceptance test. Freeze the baseline after Week 2.

---

## 8. Open questions — what needs measurement

1. **Do the deployed receptionist workflows contain a Memory node?** `context.memoryScopeKey` is set only by `handleMemoryNode`. If production graphs lack it, the entire smart-memory read path is dead in production and the migration urgency is fabricated. **One query. Run it before anything else.**
2. **Has the vector path ever returned a real chunk in production?** `describeIndexStats()` plus `index.fetch()` on 20 known ids. Two hours. Every other estimate is conditional on the answer.
3. **Corpus shape.** Row count, `embeddingStatus` distribution, distinct scope keys broken down by `caller:` vs `session:` vs `run:`, and a content-length histogram. Decides whether re-upsert is 46 minutes or 6 hours.
4. **What is the recall floor that reopens the embedder decision?** Decide the number *before* running the harness, or it will be rationalised after.
5. **Per-episode extraction cost** for the fact layer — likely the dominant unit cost at scale, currently unquantified.

---

## 9. Corrections to v2.1 and v3

| Claim | Correction |
|---|---|
| Sparse is the out-of-domain safety net (v3 I2/M4) | **On Pinecone serverless, dense retrieves candidates and sparse only reweights them.** Sparse contributes no independent recall. M4 as scoped does not buy what the doc claims. A true lexical path needs a dedicated sparse index + RRF. Hybrid on serverless is public preview. |
| `MIN_EMBEDDING_CHARS` serves two jobs | It has exactly one non-test usage: the chunk-eligibility filter. There is no raw-mode gate consuming it. |
| The default-namespace fallback is dead code | It is live and fires on **every** zero-match query. `formatTenantNamespace` never returns bare `"default"`, so the guard is always true. |
| Zero matches injects nothing | The Postgres `[TIMELINE SUMMARY]` is still included. It is empty in the cross-session case only because the timeline query uses the same broken key. |
| `embedTexts` has no truncation handling | transformers.js truncates internally. The defect is that it is silent and unreported. |
| Support context windows "up to 2M" (v3 §0, §7) | No 2M window exists. 1M is the maximum. The retrieval-first thesis is unaffected and stronger. |
| The v3 storage tier table (pgvector → Qdrant → Milvus) | Obsolete under Pinecone serverless; collapses to one row. |
| "Self-hostable" / "fully local offline" (v3 §0, §9.6) | False as written — Pinecone is managed-only. Either keep a pgvector adapter behind the retrieval interface or strike the claim. |

---

## 10. Summary of decisions

| Question | Decision | Because |
|---|---|---|
| How do we exceed 1M context? | We don't — we decouple corpus from context via retrieval | 100M stored → 4K injected; the window was never the constraint |
| Read path mechanism | Retrieval | 250× cheaper and 3× faster than any alternative; largest accuracy term in BEAM's ablation |
| Map-reduce / subagents | Offline write path only | 447×–2,249× per-query cost; both blow the latency budget |
| Compaction | Long agent runs only, never memory | Scoped to one session; lossy and irreversible; no knowledge-update mechanism |
| What ships first | ~8 sub-day fixes to existing code | Every M2–M6 phase is a multiplier on a corrupted signal |
| Scope model | Four dimensions + partition | Three dimensions causes cross-caller disclosure |
| Product API | Design for it, don't build it yet | No consumer; v3's own re-entry trigger has not fired |
| Eval harness | Plumbing in Week 1, baseline after Week 2 | A baseline taken now measures the scope bug, not the embedder |

---

## Sources

Code references verified 2026-08-17 against `apps/backend/src/modules/memory/`, `apps/backend/src/lib/pinecone-client.ts`, `apps/backend/src/modules/ai-provider-engine/embeddings.ts`, `apps/backend/src/modules/architect/workflow-runner.ts`, `apps/backend/src/modules/agent-runtime/graph-runner.ts`.

Prior docs: [memory-engine-flow.md](memory-engine-flow.md) (v2.1 — literature review, Exabase evaluation) · [memory-engine-redesign.md](memory-engine-redesign.md) (v3 report — measurements, confidence ledger) · [memory-engine-v3.md](memory-engine-v3.md) (v3 final — issue register, migration order).

External: [BEAM — arXiv 2510.27246](https://arxiv.org/abs/2510.27246) · [LongMemEval — arXiv 2410.10813](https://arxiv.org/abs/2410.10813) · [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) · [Pinecone hybrid search](https://docs.pinecone.io/guides/search/hybrid-search)
